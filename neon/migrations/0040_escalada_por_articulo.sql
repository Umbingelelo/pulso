-- Los puntos para evaluaciones escalan por artículo, y lo comprado hasta hoy se anula.
--
-- ── La escalada deja de ser compartida ──
--
-- Desde la 0038 cada canje de décimas encarecía **los tres** artículos: quien
-- compraba un 0,2 pagaba el siguiente 0,5 y el siguiente punto a 1,5 veces su base.
-- Eso castigaba justo a quien empezaba por lo barato. Ahora cada artículo cuenta
-- solo sus propias compras:
--
--     precio = base × (1 + 0,5 × canjes previos de ese mismo artículo)
--
-- El argumento de la 0038 para compartirla —que comprando 0,2 cinco veces se
-- esquivaba la escalada— ya no se sostiene: el tope de 3 por artículo corta eso en
-- la tercera compra, y cada 0,2 sube el siguiente 0,2.
--
-- ── Lo comprado se anula ──
--
-- Las compras vigentes se pagaron con la regla vieja, así que se devuelve cada una
-- entera —`precio_pagado`, que ya trae el descuento de reunión que se haya
-- aplicado— y el canje pasa a `cancelado`. Con eso las décimas salen del saldo:
-- quien las quiera las vuelve a comprar con el precio nuevo, que para la primera
-- de cada artículo es la base.
--
-- Los usos todavía pendientes se cancelan también: usaban décimas que dejan de
-- existir, y dejarlos vivos pondría el saldo en negativo. Si hubiera un uso ya
-- **aplicado** la migración se detiene, porque esas décimas ya están en una nota y
-- no se pueden retirar desde acá.
--
-- La devolución deja su marca en el motivo, y un canje cancelado no vuelve a
-- entrar: correr esto dos veces no regala puntos.
--
-- Después de aplicar esto hay que correr `node neon/refrescar-api.mjs`: cambia la
-- vista `vitrina` y la firma de `canjes_decimas_previos`.

-- ============================== Antes de tocar nada ==============================

do $$
declare v_aplicados integer;
begin
  select count(*) into v_aplicados from public.usos_decimas where estado = 'aplicado';
  if v_aplicados > 0 then
    raise exception 'Hay % usos de décimas ya aplicados: no se pueden anular sus compras', v_aplicados;
  end if;
end $$;

-- ============================== La cuenta es por artículo ==============================

drop function if exists public.canjes_decimas_previos(uuid);

create or replace function public.canjes_decimas_previos(p_matricula uuid, p_articulo uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.canjes c
   where c.matricula_id = p_matricula
     and c.articulo_id = p_articulo
     and c.estado in ('solicitado', 'aprobado', 'entregado')
$$;
revoke execute on function public.canjes_decimas_previos(uuid, uuid) from public;

-- ============================== La vitrina ==============================
-- Igual que la de la 0038, con la cuenta del precio restringida al mismo artículo.
-- Es la misma cuenta que `ya_canjeados`: lo que el alumno ve como «llevas N» es lo
-- que le sube el precio.

create or replace view public.vitrina as
  select a.id, a.asignatura_id, a.periodo_id, a.codigo, a.nombre, a.descripcion,
         a.detalle, a.categoria, a.icono,
         case when a.decimas is not null and a.precio is not null
              then public.precio_escalado(a.precio, (
                     select count(*)::integer from public.canjes c
                      where c.matricula_id = mt.id and c.articulo_id = a.id
                        and c.estado = any (array['solicitado','aprobado','entregado'])))
              else a.precio end as precio,
         a.requiere_aprobacion, a.stock,
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
         a.tiradas,
         a.precio as precio_base,
         a.decimas
    from public.articulos a
    join public.secciones s on s.asignatura_id = a.asignatura_id
                           and s.periodo_id = a.periodo_id
    join public.matriculas mt on mt.seccion_id = s.id
   where a.activo and mt.activa;

grant select on public.vitrina to pulso_app;

-- ============================== Canjear cobra lo mismo que muestra ==============================
-- Igual que la de la 0038; solo cambia la llamada a `canjes_decimas_previos`.

create or replace function public.solicitar_canje(
  p_matricula uuid, p_articulo uuid, p_nota text default null)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare
  a public.articulos%rowtype; v_saldo integer; v_mios integer; v_todos integer;
  v_estado text; v_canje bigint;
  v_seccion uuid; v_desc integer; v_lista integer; v_precio integer;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  perform 1 from public.matriculas where id = p_matricula for update;

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

  v_lista := case when a.decimas is not null
                  then public.precio_escalado(a.precio,
                         public.canjes_decimas_previos(p_matricula, p_articulo))
                  else a.precio end;
  v_desc   := public.reunion_descuento(v_seccion);
  v_precio := public.precio_con_descuento(v_lista, v_desc);

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

  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (p_matricula, -v_precio,
          'Canje: ' || a.nombre ||
          case when v_desc > 0 then ' (−' || v_desc || '% por reunión)' else '' end);

  if a.tiradas is not null then
    insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
    values (p_matricula, a.tiradas, 'Canje #' || v_canje || ': ' || a.nombre);
  end if;

  return v_canje;
end;
$$;

-- ============================== Los usos pendientes se cancelan ==============================

update public.usos_decimas
   set estado = 'cancelado',
       resuelto_en = now(),
       comentario_docente = coalesce(comentario_docente,
         'Se anularon las compras de puntos para evaluaciones y se devolvieron los puntos. '
         || 'Vuelve a comprarlas con el precio nuevo y pide el uso otra vez.')
 where estado = 'solicitado';

-- ============================== La devolución ==============================

with a_devolver as (
  select c.id, c.matricula_id, c.precio_pagado
    from public.canjes c
    join public.articulos x on x.id = c.articulo_id
   where x.decimas is not null
     and c.estado in ('solicitado', 'aprobado', 'entregado')
     and not exists (
       select 1 from public.movimientos_puntos m
        where m.matricula_id = c.matricula_id
          and m.motivo = 'Devolución del canje #' || c.id || ': cambió el precio de los puntos para evaluaciones')
),
pagados as (
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  select d.matricula_id, d.precio_pagado,
         'Devolución del canje #' || d.id || ': cambió el precio de los puntos para evaluaciones'
    from a_devolver d
  returning matricula_id
)
update public.canjes c
   set estado = 'cancelado',
       resuelto_en = now(),
       comentario_docente =
         'Anulado: cambió el precio de los puntos para evaluaciones y se te devolvió lo pagado.'
 where c.id in (select id from a_devolver);

-- ============================== Comprobación, en la misma transacción ==============================

do $$
declare v_vivos integer; v_pend integer; v_neg integer; v_sin integer;
begin
  select count(*) into v_vivos
    from public.canjes c join public.articulos x on x.id = c.articulo_id
   where x.decimas is not null and c.estado in ('solicitado', 'aprobado', 'entregado');
  if v_vivos > 0 then
    raise exception 'Quedaron % compras de décimas vigentes', v_vivos;
  end if;

  select count(*) into v_pend from public.usos_decimas where estado = 'solicitado';
  if v_pend > 0 then
    raise exception 'Quedaron % usos de décimas pendientes', v_pend;
  end if;

  select count(*) into v_neg
    from public.saldos_decimas where ganadas - pendientes - aplicadas < 0;
  if v_neg > 0 then
    raise exception 'Quedaron % saldos de décimas en negativo', v_neg;
  end if;

  -- Toda compra anulada tiene exactamente una devolución de lo que pagó.
  select count(*) into v_sin
    from public.canjes c join public.articulos x on x.id = c.articulo_id
   where x.decimas is not null and c.estado = 'cancelado'
     and c.comentario_docente like 'Anulado: cambió el precio%'
     and (select count(*) from public.movimientos_puntos m
           where m.matricula_id = c.matricula_id and m.puntos = c.precio_pagado
             and m.motivo = 'Devolución del canje #' || c.id
                            || ': cambió el precio de los puntos para evaluaciones') <> 1;
  if v_sin > 0 then
    raise exception 'Quedaron % compras anuladas sin su devolución', v_sin;
  end if;
end $$;
