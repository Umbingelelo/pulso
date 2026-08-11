-- Actividades por asignatura y periodo; resultados por matrícula.
--
-- El código de una actividad era único en toda la base, así que no podían
-- coexistir dos `diagnostico-entrada`. Ahora es único dentro de (asignatura,
-- periodo): cada ramo tiene su diagnóstico y sus laboratorios, cada semestre.

-- ====================== Actividades por periodo ======================

alter table public.actividades
  add column if not exists periodo_id uuid references public.periodos(id) on delete restrict;

update public.actividades
   set periodo_id = (select id from public.periodos where codigo = '2026-2')
 where periodo_id is null;

alter table public.actividades alter column periodo_id set not null;

alter table public.actividades drop constraint if exists actividades_codigo_key;
alter table public.actividades add constraint actividades_asignatura_periodo_codigo_key
  unique (asignatura_id, periodo_id, codigo);

create index if not exists ix_actividades_ambito on public.actividades (asignatura_id, periodo_id);

-- ====================== Resultados por matrícula ======================

alter table public.resultados_actividad
  add column if not exists matricula_id uuid references public.matriculas(id) on delete cascade;

update public.resultados_actividad r
   set matricula_id = (
     select mt.id from public.matriculas mt
      where mt.perfil_id = r.perfil_id
      order by mt.creado_en
      limit 1)
 where r.matricula_id is null;

delete from public.resultados_actividad where matricula_id is null;

alter table public.resultados_actividad alter column matricula_id set not null;
alter table public.resultados_actividad
  drop constraint if exists resultados_actividad_actividad_id_perfil_id_key;
alter table public.resultados_actividad drop column if exists perfil_id;
alter table public.resultados_actividad add constraint resultados_actividad_actividad_matricula_key
  unique (actividad_id, matricula_id);

create index if not exists ix_resultados_matricula on public.resultados_actividad (matricula_id);

-- ============ La actividad tiene que ser del ramo que cursa ============
-- El RLS ya lo impide, pero esto lo deja garantizado también para el docente y
-- para cualquier cosa que escriba con `service role`. Sin esto, un alumno podía
-- registrar el resultado de un laboratorio de otra asignatura y cobrar los puntos.

create or replace function public.validar_resultado_calza()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
      from public.matriculas  mt
      join public.secciones   s on s.id = mt.seccion_id
      join public.actividades a on a.id = new.actividad_id
     where mt.id = new.matricula_id
       and mt.activa
       and a.activa
       and a.asignatura_id = s.asignatura_id
       and a.periodo_id    = s.periodo_id
  ) then
    raise exception 'La actividad no corresponde a esa matrícula';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_resultado_calza on public.resultados_actividad;
create trigger tr_resultado_calza
  before insert on public.resultados_actividad
  for each row execute function public.validar_resultado_calza();

-- ====================== Puntos: del perfil a la matrícula ======================

create or replace function public.otorgar_puntos_actividad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_puntos integer;
  v_titulo text;
begin
  select puntos, titulo into v_puntos, v_titulo
    from public.actividades where id = new.actividad_id;

  if coalesce(v_puntos, 0) = 0 then
    return new;
  end if;

  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (new.matricula_id, v_puntos, v_titulo);

  return new;
end;
$$;

-- La bienvenida pasa a ser por matrícula: son 100 puntos al entrar a un ramo,
-- no 100 por tener cuenta. Quien curse dos ramos empieza cada uno en 100.
create or replace function public.otorgar_puntos_bienvenida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sigla text;
begin
  select a.sigla into v_sigla
    from public.secciones s
    join public.asignaturas a on a.id = s.asignatura_id
   where s.id = new.seccion_id;

  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (new.id, 100, 'Bienvenida a ' || coalesce(v_sigla, 'la asignatura'));

  return new;
end;
$$;

drop trigger if exists tr_puntos_bienvenida on public.perfiles;
drop trigger if exists tr_puntos_bienvenida on public.matriculas;
create trigger tr_puntos_bienvenida
  after insert on public.matriculas
  for each row execute function public.otorgar_puntos_bienvenida();

-- ====================== El registro crea perfil + matrícula ======================

create or replace function public.crear_perfil_al_registrarse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre  text;
  v_seccion uuid;
begin
  v_nombre := nullif(trim(new.raw_user_meta_data->>'nombre'), '');

  begin
    v_seccion := (new.raw_user_meta_data->>'seccion_id')::uuid;
  exception when others then
    v_seccion := null;
  end;

  if v_nombre is null then
    return new;
  end if;

  insert into public.perfiles (id, nombre)
  values (new.id, v_nombre)
  on conflict (id) do nothing;

  -- Sin sección válida se crea igual el perfil y la app ofrece matricularse
  -- después: el registro no se cae por eso.
  if v_seccion is not null and exists (
        select 1 from public.secciones s
          join public.periodos p on p.id = s.periodo_id
         where s.id = v_seccion and s.activa and p.activo) then
    insert into public.matriculas (perfil_id, seccion_id)
    values (new.id, v_seccion)
    on conflict (perfil_id, seccion_id) do nothing;
  end if;

  return new;
end;
$$;
