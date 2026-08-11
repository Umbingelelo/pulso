-- Pulso sobre Neon — esquema completo.
--
-- Consolida las once migraciones de Supabase en un solo archivo, adaptado a un
-- Postgres sin Supabase. Tres cosas cambian; todo lo demás es idéntico.
--
-- 1 · LA IDENTIDAD ES NUESTRA. Supabase traía `auth.users` y un servicio de
--     login. Acá vive en `usuarios`, y quien autentica es la capa de API en
--     Vercel: recibe correo y contraseña, compara contra el hash bcrypt y firma
--     una cookie de sesión. El navegador nunca le habla a un tercero.
--
-- 2 · `auth.uid()` PASA A SER `usuario_actual()`, que lee una variable de sesión
--     de Postgres. La API abre una transacción, hace
--     `set_config('pulso.usuario_id', <id>, true)` y desde ahí el RLS funciona
--     exactamente como antes: las ~30 políticas se conservan casi tal cual.
--
-- 3 · UN SOLO ROL DE APLICACIÓN, `pulso_app`, en vez de `anon` y
--     `authenticated`. La diferencia entre visitante y alumno ya no la hace el
--     rol de Postgres sino si hay `pulso.usuario_id` puesto: sin él,
--     `usuario_actual()` devuelve null y las políticas que dependen de la
--     identidad no calzan con nada.
--
-- OJO con dos cosas al tocar este archivo:
--
--   * `pulso_app` **no es el dueño** de las tablas, y eso es a propósito: el RLS
--     no se aplica al dueño. Si la API se conectara con el rol dueño, todas las
--     políticas se saltarían en silencio y no habría ningún error que lo delate.
--   * Por lo mismo **no** se usa `force row level security`: las funciones
--     `security definer` corren como dueño y necesitan saltarse el RLS para
--     poder otorgar puntos. Forzarlo rompería los triggers.

-- ============================== Rol de la aplicación ==============================
-- La contraseña se define al crearlo desde fuera; acá solo se asegura que exista.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pulso_app') then
    create role pulso_app login;
  end if;
end
$$;

-- ============================== Identidad ==============================

create table if not exists public.usuarios (
  id         uuid primary key default gen_random_uuid(),
  correo     text not null,
  clave_hash text not null,               -- bcrypt, calculado en la capa de API
  creado_en  timestamptz not null default now(),
  ultimo_ingreso timestamptz,
  constraint usuarios_correo_check check (position('@' in correo) > 1)
);

-- El correo no distingue mayúsculas: nadie se registra dos veces por escribir
-- Juan@duocuc.cl y juan@duocuc.cl.
create unique index if not exists ux_usuarios_correo on public.usuarios (lower(correo));

-- ============================== Catálogo ==============================

create table if not exists public.periodos (
  id     uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  inicio date,
  fin    date,
  activo boolean not null default true
);

create table if not exists public.asignaturas (
  id     uuid primary key default gen_random_uuid(),
  sigla  text not null unique,
  nombre text not null,
  activa boolean not null default true
);

create table if not exists public.secciones (
  id            uuid primary key default gen_random_uuid(),
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  periodo_id    uuid not null references public.periodos(id)    on delete restrict,
  codigo        text not null,
  activa        boolean not null default true,
  unique (asignatura_id, periodo_id, codigo)
);

create index if not exists ix_secciones_periodo on public.secciones (periodo_id);

-- ============================== Personas y matrículas ==============================

create table if not exists public.perfiles (
  id        uuid primary key references public.usuarios(id) on delete cascade,
  nombre    text not null check (length(trim(nombre)) >= 3),
  avatar    text not null default 'thumbs:inicial',
  creado_en timestamptz not null default now()
);

create table if not exists public.docentes (
  id        uuid primary key references public.usuarios(id) on delete cascade,
  nombre    text not null,
  creado_en timestamptz not null default now()
);

create table if not exists public.docente_asignaturas (
  docente_id    uuid not null references public.docentes(id)    on delete cascade,
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  periodo_id    uuid not null references public.periodos(id)    on delete cascade,
  primary key (docente_id, asignatura_id, periodo_id)
);

create table if not exists public.matriculas (
  id         uuid primary key default gen_random_uuid(),
  perfil_id  uuid not null references public.perfiles(id)  on delete cascade,
  seccion_id uuid not null references public.secciones(id) on delete restrict,
  creado_en  timestamptz not null default now(),
  activa     boolean not null default true,
  unique (perfil_id, seccion_id)
);

create index if not exists ix_matriculas_perfil  on public.matriculas (perfil_id);
create index if not exists ix_matriculas_seccion on public.matriculas (seccion_id);

-- ============================== Puntos ==============================

create table if not exists public.movimientos_puntos (
  id           bigint primary key generated always as identity,
  matricula_id uuid not null references public.matriculas(id) on delete cascade,
  puntos       integer not null,
  motivo       text not null,
  creado_en    timestamptz not null default now()
);

create index if not exists ix_movimientos_matricula on public.movimientos_puntos (matricula_id);

-- ============================== Actividades ==============================

create table if not exists public.actividades (
  id            uuid primary key default gen_random_uuid(),
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  periodo_id    uuid not null references public.periodos(id)    on delete restrict,
  codigo        text not null,
  titulo        text not null,
  descripcion   text,
  tipo          text not null default 'diagnostico'
    check (tipo in ('diagnostico', 'laboratorio', 'entrega')),
  puntos        integer not null default 0,
  orden         integer not null default 0,
  activa        boolean not null default true,
  unique (asignatura_id, periodo_id, codigo)
);

create index if not exists ix_actividades_ambito on public.actividades (asignatura_id, periodo_id);

create table if not exists public.resultados_actividad (
  id            bigint primary key generated always as identity,
  actividad_id  uuid not null references public.actividades(id) on delete cascade,
  matricula_id  uuid not null references public.matriculas(id)  on delete cascade,
  detalle       jsonb not null default '{}'::jsonb,
  completada_en timestamptz not null default now(),
  unique (actividad_id, matricula_id)
);

create index if not exists ix_resultados_matricula on public.resultados_actividad (matricula_id);

-- ============================== Diagnóstico ==============================

create table if not exists public.diagnostico_secciones (
  id           uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references public.actividades(id) on delete cascade,
  codigo       text not null,
  titulo       text not null,
  umbral       integer not null default 0,
  repaso       text,
  critica      boolean not null default false,
  intro        text,
  orden        integer not null default 0,
  unique (actividad_id, codigo)
);

create table if not exists public.diagnostico_preguntas (
  id          uuid primary key default gen_random_uuid(),
  seccion_id  uuid not null references public.diagnostico_secciones(id) on delete cascade,
  orden       integer not null,
  enunciado   text not null,
  codigo      text,
  opciones    jsonb not null,
  correcta    integer,
  explicacion text,
  unique (seccion_id, orden),
  constraint diagnostico_opciones_es_arreglo check (jsonb_typeof(opciones) = 'array'),
  constraint diagnostico_correcta_en_rango
    check (correcta is null or (correcta >= 0 and correcta < jsonb_array_length(opciones)))
);

create index if not exists ix_diag_secciones_actividad on public.diagnostico_secciones (actividad_id);
create index if not exists ix_diag_preguntas_seccion   on public.diagnostico_preguntas (seccion_id);

-- ============================== Tienda ==============================

create table if not exists public.articulos (
  id            uuid primary key default gen_random_uuid(),
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  periodo_id    uuid not null references public.periodos(id)    on delete cascade,
  codigo        text not null,
  nombre        text not null,
  descripcion   text,
  detalle       text,
  categoria     text not null default 'apoyo'
    check (categoria in ('nota', 'evaluacion', 'plazo', 'apoyo', 'equipo', 'comodin')),
  icono         text,
  precio              integer check (precio is null or precio > 0),
  requiere_aprobacion boolean not null default true,
  stock               integer check (stock is null or stock >= 0),
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
  precio_pagado      integer not null,
  nota_alumno        text,
  comentario_docente text,
  creado_en   timestamptz not null default now(),
  resuelto_en timestamptz,
  resuelto_por uuid references public.docentes(id)
);

create index if not exists ix_articulos_ambito  on public.articulos (asignatura_id, periodo_id);
create index if not exists ix_canjes_matricula  on public.canjes (matricula_id);
create index if not exists ix_canjes_articulo   on public.canjes (articulo_id);
create index if not exists ix_canjes_pendientes on public.canjes (estado) where estado = 'solicitado';

-- ============================================================================
-- Quién pregunta
-- ============================================================================
-- Reemplaza a `auth.uid()`. La capa de API pone la variable al abrir la
-- transacción; si no está puesta —una consulta sin sesión, como el desplegable
-- del registro— devuelve null y las políticas que dependen de la identidad no
-- calzan con nada. El `true` de `current_setting` es «no revientes si no existe».

create or replace function public.usuario_actual()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('pulso.usuario_id', true), '')::uuid;
$$;
