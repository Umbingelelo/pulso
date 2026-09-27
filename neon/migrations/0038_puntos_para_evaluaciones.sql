-- Puntos para evaluaciones: se compran, se guardan y se usan cuando uno quiera.
--
-- ── Lo que cambia para el alumno ──
--
-- Antes, «0,5 puntos en una evaluación» era una solicitud: se cobraba al pedir,
-- esperaba el visto bueno y quedaba atada a la evaluación que el alumno escribió
-- en la nota. Ahora son dos pasos separados:
--
--   1. **Comprar** es inmediato. Las décimas entran a su saldo de «puntos para
--      evaluaciones», que vive en su perfil.
--   2. **Usarlas** es cuando él quiera: elige la evaluación y cuántas décimas, y
--      eso sí espera al docente, que lo marca aplicado al poner la nota. Si lo
--      rechaza, las décimas vuelven al saldo.
--
-- Lo ya entregado se mantiene y queda **disponible** en el saldo. Lo que estaba
-- esperando respuesta se entrega ahora, al precio que ya pagó.
--
-- ── Lo que cambia en el precio ──
--
-- La base sube a 1,5 veces (200/450/900 → 300/675/1350), y cada canje de décimas
-- encarece el siguiente en un 50 % **del precio base**, no del último pagado:
--
--     precio = base × (1 + 0,5 × canjes previos)
--
-- La cuenta es **compartida** entre los tres artículos —si no, bastaría con
-- comprar 0,2 cinco veces para esquivarla— y **incluye lo ya comprado**: quien ya
-- tiene un punto paga el siguiente a 1,5 veces la base. Los cancelados y
-- rechazados no cuentan, porque se devolvieron. El descuento de reunión se aplica
-- después, sobre el precio ya escalado.
--
-- ── Por qué `decimas` es una columna ──
--
-- Por lo mismo que `tiradas` en la 0031: el catálogo dice qué entrega cada
-- artículo, y la escalada sale de ahí. `categoria = 'nota'` no sirve, porque la
-- ruleta también es de nota y no entrega décimas.
--
-- Después de aplicar esto hay que correr `node neon/refrescar-api.mjs`: cambian
-- columnas de `vitrina` y hay vistas y funciones nuevas.

-- ============================== El catálogo dice cuántas décimas ==============================

alter table public.articulos
  add column if not exists decimas integer;

alter table public.articulos
  drop constraint if exists articulos_decimas_check;
alter table public.articulos
  add constraint articulos_decimas_check check (decimas is null or decimas > 0);

-- Las décimas se entregan al comprar, igual que las tiradas: lo que espera al
-- docente es el uso, no la compra.
alter table public.articulos
  drop constraint if exists articulos_decimas_sin_aprobacion;

comment on column public.articulos.decimas is
  'Cuántas décimas suma este artículo a los puntos para evaluaciones del alumno. Nulo = ninguna.';

update public.articulos a
   set decimas = v.decimas,
       precio = v.precio,
       requiere_aprobacion = false,
       descripcion = v.descripcion
  from (values
    ('decimas-02',      2,  300, 'Suma 0,2 a tus puntos para evaluaciones. Los usas desde tu perfil, en la evaluación que quieras y cuando quieras.'),
    ('decimas-05',      5,  675, 'Suma 0,5 a tus puntos para evaluaciones. Los usas desde tu perfil, en la evaluación que quieras y cuando quieras.'),
    ('punto-completo', 10, 1350, 'Suma un punto entero a tus puntos para evaluaciones. Lo usas desde tu perfil, en la evaluación que quieras y cuando quieras.')
  ) as v(codigo, decimas, precio, descripcion)
 where a.codigo = v.codigo
   and a.periodo_id = (select id from public.periodos where codigo = '2026-2');

-- Ahora sí: con los artículos ya sin aprobación, el check se puede poner.
alter table public.articulos
  add constraint articulos_decimas_sin_aprobacion
  check (decimas is null or not requiere_aprobacion);

-- ============================== La escalada ==============================
-- Pura, como `precio_con_descuento`: recibe la cuenta y no la busca. Así la usan
-- igual la vitrina —que muestra— y `solicitar_canje` —que cobra—, y no pueden
-- dar números distintos.

create or replace function public.precio_escalado(p_base integer, p_previos integer)
returns integer
language sql
immutable
as $$
  select round(p_base * (2 + greatest(p_previos, 0)) / 2.0)::integer
$$;

-- Cuántos canjes de décimas vigentes lleva una matrícula. Solo para las funciones
-- de abajo: no se otorga a la app.
create or replace function public.canjes_decimas_previos(p_matricula uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.canjes c
    join public.articulos x on x.id = c.articulo_id
   where c.matricula_id = p_matricula
     and x.decimas is not null
     and c.estado in ('solicitado', 'aprobado', 'entregado')
$$;
revoke execute on function public.canjes_decimas_previos(uuid) from public;

-- ============================== La vitrina muestra el precio de hoy ==============================
-- `precio` pasa a ser el precio **de este alumno ahora**, antes del descuento de
-- reunión. La pantalla ya aplica el descuento sobre `precio`, así que el sitio
-- publicado muestra el número correcto desde el minuto en que esto se aplica, sin
-- esperar despliegue ni refresco de la caché. `precio_base` y `decimas` van al
-- final porque `create or replace view` solo acepta columnas nuevas ahí.

create or replace view public.vitrina as
  select a.id, a.asignatura_id, a.periodo_id, a.codigo, a.nombre, a.descripcion,
         a.detalle, a.categoria, a.icono,
         case when a.decimas is not null and a.precio is not null
              then public.precio_escalado(a.precio, (
                     select count(*)::integer from public.canjes c
                       join public.articulos x on x.id = c.articulo_id
                      where c.matricula_id = mt.id and x.decimas is not null
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

-- ============================== Canjear cobra el precio escalado ==============================
-- Igual que la versión de la 0031 con dos cambios: el precio de un artículo con
-- décimas sale de `precio_escalado`, y la matrícula se bloquea al entrar. Sin el
-- bloqueo, dos compras simultáneas verían la misma cuenta previa y pagarían las
-- dos el precio viejo —y, de paso, las dos verían el mismo saldo—.

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
                  then public.precio_escalado(a.precio, public.canjes_decimas_previos(p_matricula))
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

  -- Las décimas no necesitan una línea aparte: el saldo sale de los canjes
  -- entregados menos los usos, y este canje ya quedó entregado.
  return v_canje;
end;
$$;

-- ============================== Los usos ==============================
-- Un uso es «aplica N décimas a tal evaluación». Como `canjes`, no tiene políticas
-- de escritura: todo pasa por las funciones que comprueban el saldo.

create table if not exists public.usos_decimas (
  id                 bigint primary key generated always as identity,
  matricula_id       uuid not null references public.matriculas(id) on delete cascade,
  decimas            integer not null check (decimas > 0),
  evaluacion         text not null check (length(trim(evaluacion)) between 1 and 120),
  estado             text not null default 'solicitado'
                       check (estado in ('solicitado', 'aplicado', 'rechazado', 'cancelado')),
  comentario_docente text,
  creado_en          timestamptz not null default now(),
  resuelto_en        timestamptz,
  resuelto_por       uuid references public.docentes(id)
);

create index if not exists ix_usos_decimas_matricula  on public.usos_decimas (matricula_id);
create index if not exists ix_usos_decimas_pendientes on public.usos_decimas (estado) where estado = 'solicitado';

alter table public.usos_decimas enable row level security;

drop policy if exists "usos_decimas: los mios" on public.usos_decimas;
create policy "usos_decimas: los mios" on public.usos_decimas for select to pulso_app
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

grant select on public.usos_decimas to pulso_app;

-- Lo que tiene el alumno. Un uso pendiente ya **no está disponible**: si no, podría
-- pedir las mismas décimas para dos evaluaciones mientras el docente no responde.
create or replace function public.decimas_disponibles(p_matricula uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (coalesce((select sum(x.decimas) from public.canjes c
                      join public.articulos x on x.id = c.articulo_id
                     where c.matricula_id = p_matricula and x.decimas is not null
                       and c.estado = 'entregado'), 0)
        - coalesce((select sum(u.decimas) from public.usos_decimas u
                     where u.matricula_id = p_matricula
                       and u.estado in ('solicitado', 'aplicado')), 0))::integer
$$;
revoke execute on function public.decimas_disponibles(uuid) from public;

create or replace view public.saldos_decimas with (security_invoker = true) as
  select mt.id as matricula_id,
         coalesce((select sum(x.decimas) from public.canjes c
                     join public.articulos x on x.id = c.articulo_id
                    where c.matricula_id = mt.id and x.decimas is not null
                      and c.estado = 'entregado'), 0)::integer as ganadas,
         coalesce((select sum(u.decimas) from public.usos_decimas u
                    where u.matricula_id = mt.id and u.estado = 'solicitado'), 0)::integer as pendientes,
         coalesce((select sum(u.decimas) from public.usos_decimas u
                    where u.matricula_id = mt.id and u.estado = 'aplicado'), 0)::integer as aplicadas
    from public.matriculas mt;

grant select on public.saldos_decimas to pulso_app;

create or replace view public.usos_decimas_detalle with (security_invoker = true) as
  select u.id, u.matricula_id, u.decimas, u.evaluacion, u.estado, u.comentario_docente,
         u.creado_en, u.resuelto_en,
         pf.id as perfil_id, pf.nombre as alumno, pf.avatar,
         s.codigo as seccion, s.asignatura_id, s.periodo_id
    from public.usos_decimas u
    join public.matriculas mt on mt.id = u.matricula_id
    join public.perfiles   pf on pf.id = mt.perfil_id
    join public.secciones  s  on s.id = mt.seccion_id;

grant select on public.usos_decimas_detalle to pulso_app;

create or replace function public.usar_decimas(
  p_matricula uuid, p_decimas integer, p_evaluacion text)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare v_disp integer; v_id bigint;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;
  if p_decimas is null or p_decimas <= 0 then
    raise exception 'Elige cuántas décimas quieres usar';
  end if;
  if nullif(trim(p_evaluacion), '') is null then
    raise exception 'Escribe en qué evaluación las quieres usar';
  end if;

  -- El mismo bloqueo que al comprar: dos usos simultáneos no gastan el mismo saldo.
  perform 1 from public.matriculas where id = p_matricula for update;

  v_disp := public.decimas_disponibles(p_matricula);
  if p_decimas > v_disp then
    raise exception 'No te alcanzan: tienes % décimas disponibles', v_disp;
  end if;

  insert into public.usos_decimas (matricula_id, decimas, evaluacion)
  values (p_matricula, p_decimas, left(trim(p_evaluacion), 120))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cancelar_uso_decimas(p_uso bigint)
returns void language plpgsql volatile security definer set search_path = public as $$
declare u public.usos_decimas%rowtype;
begin
  select * into u from public.usos_decimas where id = p_uso;
  if u.id is null then raise exception 'Ese uso no existe'; end if;
  if not public.mi_matricula(u.matricula_id) then
    raise exception 'Ese uso no es tuyo';
  end if;
  if u.estado <> 'solicitado' then
    raise exception 'Ya no se puede cancelar: está %', u.estado;
  end if;
  update public.usos_decimas set estado = 'cancelado', resuelto_en = now() where id = p_uso;
end;
$$;

create or replace function public.resolver_uso_decimas(
  p_uso bigint, p_estado text, p_comentario text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare u public.usos_decimas%rowtype;
begin
  select * into u from public.usos_decimas where id = p_uso;
  if u.id is null then raise exception 'Ese uso no existe'; end if;
  if not public.docente_ve_matricula(u.matricula_id) then
    raise exception 'Ese uso no es de una sección que dictes';
  end if;
  if p_estado not in ('aplicado', 'rechazado') then
    raise exception 'Estado no válido: %', p_estado;
  end if;
  if u.estado <> 'solicitado' then
    raise exception 'Ese uso ya está %', u.estado;
  end if;

  -- Rechazar no mueve nada más: el saldo se calcula, y un uso rechazado deja de
  -- restar solo.
  update public.usos_decimas
     set estado = p_estado,
         comentario_docente = nullif(trim(p_comentario), ''),
         resuelto_en = now(), resuelto_por = public.usuario_actual()
   where id = p_uso;
end;
$$;

grant execute on function
  public.precio_escalado(integer, integer),
  public.usar_decimas(uuid, integer, text),
  public.cancelar_uso_decimas(bigint),
  public.resolver_uso_decimas(bigint, text, text)
  to pulso_app;

-- ============================== Clonar el catálogo copia lo que entrega ==============================
-- Sin esto, el semestre que viene los artículos de décimas llegarían sin `decimas`
-- y se venderían como algo que no suma nada. Se agrega `tiradas` por la misma
-- razón: faltaba desde la 0031.

create or replace function public.clonar_catalogo(
  p_asignatura uuid, p_periodo_origen uuid, p_periodo_destino uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_n integer;
begin
  if not exists (select 1 from public.docente_asignaturas
                  where docente_id = public.usuario_actual()
                    and asignatura_id = p_asignatura and periodo_id = p_periodo_destino) then
    raise exception 'No dictas esa asignatura en el periodo de destino';
  end if;

  insert into public.articulos (asignatura_id, periodo_id, codigo, nombre, descripcion, detalle,
                                categoria, icono, precio, requiere_aprobacion, stock,
                                limite_por_alumno, activo, orden, tiradas, decimas)
  select a.asignatura_id, p_periodo_destino, a.codigo, a.nombre, a.descripcion, a.detalle,
         a.categoria, a.icono, a.precio, a.requiere_aprobacion, a.stock,
         a.limite_por_alumno, a.activo, a.orden, a.tiradas, a.decimas
    from public.articulos a
   where a.asignatura_id = p_asignatura and a.periodo_id = p_periodo_origen
  on conflict (asignatura_id, periodo_id, codigo) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ============================== Lo que estaba esperando, se entrega ==============================
-- Al precio que ya pagaron: nadie paga la diferencia por haber pedido antes.

update public.canjes c
   set estado = 'entregado',
       resuelto_en = now(),
       comentario_docente = coalesce(comentario_docente,
         'Entregado a tus puntos para evaluaciones: úsalo desde tu perfil cuando quieras.')
  from public.articulos x
 where x.id = c.articulo_id
   and x.decimas is not null
   and c.estado in ('solicitado', 'aprobado');

-- ============================== Comprobación, en la misma transacción ==============================

do $$
declare v_pend integer; v_sin integer; v_prueba integer;
begin
  select count(*) into v_pend
    from public.canjes c join public.articulos x on x.id = c.articulo_id
   where x.decimas is not null and c.estado in ('solicitado', 'aprobado');
  if v_pend > 0 then
    raise exception 'Quedaron % canjes de décimas sin entregar', v_pend;
  end if;

  select count(*) into v_sin
    from public.articulos
   where codigo in ('decimas-02', 'decimas-05', 'punto-completo') and activo
     and periodo_id = (select id from public.periodos where codigo = '2026-2')
     and (decimas is null or requiere_aprobacion);
  if v_sin > 0 then
    raise exception 'Quedaron % artículos de décimas sin configurar', v_sin;
  end if;

  v_prueba := public.precio_escalado(1350, 0) + public.precio_escalado(1350, 1)
            + public.precio_escalado(1350, 2);
  if v_prueba <> 1350 + 2025 + 2700 then
    raise exception 'La escalada no da lo esperado: %', v_prueba;
  end if;
end $$;
