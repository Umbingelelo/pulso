-- La tienda de canjes.
--
-- Los puntos ya existían y solo crecían. Esto les da salida, sin romper la regla
-- que sostiene todo lo demás: el libro de movimientos **solo se agrega**. Un
-- canje inserta un movimiento negativo; un rechazo inserta uno positivo que lo
-- devuelve. Nunca se edita ni se borra una línea, así que el saldo siempre se
-- puede reconstruir sumando, y queda auditable quién canjeó qué y cuándo.
--
-- El catálogo es por (asignatura, periodo), igual que las actividades: cada ramo
-- pone sus propios precios, y el semestre siguiente se clona y se ajusta.

create table if not exists public.articulos (
  id            uuid primary key default gen_random_uuid(),
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  periodo_id    uuid not null references public.periodos(id)    on delete cascade,
  codigo        text not null,
  nombre        text not null,
  descripcion   text,
  detalle       text,                       -- la letra chica: condiciones de uso
  categoria     text not null default 'apoyo'
    check (categoria in ('nota', 'evaluacion', 'plazo', 'apoyo', 'equipo', 'comodin')),
  icono         text,                       -- un emoji, para la vitrina
  -- null = todavía sin precio. Se muestra como «próximamente» y no se puede canjear.
  precio              integer check (precio is null or precio > 0),
  requiere_aprobacion boolean not null default true,
  stock               integer check (stock is null or stock >= 0),  -- null = ilimitado
  limite_por_alumno   integer default 1 check (limite_por_alumno is null or limite_por_alumno > 0),
  activo              boolean not null default true,
  orden               integer not null default 0,
  unique (asignatura_id, periodo_id, codigo)
);

create table if not exists public.canjes (
  id            bigint primary key generated always as identity,
  articulo_id   uuid not null references public.articulos(id)  on delete restrict,
  matricula_id  uuid not null references public.matriculas(id) on delete cascade,
  estado        text not null default 'solicitado'
    check (estado in ('solicitado', 'aprobado', 'entregado', 'rechazado', 'cancelado')),
  -- Se congela el precio del momento: si mañana sube, el canje ya hecho no cambia.
  precio_pagado      integer not null,
  nota_alumno        text,
  comentario_docente text,
  creado_en   timestamptz not null default now(),
  resuelto_en timestamptz,
  resuelto_por uuid references public.docentes(id)
);

alter table public.articulos enable row level security;
alter table public.canjes    enable row level security;

create index if not exists ix_articulos_ambito  on public.articulos (asignatura_id, periodo_id);
create index if not exists ix_canjes_matricula  on public.canjes (matricula_id);
create index if not exists ix_canjes_articulo   on public.canjes (articulo_id);
create index if not exists ix_canjes_pendientes on public.canjes (estado) where estado = 'solicitado';

-- ====================== Helper de ámbito ======================

create or replace function public.cursa_articulo(p_articulo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.matriculas mt
      join public.secciones  s on s.id = mt.seccion_id
      join public.articulos  a on a.asignatura_id = s.asignatura_id
                              and a.periodo_id    = s.periodo_id
     where mt.perfil_id = auth.uid()
       and mt.activa
       and a.id = p_articulo);
$$;

create or replace function public.docente_ve_articulo(p_articulo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.articulos a
      join public.docente_asignaturas da
        on da.asignatura_id = a.asignatura_id
       and da.periodo_id    = a.periodo_id
     where a.id = p_articulo
       and da.docente_id = auth.uid());
$$;

-- ====================== La vitrina del alumno ======================
-- Trae, además del artículo, lo que el alumno necesita para decidir: si le
-- alcanza, cuánto le queda de su límite y si todavía hay stock.

drop view if exists public.vitrina;
create view public.vitrina
with (security_invoker = true) as
  select a.*,
         mt.id as matricula_id,
         coalesce((select sum(m.puntos) from public.movimientos_puntos m
                    where m.matricula_id = mt.id), 0)::integer as saldo,
         (select count(*) from public.canjes c
           where c.articulo_id = a.id and c.matricula_id = mt.id
             and c.estado in ('solicitado', 'aprobado', 'entregado'))::integer as ya_canjeados,
         (select count(*) from public.canjes c
           where c.articulo_id = a.id
             and c.estado in ('solicitado', 'aprobado', 'entregado'))::integer as colocados
    from public.articulos  a
    join public.secciones  s  on s.asignatura_id = a.asignatura_id
                             and s.periodo_id    = a.periodo_id
    join public.matriculas mt on mt.seccion_id = s.id
   where a.activo and mt.activa;

-- ====================== Canjear ======================

create or replace function public.solicitar_canje(
  p_matricula uuid,
  p_articulo  uuid,
  p_nota      text default null
)
returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  a       public.articulos%rowtype;
  v_saldo integer;
  v_mios  integer;
  v_todos integer;
  v_estado text;
  v_canje bigint;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select * into a from public.articulos where id = p_articulo;
  if a.id is null or not a.activo then
    raise exception 'Ese artículo no está disponible';
  end if;

  -- El artículo tiene que ser del mismo ramo que la matrícula.
  if not exists (
    select 1 from public.matriculas mt
      join public.secciones s on s.id = mt.seccion_id
     where mt.id = p_matricula and mt.activa
       and s.asignatura_id = a.asignatura_id
       and s.periodo_id    = a.periodo_id) then
    raise exception 'Ese artículo no es de este ramo';
  end if;

  if a.precio is null then
    raise exception 'Ese artículo todavía no tiene precio';
  end if;

  select coalesce(sum(puntos), 0) into v_saldo
    from public.movimientos_puntos where matricula_id = p_matricula;

  if v_saldo < a.precio then
    raise exception 'No te alcanzan los puntos: cuesta % y tienes %', a.precio, v_saldo;
  end if;

  select count(*) into v_mios from public.canjes
   where articulo_id = p_articulo and matricula_id = p_matricula
     and estado in ('solicitado', 'aprobado', 'entregado');

  if a.limite_por_alumno is not null and v_mios >= a.limite_por_alumno then
    raise exception 'Ya alcanzaste el máximo de % para este artículo', a.limite_por_alumno;
  end if;

  if a.stock is not null then
    select count(*) into v_todos from public.canjes
     where articulo_id = p_articulo and estado in ('solicitado', 'aprobado', 'entregado');
    if v_todos >= a.stock then
      raise exception 'Se agotó';
    end if;
  end if;

  -- Lo que no necesita visto bueno se entrega en el acto.
  v_estado := case when a.requiere_aprobacion then 'solicitado' else 'entregado' end;

  insert into public.canjes (articulo_id, matricula_id, estado, precio_pagado, nota_alumno,
                             resuelto_en)
  values (p_articulo, p_matricula, v_estado, a.precio, nullif(trim(p_nota), ''),
          case when v_estado = 'entregado' then now() end)
  returning id into v_canje;

  -- Los puntos se descuentan al solicitar, no al aprobar: así nadie compromete
  -- el mismo saldo dos veces mientras espera respuesta.
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (p_matricula, -a.precio, 'Canje: ' || a.nombre);

  return v_canje;
end;
$$;

-- ====================== Resolver (docente) ======================

create or replace function public.resolver_canje(
  p_canje      bigint,
  p_estado     text,
  p_comentario text default null
)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  c      public.canjes%rowtype;
  v_nom  text;
begin
  select * into c from public.canjes where id = p_canje;
  if c.id is null then
    raise exception 'Ese canje no existe';
  end if;

  if not public.docente_ve_matricula(c.matricula_id) then
    raise exception 'Ese canje no es de una sección que dictes';
  end if;

  if p_estado not in ('aprobado', 'entregado', 'rechazado') then
    raise exception 'Estado no válido: %', p_estado;
  end if;

  if c.estado in ('rechazado', 'cancelado') then
    raise exception 'Ese canje ya está cerrado';
  end if;

  if p_estado = 'rechazado' and c.estado = 'entregado' then
    raise exception 'No se puede rechazar algo ya entregado';
  end if;

  select nombre into v_nom from public.articulos where id = c.articulo_id;

  update public.canjes
     set estado = p_estado,
         comentario_docente = coalesce(nullif(trim(p_comentario), ''), comentario_docente),
         resuelto_en = now(),
         resuelto_por = auth.uid()
   where id = p_canje;

  -- Rechazar devuelve los puntos con una línea nueva: el libro no se edita.
  if p_estado = 'rechazado' then
    insert into public.movimientos_puntos (matricula_id, puntos, motivo)
    values (c.matricula_id, c.precio_pagado, 'Devolución: ' || coalesce(v_nom, 'canje rechazado'));
  end if;
end;
$$;

-- ====================== Cancelar (alumno) ======================

create or replace function public.cancelar_canje(p_canje bigint)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  c     public.canjes%rowtype;
  v_nom text;
begin
  select * into c from public.canjes where id = p_canje;
  if c.id is null then
    raise exception 'Ese canje no existe';
  end if;

  if not public.mi_matricula(c.matricula_id) then
    raise exception 'Ese canje no es tuyo';
  end if;

  -- Solo mientras nadie lo ha revisado. Después ya no es del alumno.
  if c.estado <> 'solicitado' then
    raise exception 'Ya no se puede cancelar: está %', c.estado;
  end if;

  select nombre into v_nom from public.articulos where id = c.articulo_id;

  update public.canjes
     set estado = 'cancelado', resuelto_en = now()
   where id = p_canje;

  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (c.matricula_id, c.precio_pagado, 'Devolución: ' || coalesce(v_nom, 'canje cancelado'));
end;
$$;

-- ====================== Clonar el catálogo al semestre siguiente ======================

create or replace function public.clonar_catalogo(
  p_asignatura      uuid,
  p_periodo_origen  uuid,
  p_periodo_destino uuid
)
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not exists (select 1 from public.docente_asignaturas
                  where docente_id = auth.uid()
                    and asignatura_id = p_asignatura
                    and periodo_id = p_periodo_destino) then
    raise exception 'No dictas esa asignatura en el periodo de destino';
  end if;

  insert into public.articulos (asignatura_id, periodo_id, codigo, nombre, descripcion, detalle,
                                categoria, icono, precio, requiere_aprobacion, stock,
                                limite_por_alumno, activo, orden)
  select a.asignatura_id, p_periodo_destino, a.codigo, a.nombre, a.descripcion, a.detalle,
         a.categoria, a.icono, a.precio, a.requiere_aprobacion, a.stock,
         a.limite_por_alumno, a.activo, a.orden
    from public.articulos a
   where a.asignatura_id = p_asignatura
     and a.periodo_id = p_periodo_origen
  on conflict (asignatura_id, periodo_id, codigo) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ====================== RLS ======================

create policy "articulos: los de mis ramos" on public.articulos
  for select to authenticated
  using ((activo and public.cursa_articulo(id)) or public.docente_ve_articulo(id));

create policy "canjes: los míos" on public.canjes
  for select to authenticated
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

-- Sin insert, update ni delete directos: todo pasa por las funciones de arriba,
-- que son las que cobran, devuelven y comprueban el stock. Si el alumno pudiera
-- insertar en `canjes` se llevaría el artículo sin pagar.

revoke execute on function public.cursa_articulo(uuid)                    from public, anon;
revoke execute on function public.docente_ve_articulo(uuid)               from public, anon;
revoke execute on function public.solicitar_canje(uuid, uuid, text)       from public, anon;
revoke execute on function public.resolver_canje(bigint, text, text)      from public, anon;
revoke execute on function public.cancelar_canje(bigint)                  from public, anon;
revoke execute on function public.clonar_catalogo(uuid, uuid, uuid)       from public, anon;

grant execute on function public.cursa_articulo(uuid)               to authenticated;
grant execute on function public.docente_ve_articulo(uuid)          to authenticated;
grant execute on function public.solicitar_canje(uuid, uuid, text)  to authenticated;
grant execute on function public.resolver_canje(bigint, text, text) to authenticated;
grant execute on function public.cancelar_canje(bigint)             to authenticated;
grant execute on function public.clonar_catalogo(uuid, uuid, uuid)  to authenticated;
