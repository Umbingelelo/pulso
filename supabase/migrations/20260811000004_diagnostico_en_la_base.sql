-- El diagnóstico se muda del código a la base.
--
-- Vivía en `src/app/diagnostico.datos.ts`, con la alternativa correcta en un
-- campo `ok:` y la explicación al lado. Dos problemas, los dos graves:
--
--   1. El repositorio es público. La pauta estaba a un clic de cualquiera.
--   2. El archivo se compila en el bundle, así que la pauta viajaba al navegador
--      del alumno aunque el repo fuera privado.
--
-- Y además corregía el cliente: `entregar()` calculaba los puntajes en el
-- navegador y los posteaba. Cualquiera podía enviar el puntaje que quisiera.
--
-- Ahora las preguntas viven acá, `correcta` y `explicacion` no tienen política de
-- lectura para el alumno, y se rinde por una función que corrige en el servidor.
-- El alumno solo ve la pauta después de entregar, que es cuando le sirve.

create table if not exists public.diagnostico_secciones (
  id           uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references public.actividades(id) on delete cascade,
  codigo       text not null,                     -- 'A', 'B', …
  titulo       text not null,
  umbral       integer not null default 0,        -- bajo esto, hay que nivelar
  repaso       text,                              -- qué repasar si quedó bajo
  critica      boolean not null default false,
  intro        text,
  orden        integer not null default 0,
  unique (actividad_id, codigo)
);

create table if not exists public.diagnostico_preguntas (
  id          uuid primary key default gen_random_uuid(),
  seccion_id  uuid not null references public.diagnostico_secciones(id) on delete cascade,
  orden       integer not null,                   -- 1, 2, 3… dentro de la sección
  enunciado   text not null,
  codigo      text,                               -- bloque de código, opcional
  opciones    jsonb not null,                     -- ["…","…"] sin el «No sé»
  correcta    integer,                            -- null = encuesta, no puntúa
  explicacion text,
  unique (seccion_id, orden),
  constraint diagnostico_opciones_es_arreglo check (jsonb_typeof(opciones) = 'array'),
  constraint diagnostico_correcta_en_rango
    check (correcta is null or (correcta >= 0 and correcta < jsonb_array_length(opciones)))
);

alter table public.diagnostico_secciones enable row level security;
alter table public.diagnostico_preguntas enable row level security;

create index if not exists ix_diag_secciones_actividad on public.diagnostico_secciones (actividad_id);
create index if not exists ix_diag_preguntas_seccion  on public.diagnostico_preguntas (seccion_id);

-- ====================== Resolver el diagnóstico del ramo ======================

create or replace function public.actividad_diagnostico(p_matricula uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id
    from public.matriculas  mt
    join public.secciones   s on s.id = mt.seccion_id
    join public.actividades a on a.asignatura_id = s.asignatura_id
                             and a.periodo_id    = s.periodo_id
   where mt.id = p_matricula
     and a.tipo = 'diagnostico'
     and a.activa
   order by a.orden
   limit 1;
$$;

-- ====================== El cuestionario, sin la pauta ======================
-- Devuelve `correcta` y `explicacion` solo si el alumno ya entregó. Antes de eso
-- viajan en null: la pauta no sale de la base.

create or replace function public.diagnostico_cuestionario(p_matricula uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actividad uuid;
  v_rendido   boolean;
  v_detalle   jsonb;
  v_act       jsonb;
  v_secs      jsonb;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  v_actividad := public.actividad_diagnostico(p_matricula);
  if v_actividad is null then
    return null;
  end if;

  select jsonb_build_object(
           'id', a.id, 'codigo', a.codigo, 'titulo', a.titulo,
           'descripcion', a.descripcion, 'puntos', a.puntos)
    into v_act
    from public.actividades a
   where a.id = v_actividad;

  select r.detalle
    into v_detalle
    from public.resultados_actividad r
   where r.actividad_id = v_actividad
     and r.matricula_id = p_matricula;

  v_rendido := v_detalle is not null;

  select coalesce(jsonb_agg(t.sec order by t.orden), '[]'::jsonb)
    into v_secs
    from (
      select ds.orden,
             jsonb_build_object(
               'codigo',  ds.codigo,
               'titulo',  ds.titulo,
               'umbral',  ds.umbral,
               'repaso',  ds.repaso,
               'critica', ds.critica,
               'intro',   ds.intro,
               'preguntas', (
                 select coalesce(jsonb_agg(
                          jsonb_build_object(
                            'orden',       dp.orden,
                            'enunciado',   dp.enunciado,
                            'codigo',      dp.codigo,
                            -- «No sé» se agrega acá y no se guarda: es siempre la última
                            'opciones',    dp.opciones || jsonb_build_array('No sé'),
                            'puntua',      dp.correcta is not null,
                            'correcta',    case when v_rendido then to_jsonb(dp.correcta)    end,
                            'explicacion', case when v_rendido then to_jsonb(dp.explicacion) end
                          ) order by dp.orden), '[]'::jsonb)
                   from public.diagnostico_preguntas dp
                  where dp.seccion_id = ds.id
               )
             ) as sec
        from public.diagnostico_secciones ds
       where ds.actividad_id = v_actividad
    ) t;

  return jsonb_build_object(
    'actividad',  v_act,
    'rendido',    v_rendido,
    'puntajes',   coalesce(v_detalle -> 'puntajes',   '{}'::jsonb),
    'respuestas', coalesce(v_detalle -> 'respuestas', '{}'::jsonb),
    'secciones',  v_secs);
end;
$$;

-- ====================== Rendir: corrige el servidor ======================
-- `p_respuestas` es {"A1": 0, "A2": 3, …}: código de sección + orden de la
-- pregunta → índice de la alternativa marcada.

create or replace function public.rendir_diagnostico(p_matricula uuid, p_respuestas jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actividad uuid;
  v_puntajes  jsonb := '{}'::jsonb;
  v_faltan    integer;
  r           record;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  if p_respuestas is null or jsonb_typeof(p_respuestas) <> 'object' then
    raise exception 'Respuestas mal formadas';
  end if;

  v_actividad := public.actividad_diagnostico(p_matricula);
  if v_actividad is null then
    raise exception 'No hay diagnóstico disponible para ese ramo';
  end if;

  if exists (select 1 from public.resultados_actividad
              where actividad_id = v_actividad and matricula_id = p_matricula) then
    raise exception 'Ya rendiste este diagnóstico';
  end if;

  -- Se rinde completo: «No sé» es una respuesta válida, dejarla en blanco no.
  select count(*)
    into v_faltan
    from public.diagnostico_secciones ds
    join public.diagnostico_preguntas dp on dp.seccion_id = ds.id
   where ds.actividad_id = v_actividad
     and (p_respuestas ->> (ds.codigo || dp.orden::text)) is null;

  if v_faltan > 0 then
    raise exception 'Faltan % preguntas por responder', v_faltan;
  end if;

  for r in
    select ds.codigo,
           count(*) filter (
             where dp.correcta is not null
               and (p_respuestas ->> (ds.codigo || dp.orden::text)) ~ '^[0-9]+$'
               and (p_respuestas ->> (ds.codigo || dp.orden::text))::integer = dp.correcta
           ) as aciertos
      from public.diagnostico_secciones ds
      join public.diagnostico_preguntas dp on dp.seccion_id = ds.id
     where ds.actividad_id = v_actividad
     group by ds.codigo
  loop
    v_puntajes := v_puntajes || jsonb_build_object(r.codigo, r.aciertos);
  end loop;

  -- El trigger de puntos se dispara acá: el alumno nunca escribe en el libro.
  insert into public.resultados_actividad (actividad_id, matricula_id, detalle)
  values (v_actividad, p_matricula,
          jsonb_build_object('puntajes', v_puntajes, 'respuestas', p_respuestas, 'version', 2));

  return public.diagnostico_cuestionario(p_matricula);
end;
$$;

-- ====================== Resumen para el docente ======================

create or replace function public.diagnostico_resumen(p_actividad uuid)
returns table (
  codigo   text,
  titulo   text,
  umbral   integer,
  maximo   bigint,
  promedio numeric,
  bajo     bigint,
  rendidos bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.docente_ve_actividad(p_actividad) then
    raise exception 'No dictas esa asignatura';
  end if;

  return query
  with secs as (
    select ds.id, ds.codigo, ds.titulo, ds.umbral, ds.orden,
           count(*) filter (where dp.correcta is not null) as maximo
      from public.diagnostico_secciones ds
      left join public.diagnostico_preguntas dp on dp.seccion_id = ds.id
     where ds.actividad_id = p_actividad
     group by ds.id
  ),
  valores as (
    select s.codigo,
           ((r.detalle -> 'puntajes' ->> s.codigo))::numeric as valor
      from public.resultados_actividad r
      cross join secs s
     where r.actividad_id = p_actividad
       and r.detalle -> 'puntajes' ? s.codigo
  )
  select s.codigo, s.titulo, s.umbral, s.maximo,
         round(coalesce(avg(v.valor), 0), 1),
         count(*) filter (where v.valor < s.umbral),
         count(v.valor)
    from secs s
    left join valores v on v.codigo = s.codigo
   group by s.codigo, s.titulo, s.umbral, s.maximo, s.orden
   order by s.orden;
end;
$$;

-- Nada de esto es para el visitante anónimo.
revoke execute on function public.diagnostico_cuestionario(uuid) from anon;
revoke execute on function public.rendir_diagnostico(uuid, jsonb) from anon;
revoke execute on function public.diagnostico_resumen(uuid)       from anon;
revoke execute on function public.actividad_diagnostico(uuid)     from anon;
