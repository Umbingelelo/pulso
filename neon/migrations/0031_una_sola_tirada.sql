-- Una sola tirada en la tienda, y que de verdad entregue algo.
--
-- ── Lo que estaba roto, que es peor que lo que se pidió cambiar ──
--
-- La tienda tenía dos artículos de gacha: «Tirada exclusiva de íconos» y «Tirada
-- exclusiva de títulos», a 150 puntos cada uno. Los dos **no entregaban nada**.
--
-- No es una exageración. `solicitar_canje` descuenta los puntos y escribe la fila
-- en `canjes`; las tiradas viven en `movimientos_tiradas`, y **nadie las escribía
-- desde un canje**: las dos únicas fuentes eran los niveles del pase y el −1 de
-- `gacha_tirar`. Comprobado contra la base antes de escribir esto: agrupando
-- `movimientos_tiradas` por motivo salen «Pase nivel N» y «Tirada: …», y nada más.
--
-- Así que doce veces, entre el 17 y el 24 de agosto, un alumno pagó 150 puntos
-- —105 los que compraron en día de reunión— y recibió una fila en su historial de
-- canjes y ninguna tirada. Y no falló en ninguna parte: el canje quedaba
-- «entregado», el saldo bajaba, y la pantalla del gacha seguía diciendo que no le
-- quedaban tiradas. Es exactamente el modo de falla que más cuesta: todo verde y
-- el alumno pagando por nada.
--
-- ── Por qué el mecanismo va en una columna y no en un `if` ──
--
-- La tentación era `if a.categoria = 'gacha' then insert … 1 tirada`. Se descartó:
-- deja el número escondido en el cuerpo de una función, y el día que quieras
-- vender un paquete de cinco tiradas hay que editar SQL en vez de una fila. Con
-- `articulos.tiradas` el catálogo dice qué entrega cada artículo, que es donde el
-- docente ya define precio, límite y stock.
--
-- ── Y por qué una tirada no puede esperar visto bueno ──
--
-- La tirada se entrega **al pedir el canje**, en la misma transacción que descuenta
-- los puntos. Un artículo con `tiradas` y `requiere_aprobacion` a la vez quedaría a
-- medias: se cobraría al solicitar y la tirada se entregaría igual, antes de que el
-- docente aprobara nada. En vez de dejar ese camino a medio implementar, la
-- combinación se prohíbe con un check. Si algún día hace falta, se implementa en
-- `resolver_canje` y se saca el check — pero explícitamente, no por descuido.

-- ============================== El catálogo dice qué entrega ==============================

alter table public.articulos
  add column if not exists tiradas integer;

alter table public.articulos
  drop constraint if exists articulos_tiradas_check;
alter table public.articulos
  add constraint articulos_tiradas_check check (tiradas is null or tiradas > 0);

-- Una tirada se entrega al solicitar, así que no puede quedar esperando aprobación.
alter table public.articulos
  drop constraint if exists articulos_tiradas_sin_aprobacion;
alter table public.articulos
  add constraint articulos_tiradas_sin_aprobacion
  check (tiradas is null or not requiere_aprobacion);

comment on column public.articulos.tiradas is
  'Cuántas tiradas de gacha entrega este artículo al canjearlo. Nulo = ninguna.';

-- ============================== La vitrina lo muestra ==============================
-- Misma vista más `tiradas`. El navegador la lee con `select('*')`, así que el campo
-- llega solo; la pantalla puede usarlo cuando se quiera.
--
-- Ojo: esto es una **vista**, y la Data API cachea el esquema. Después de aplicar
-- esta migración hay que correr `node neon/refrescar-api.mjs`, o la consulta sigue
-- respondiendo 200 con las columnas viejas y el campo llega `undefined`.

create or replace view public.vitrina as
  select a.id, a.asignatura_id, a.periodo_id, a.codigo, a.nombre, a.descripcion,
         a.detalle, a.categoria, a.icono, a.precio, a.requiere_aprobacion, a.stock,
         a.limite_por_alumno, a.activo, a.orden,
         mt.id as matricula_id,
         (coalesce((select sum(m.puntos) from public.movimientos_puntos m
                     where m.matricula_id = mt.id), 0::bigint))::integer as saldo,
         ((select count(*) from public.canjes c
            where c.articulo_id = a.id and c.matricula_id = mt.id
              and c.estado = any (array['solicitado','aprobado','entregado'])))::integer as ya_canjeados,
         ((select count(*) from public.canjes c
            where c.articulo_id = a.id
              and c.estado = any (array['solicitado','aprobado','entregado'])))::integer as colocados,
         -- Al final de la lista y no junto a las otras columnas de `articulos`:
         -- `create or replace view` solo acepta columnas nuevas **al final**, y
         -- meterla en medio falla con «cannot change name of view column».
         a.tiradas
    from public.articulos a
    join public.secciones s on s.asignatura_id = a.asignatura_id
                           and s.periodo_id = a.periodo_id
    join public.matriculas mt on mt.seccion_id = s.id
   where a.activo and mt.activa;

grant select on public.vitrina to pulso_app;

-- ============================== Canjear entrega la tirada ==============================
-- Igual que la versión de la 0022, con un bloque más al final. La firma no cambia,
-- así que el panel y la tienda que hay publicados siguen llamando exactamente lo
-- mismo y desde el minuto en que esto se aplica ya entregan la tirada.

create or replace function public.solicitar_canje(
  p_matricula uuid, p_articulo uuid, p_nota text default null)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare
  a public.articulos%rowtype; v_saldo integer; v_mios integer; v_todos integer;
  v_estado text; v_canje bigint;
  v_seccion uuid; v_desc integer; v_precio integer;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select * into a from public.articulos where id = p_articulo;
  if a.id is null or not a.activo then
    raise exception 'Ese artículo no está disponible';
  end if;

  select s.id into v_seccion
    from public.matriculas mt join public.secciones s on s.id = mt.seccion_id
   where mt.id = p_matricula and mt.activa
     and s.asignatura_id = a.asignatura_id and s.periodo_id = a.periodo_id;
  if v_seccion is null then
    raise exception 'Ese artículo no es de este ramo';
  end if;

  if a.precio is null then
    raise exception 'Ese artículo todavía no tiene precio';
  end if;

  v_desc   := public.reunion_descuento(v_seccion);
  v_precio := public.precio_con_descuento(a.precio, v_desc);

  select coalesce(sum(puntos), 0) into v_saldo
    from public.movimientos_puntos where matricula_id = p_matricula;
  if v_saldo < v_precio then
    raise exception 'No te alcanzan los puntos: cuesta % y tienes %', v_precio, v_saldo;
  end if;

  select count(*) into v_mios from public.canjes
   where articulo_id = p_articulo and matricula_id = p_matricula
     and estado in ('solicitado','aprobado','entregado');
  if a.limite_por_alumno is not null and v_mios >= a.limite_por_alumno then
    raise exception 'Ya alcanzaste el máximo de % para este artículo', a.limite_por_alumno;
  end if;

  if a.stock is not null then
    select count(*) into v_todos from public.canjes
     where articulo_id = p_articulo and estado in ('solicitado','aprobado','entregado');
    if v_todos >= a.stock then raise exception 'Se agotó'; end if;
  end if;

  v_estado := case when a.requiere_aprobacion then 'solicitado' else 'entregado' end;

  insert into public.canjes (articulo_id, matricula_id, estado, precio_pagado, nota_alumno, resuelto_en)
  values (p_articulo, p_matricula, v_estado, v_precio, nullif(trim(p_nota), ''),
          case when v_estado = 'entregado' then now() end)
  returning id into v_canje;

  -- Se descuenta al solicitar, no al aprobar: así nadie compromete el mismo
  -- saldo dos veces mientras espera respuesta.
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (p_matricula, -v_precio,
          'Canje: ' || a.nombre ||
          case when v_desc > 0 then ' (−' || v_desc || '% por reunión)' else '' end);

  -- Y lo que faltaba: si el artículo entrega tiradas, se entregan acá mismo, en la
  -- misma transacción que cobró. El motivo lleva el número del canje —y no solo el
  -- nombre— para que cada tirada se pueda rastrear hasta la compra que la pagó, y
  -- para que dos compras del mismo artículo no se confundan en el historial.
  if a.tiradas is not null then
    insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
    values (p_matricula, a.tiradas, 'Canje #' || v_canje || ': ' || a.nombre);
  end if;

  return v_canje;
end;
$$;

-- ============================== Un solo artículo de gacha ==============================

-- Los dos viejos salen de la vitrina pero **no se borran**: hay doce canjes
-- apuntando a ellos y `canjes.articulo_id` es `on delete restrict`. Borrarlos sería
-- borrar el historial de esos alumnos, además de fallar.
update public.articulos
   set activo = false
 where categoria = 'gacha' and codigo in ('gacha-iconos', 'gacha-titulos');

-- Y entra el único que queda, con su tirada declarada. El pozo es el general: la
-- misma tirada puede entregar un ícono o un título, que es lo que hace `gacha_tirar`
-- y lo que vuelve innecesarios los dos pozos separados.
insert into public.articulos (asignatura_id, periodo_id, codigo, nombre, descripcion,
                              detalle, categoria, icono, precio, requiere_aprobacion,
                              stock, limite_por_alumno, activo, orden, tiradas)
select a.id, p.id, 'gacha-tirada', 'Una tirada de gacha',
       'Una tirada en el pozo del gacha. Puede salir un ícono o un título, de cualquier rareza, '
       'de todo lo que todavía no tengas. Lo del pase no entra: eso se gana subiendo de nivel.',
       'Esfuerzo Baja', 'gacha', 'dices', 150, false,
       null, null, true, 1, 1
  from public.asignaturas a, public.periodos p
 where p.codigo = '2026-2' and a.activa
on conflict (asignatura_id, periodo_id, codigo) do update
  set nombre = excluded.nombre, descripcion = excluded.descripcion,
      detalle = excluded.detalle, categoria = excluded.categoria,
      icono = excluded.icono, precio = excluded.precio,
      requiere_aprobacion = excluded.requiere_aprobacion,
      limite_por_alumno = excluded.limite_por_alumno,
      orden = excluded.orden, tiradas = excluded.tiradas, activo = true;

-- ============================== La devolución ==============================
--
-- Todo lo que se pagó por los dos artículos retirados vuelve, al precio que cada
-- uno pagó de verdad —`precio_pagado`, que ya trae aplicado el descuento de
-- reunión— y no al precio de lista.
--
-- Se devuelve **todo** canje de esos artículos, no solo los entregados: un
-- «solicitado» también cobró al pedirse.
--
-- Es idempotente: la devolución deja una marca en el motivo y no se repite. Correr
-- esta migración dos veces no regala puntos.

with a_devolver as (
  select c.id, c.matricula_id, c.precio_pagado, ar.nombre
    from public.canjes c
    join public.articulos ar on ar.id = c.articulo_id
   where ar.categoria = 'gacha'
     and ar.codigo in ('gacha-iconos', 'gacha-titulos')
     and c.estado in ('solicitado', 'aprobado', 'entregado')
     and c.precio_pagado > 0
     and not exists (
       select 1 from public.movimientos_puntos m
        where m.matricula_id = c.matricula_id
          and m.motivo = 'Devolución del canje #' || c.id || ': se retiró de la tienda')
),
pagados as (
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  select d.matricula_id, d.precio_pagado,
         'Devolución del canje #' || d.id || ': se retiró de la tienda'
    from a_devolver d
  returning matricula_id
)
update public.canjes c
   set estado = 'cancelado', resuelto_en = now()
 where c.id in (select id from a_devolver);

-- ============================== Comprobación, en la misma transacción ==============================
-- Si algo de arriba no calzó, esto revienta y no queda a medias.

do $$
declare v_pendientes integer; v_articulos integer; v_tiradas integer;
begin
  select count(*) into v_pendientes
    from public.canjes c join public.articulos ar on ar.id = c.articulo_id
   where ar.codigo in ('gacha-iconos', 'gacha-titulos')
     and c.estado in ('solicitado', 'aprobado', 'entregado');
  if v_pendientes > 0 then
    raise exception 'Quedaron % canjes de los artículos retirados sin devolver', v_pendientes;
  end if;

  select count(*) into v_articulos
    from public.articulos where categoria = 'gacha' and activo;
  if v_articulos <> (select count(*) from public.asignaturas a, public.periodos p
                     where p.codigo = '2026-2' and a.activa) then
    raise exception 'Quedaron % artículos de gacha activos: tiene que ser uno por asignatura',
      v_articulos;
  end if;

  select count(*) into v_tiradas
    from public.articulos where codigo = 'gacha-tirada' and tiradas = 1 and activo;
  if v_tiradas = 0 then
    raise exception 'El artículo gacha-tirada no quedó con su tirada';
  end if;
end $$;
