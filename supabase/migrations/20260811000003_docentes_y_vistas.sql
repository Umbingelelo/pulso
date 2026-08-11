-- Ámbito del docente y vistas de consulta.
--
-- Antes, estar en `docentes` daba acceso a todos los alumnos de la base. Con una
-- sola asignatura y un solo docente daba lo mismo; con dos ramos y la posibilidad
-- de que entre un colega, no. Ahora un docente declara qué dicta y en qué periodo.

create table if not exists public.docente_asignaturas (
  docente_id    uuid not null references public.docentes(id)    on delete cascade,
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  periodo_id    uuid not null references public.periodos(id)    on delete cascade,
  primary key (docente_id, asignatura_id, periodo_id)
);

alter table public.docente_asignaturas enable row level security;

-- ====================== Funciones de apoyo del RLS ======================
-- Van en `security definer` a propósito: las políticas las llaman desde dentro
-- de otras políticas y, sin esto, la consulta a `docentes` volvería a evaluar el
-- RLS de `docentes` y entraría en recursión.

create or replace function public.es_docente()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.docentes d where d.id = auth.uid());
$$;

create or replace function public.docente_ve_seccion(p_seccion uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.secciones s
      join public.docente_asignaturas da
        on da.asignatura_id = s.asignatura_id
       and da.periodo_id    = s.periodo_id
     where s.id = p_seccion
       and da.docente_id = auth.uid());
$$;

create or replace function public.docente_ve_matricula(p_matricula uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.matriculas mt
     where mt.id = p_matricula
       and public.docente_ve_seccion(mt.seccion_id));
$$;

create or replace function public.docente_ve_actividad(p_actividad uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.actividades a
      join public.docente_asignaturas da
        on da.asignatura_id = a.asignatura_id
       and da.periodo_id    = a.periodo_id
     where a.id = p_actividad
       and da.docente_id = auth.uid());
$$;

-- ¿La matrícula es de quien pregunta?
create or replace function public.mi_matricula(p_matricula uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.matriculas mt
     where mt.id = p_matricula and mt.perfil_id = auth.uid());
$$;

-- ============================== Vistas ==============================
-- Todas con `security_invoker`: se ven a través del RLS de quien consulta, no
-- del dueño de la vista. Sin esto una vista es un agujero que salta las políticas.

drop view if exists public.saldos_puntos;
create view public.saldos_puntos
with (security_invoker = true) as
  select matricula_id,
         coalesce(sum(puntos), 0)::integer as saldo
    from public.movimientos_puntos
   group by matricula_id;

-- Los ramos del alumno: una fila por matrícula, con su saldo.
drop view if exists public.mis_ramos;
create view public.mis_ramos
with (security_invoker = true) as
  select mt.id            as matricula_id,
         mt.perfil_id,
         mt.activa,
         mt.creado_en,
         s.id             as seccion_id,
         s.codigo         as seccion,
         a.id             as asignatura_id,
         a.sigla,
         a.nombre         as asignatura,
         p.id             as periodo_id,
         p.codigo         as periodo,
         p.nombre         as periodo_nombre,
         p.activo         as periodo_activo,
         coalesce((select sum(m.puntos) from public.movimientos_puntos m
                    where m.matricula_id = mt.id), 0)::integer as puntos
    from public.matriculas  mt
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
    join public.periodos    p on p.id = s.periodo_id;

-- La nómina del docente. Una fila por matrícula, no por alumno: quien cursa dos
-- ramos aparece dos veces, cada una con el saldo de su ramo.
drop view if exists public.resumen_alumnos;
create view public.resumen_alumnos
with (security_invoker = true) as
  select mt.id      as matricula_id,
         pf.id      as perfil_id,
         pf.nombre,
         pf.avatar,
         mt.creado_en,
         mt.activa,
         s.id       as seccion_id,
         s.codigo   as seccion,
         a.sigla    as asignatura,
         a.nombre   as asignatura_nombre,
         pe.codigo  as periodo,
         coalesce((select sum(m.puntos) from public.movimientos_puntos m
                    where m.matricula_id = mt.id), 0)::integer as puntos
    from public.matriculas  mt
    join public.perfiles    pf on pf.id = mt.perfil_id
    join public.secciones   s  on s.id  = mt.seccion_id
    join public.asignaturas a  on a.id  = s.asignatura_id
    join public.periodos    pe on pe.id = s.periodo_id;
