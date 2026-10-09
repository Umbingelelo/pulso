-- La ruleta de nota se tira dentro de Pulso.
--
-- «No dar la prueba y tirar la ruleta» (`ruleta-nota`, 1.800 puntos) promete un
-- sorteo: 50% un 1,0 · 40% un 4,0 · 9% un 5,0 · 0,8% un 6,0 · 0,2% un 7,0. Hasta
-- hoy el docente lo resolvía con una ruleta de una página externa —casi ninguna
-- admite pesos distintos— y escribía el resultado a mano en «Entregar». Eso tiene
-- tres problemas: el sorteo no es verificable por nadie, el 0,2% se parece mucho a
-- un «giré hasta que saliera lo que quería», y el resultado no queda en la base,
-- solo en lo que el docente se acuerde de teclear.
--
-- ── El servidor decide, la rueda solo lo muestra ──
--
-- `tirar_ruleta` hace el sorteo en la base, una sola vez, y guarda el resultado en
-- el canje **en la misma transacción** que lo cierra. La pantalla recibe la nota
-- ya decidida y recién entonces gira hacia ella. Girar la rueda no es tirar: si se
-- cierra la pestaña a mitad de la animación el sorteo ya ocurrió, y no hay forma de
-- «volver a girar» porque el canje dejó de estar solicitado.
--
-- ── Pesos por mil, en tabla ──
--
-- 500 · 400 · 90 · 8 · 2 suman 1000, así que cada porcentaje es exacto y el 0,2%
-- es un entero: 2 de 1000. Con enteros no hay deriva de punto flotante en los
-- pesos, y el sorteo usa el mismo mecanismo que el gacha: **un** `random()`
-- escalado al total, sin repetirlo dentro de la comparación (que lo evaluaría una
-- vez por fila y dejaría de respetar los pesos). Viven en `ruleta_tramos` y no en
-- la función por lo mismo que los del gacha: la rueda del navegador se dibuja con
-- esas mismas filas, así que lo que se ve y lo que se sortea no pueden separarse.
--
-- `orden` es el orden **en la rueda**, no el de las notas. Va 1,0 · 6,0 · 4,0 ·
-- 7,0 · 5,0 para que los dos tramos finos (6,0 y 7,0) no queden pegados entre sí y
-- cada uno tenga a ambos lados un color distinto que lo haga visible.
--
-- El sorteo vive en `ruleta_sortear()`, aparte, para que sea **lo que se mide**:
-- `probar-ruleta.mjs` lo llama veinte mil veces sin tocar ningún canje y compara
-- las frecuencias con los pesos. No se le da permiso a `pulso_app`: no hace falta
-- y no hay por qué dejar que cualquiera pida sorteos sueltos.
--
-- ── Quién puede tirar, y cuántas veces ──
--
-- Solo un docente que ve esa matrícula, solo un canje de `ruleta-nota` y solo si
-- sigue `solicitado`. La fila se bloquea con `for update` antes de mirar el estado:
-- dos clics, o dos pestañas, esperan en la cola y el segundo encuentra el canje ya
-- entregado y falla. Sin el bloqueo ambos leerían «solicitado» y sortearían dos
-- veces, quedándose el docente con la que más le gustara.
--
-- ── `resolver_canje` ya no entrega la ruleta ──
--
-- Se reemplaza el cuerpo (misma firma, el frontend desplegado la sigue llamando
-- igual) para que «entregar» o «aprobar» un canje de la ruleta falle con «La
-- ruleta se resuelve tirándola». Si no, el botón viejo —o un RPC directo— cerraría
-- el canje sin sorteo y habría una nota entregada a dedo. **Rechazar** sigue
-- valiendo, con su devolución: es lo que se hace cuando el alumno la pidió por
-- error o la evaluación ya pasó.
--
-- Al mismo reemplazo se le agregó `for update` en la lectura del canje, y lo mismo
-- a `cancelar_canje`. Eran lecturas sin bloqueo: si el docente tira la ruleta justo
-- mientras el alumno cancela, ambas veían «solicitado» y el alumno quedaba con la
-- nota **y** con sus 1.800 puntos de vuelta. Ahora el segundo espera y encuentra
-- el canje ya cerrado.
--
-- ── Dónde queda el resultado ──
--
-- En `canjes.ruleta_nota` y `canjes.ruleta_en`, además del texto de
-- `comentario_docente` que el alumno ya lee en la tienda («Respuesta: …»). Las dos
-- columnas se agregan **al final** de `canjes_detalle` con `create or replace`:
-- sin soltar la vista, que el frontend desplegado está leyendo. Hasta que la Data
-- API recargue su caché el campo no llega, y nada depende de él todavía.

-- ============================== Los tramos ==============================

create table if not exists public.ruleta_tramos (
  nota  numeric(2,1) primary key check (nota >= 1.0 and nota <= 7.0),
  peso  integer      not null check (peso > 0),
  orden smallint     not null unique
);

insert into public.ruleta_tramos (nota, peso, orden) values
  (1.0, 500, 1),
  (6.0,   8, 2),
  (4.0, 400, 3),
  (7.0,   2, 4),
  (5.0,  90, 5)
on conflict (nota) do update
  set peso = excluded.peso, orden = excluded.orden;

grant select on public.ruleta_tramos to pulso_app;

-- ============================== Dónde queda lo que salió ==============================

alter table public.canjes
  add column if not exists ruleta_nota numeric(2,1)
    check (ruleta_nota is null or (ruleta_nota >= 1.0 and ruleta_nota <= 7.0)),
  add column if not exists ruleta_en   timestamptz;

create or replace view public.canjes_detalle with (security_invoker = true) as
  select c.id, c.estado, c.precio_pagado, c.nota_alumno, c.comentario_docente,
         c.creado_en, c.resuelto_en, c.matricula_id, c.articulo_id,
         ar.codigo as articulo_codigo, ar.nombre as articulo, ar.icono, ar.categoria,
         ar.requiere_aprobacion,
         mt.perfil_id, pf.nombre as alumno, pf.avatar,
         s.codigo as seccion, a.id as asignatura_id, a.sigla,
         p.id as periodo_id, p.codigo as periodo,
         c.ruleta_nota, c.ruleta_en
    from public.canjes      c
    join public.articulos   ar on ar.id = c.articulo_id
    join public.matriculas  mt on mt.id = c.matricula_id
    join public.perfiles    pf on pf.id = mt.perfil_id
    join public.secciones   s  on s.id  = mt.seccion_id
    join public.asignaturas a  on a.id  = s.asignatura_id
    join public.periodos    p  on p.id  = s.periodo_id;

grant select on public.canjes_detalle to pulso_app;

-- ============================== El sorteo ==============================

create or replace function public.ruleta_sortear()
returns numeric language plpgsql volatile security definer set search_path = public as $$
declare v_dado double precision; v_nota numeric;
begin
  -- Un solo `random()`, fuera de la consulta. Dentro de la comparación se evaluaría
  -- una vez por fila y el sorteo dejaría de respetar los pesos.
  v_dado := random();

  select t.nota into v_nota
    from (select r.nota, r.orden,
                 sum(r.peso) over (order by r.orden)  as hasta,
                 sum(r.peso) over ()                  as total
            from public.ruleta_tramos r) t
   where v_dado * t.total < t.hasta
   order by t.orden
   limit 1;

  if v_nota is null then
    raise exception 'La ruleta no tiene tramos';
  end if;
  return v_nota;
end;
$$;

revoke all on function public.ruleta_sortear() from public;
revoke all on function public.ruleta_sortear() from pulso_app;

-- ============================== Tirarla ==============================

create or replace function public.tirar_ruleta(p_canje bigint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  c        public.canjes%rowtype;
  v_codigo text;
  v_nota   numeric;
  v_canje  jsonb;
begin
  -- Primero se comprueba quién pregunta, sin bloquear nada: un alumno curioso no
  -- tiene por qué poder retener la fila de un canje que no es suyo.
  select * into c from public.canjes where id = p_canje;
  if c.id is null then raise exception 'Ese canje no existe'; end if;
  if not public.docente_ve_matricula(c.matricula_id) then
    raise exception 'Ese canje no es de una sección que dictes';
  end if;

  select codigo into v_codigo from public.articulos where id = c.articulo_id;
  if v_codigo is distinct from 'ruleta-nota' then
    raise exception 'Ese canje no es de la ruleta';
  end if;

  -- Ahora sí el bloqueo, y el estado se mira **después**: quien llegó segundo
  -- espera acá, y cuando el primero termina `for update` devuelve la fila ya
  -- actualizada.
  select * into c from public.canjes where id = p_canje for update;
  if c.estado <> 'solicitado' then
    raise exception 'Ese canje ya no está esperando: está %', c.estado;
  end if;

  v_nota := public.ruleta_sortear();

  update public.canjes
     set estado = 'entregado',
         ruleta_nota = v_nota,
         ruleta_en = now(),
         comentario_docente = 'La ruleta salió ' || replace(to_char(v_nota, 'FM0.0'), '.', ',')
           || case when nullif(trim(c.nota_alumno), '') is not null
                   then ' · se aplica a «' || trim(c.nota_alumno) || '»' else '' end,
         resuelto_en = now(),
         resuelto_por = public.usuario_actual()
   where id = p_canje
  returning to_jsonb(canjes.*) into v_canje;

  return jsonb_build_object(
    'nota', v_nota,
    'tramos', (select jsonb_agg(jsonb_build_object('nota', t.nota, 'peso', t.peso) order by t.orden)
                 from public.ruleta_tramos t),
    'canje', v_canje);
end;
$$;

grant execute on function public.tirar_ruleta(bigint) to pulso_app;

-- ============================== `resolver_canje`: la ruleta no se entrega ==============================
-- Misma firma que la de la 0003. Lo único nuevo: el `for update` de la lectura y el
-- rechazo de «entregado»/«aprobado» para un canje de `ruleta-nota`.

create or replace function public.resolver_canje(
  p_canje bigint, p_estado text, p_comentario text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c public.canjes%rowtype; v_nom text; v_codigo text;
begin
  select * into c from public.canjes where id = p_canje for update;
  if c.id is null then raise exception 'Ese canje no existe'; end if;
  if not public.docente_ve_matricula(c.matricula_id) then
    raise exception 'Ese canje no es de una sección que dictes';
  end if;
  if p_estado not in ('aprobado','entregado','rechazado') then
    raise exception 'Estado no válido: %', p_estado;
  end if;
  if c.estado in ('rechazado','cancelado') then
    raise exception 'Ese canje ya está cerrado';
  end if;
  if p_estado = 'rechazado' and c.estado = 'entregado' then
    raise exception 'No se puede rechazar algo ya entregado';
  end if;

  select nombre, codigo into v_nom, v_codigo from public.articulos where id = c.articulo_id;

  if p_estado in ('aprobado','entregado') and v_codigo = 'ruleta-nota' then
    raise exception 'La ruleta se resuelve tirándola';
  end if;

  update public.canjes
     set estado = p_estado,
         comentario_docente = coalesce(nullif(trim(p_comentario), ''), comentario_docente),
         resuelto_en = now(), resuelto_por = public.usuario_actual()
   where id = p_canje;

  -- Rechazar devuelve los puntos con una línea nueva: el libro no se edita.
  if p_estado = 'rechazado' then
    insert into public.movimientos_puntos (matricula_id, puntos, motivo)
    values (c.matricula_id, c.precio_pagado, 'Devolución: ' || coalesce(v_nom, 'canje rechazado'));
  end if;
end;
$$;

-- ============================== `cancelar_canje`: el mismo bloqueo ==============================
-- Igual a la de la 0003 salvo el `for update`.

create or replace function public.cancelar_canje(p_canje bigint)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c public.canjes%rowtype; v_nom text;
begin
  select * into c from public.canjes where id = p_canje for update;
  if c.id is null then raise exception 'Ese canje no existe'; end if;
  if not public.mi_matricula(c.matricula_id) then
    raise exception 'Ese canje no es tuyo';
  end if;
  -- Solo mientras nadie lo ha revisado. Después ya no es del alumno.
  if c.estado <> 'solicitado' then
    raise exception 'Ya no se puede cancelar: está %', c.estado;
  end if;

  select nombre into v_nom from public.articulos where id = c.articulo_id;
  update public.canjes set estado = 'cancelado', resuelto_en = now() where id = p_canje;
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (c.matricula_id, c.precio_pagado, 'Devolución: ' || coalesce(v_nom, 'canje cancelado'));
end;
$$;

-- ============================== Comprobación ==============================

do $$
declare v_suma integer; v_n integer;
begin
  select coalesce(sum(peso), 0), count(*) into v_suma, v_n from public.ruleta_tramos;
  if v_suma <> 1000 then
    raise exception 'Los pesos de la ruleta suman % y tienen que sumar 1000', v_suma;
  end if;
  if v_n <> 5 then
    raise exception 'La ruleta tiene % tramos y tienen que ser 5', v_n;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'canjes_detalle'
                    and column_name = 'ruleta_nota') then
    raise exception 'canjes_detalle no trae ruleta_nota';
  end if;
  if (select ruleta_sortear()) is null then
    raise exception 'ruleta_sortear no devolvió nada';
  end if;
end $$;
