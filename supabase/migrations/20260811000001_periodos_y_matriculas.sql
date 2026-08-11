-- Periodos académicos y matrículas.
--
-- Antes: un alumno era una fila de `perfiles` con una `seccion_id`, así que solo
-- podía cursar una asignatura y no había forma de distinguir un semestre de otro.
--
-- Ahora: `perfiles` es la persona, `matriculas` es «esta persona cursa esta
-- sección», y una sección pertenece a una asignatura *en un periodo*. Un alumno
-- puede tener varias matrículas, en el mismo semestre o en semestres distintos.

-- Las vistas y las políticas cuelgan de las columnas que este archivo elimina,
-- así que salen primero. La 0003 rehace las vistas y la 0005 el RLS completo.
drop view if exists public.resumen_alumnos;
drop view if exists public.saldos_puntos;

drop policy if exists "movimientos propios: leer"          on public.movimientos_puntos;
drop policy if exists "docentes ven todos los movimientos" on public.movimientos_puntos;
drop policy if exists "docentes otorgan puntos"            on public.movimientos_puntos;
drop policy if exists "resultado propio: leer"             on public.resultados_actividad;
drop policy if exists "resultado propio: crear"            on public.resultados_actividad;
drop policy if exists "docentes ven todos los resultados"  on public.resultados_actividad;
drop policy if exists "perfil propio: leer"                on public.perfiles;
drop policy if exists "perfil propio: crear"               on public.perfiles;
drop policy if exists "perfil propio: actualizar"          on public.perfiles;
drop policy if exists "docentes ven todos los perfiles"    on public.perfiles;

-- ============================ Periodos ============================

create table if not exists public.periodos (
  id     uuid primary key default gen_random_uuid(),
  codigo text not null unique,                      -- '2026-2', '2027-1'
  nombre text not null,                             -- 'Segundo semestre 2026'
  inicio date,
  fin    date,
  activo boolean not null default true              -- false = ya no admite matrículas
);

alter table public.periodos enable row level security;

insert into public.periodos (codigo, nombre, inicio, fin)
values ('2026-2', 'Segundo semestre 2026', '2026-08-04', '2026-12-13')
on conflict (codigo) do nothing;

-- ====================== Secciones por periodo ======================
-- La misma asignatura se dicta cada semestre con secciones distintas. El código
-- de sección ('001D') se repite entre asignaturas y entre periodos, así que la
-- unicidad es la terna completa.

alter table public.secciones
  add column if not exists periodo_id uuid references public.periodos(id) on delete restrict;

update public.secciones
   set periodo_id = (select id from public.periodos where codigo = '2026-2')
 where periodo_id is null;

alter table public.secciones alter column periodo_id set not null;

alter table public.secciones drop constraint if exists secciones_asignatura_id_codigo_key;
alter table public.secciones add constraint secciones_asignatura_periodo_codigo_key
  unique (asignatura_id, periodo_id, codigo);

create index if not exists ix_secciones_periodo on public.secciones (periodo_id);

-- ============================ Matrículas ============================

create table if not exists public.matriculas (
  id         uuid primary key default gen_random_uuid(),
  perfil_id  uuid not null references public.perfiles(id)  on delete cascade,
  seccion_id uuid not null references public.secciones(id) on delete restrict,
  creado_en  timestamptz not null default now(),
  activa     boolean not null default true,
  unique (perfil_id, seccion_id)
);

alter table public.matriculas enable row level security;

create index if not exists ix_matriculas_perfil  on public.matriculas (perfil_id);
create index if not exists ix_matriculas_seccion on public.matriculas (seccion_id);

-- Cada perfil que ya existía se convierte en una matrícula, conservando su fecha.
insert into public.matriculas (perfil_id, seccion_id, creado_en)
select p.id, p.seccion_id, p.creado_en
  from public.perfiles p
 where p.seccion_id is not null
on conflict (perfil_id, seccion_id) do nothing;

-- ===================== Los puntos son de la matrícula =====================
-- El saldo cuelga de (alumno, sección, periodo): lo que gana en un ramo lo gasta
-- en ese ramo, y el semestre siguiente parte limpio sin tener que resetear nada.

alter table public.movimientos_puntos
  add column if not exists matricula_id uuid references public.matriculas(id) on delete cascade;

update public.movimientos_puntos m
   set matricula_id = (
     select mt.id from public.matriculas mt
      where mt.perfil_id = m.perfil_id
      order by mt.creado_en
      limit 1)
 where m.matricula_id is null;

-- Un movimiento sin matrícula sería de un perfil borrado: no debería existir.
delete from public.movimientos_puntos where matricula_id is null;

alter table public.movimientos_puntos alter column matricula_id set not null;
alter table public.movimientos_puntos drop column if exists perfil_id;

create index if not exists ix_movimientos_matricula on public.movimientos_puntos (matricula_id);

-- ================== perfiles: la sección se fue a matrículas ==================

alter table public.perfiles drop column if exists seccion_id;
