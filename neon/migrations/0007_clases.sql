-- Las clases: el material que el alumno abre y por el que gana puntos.
--
-- Los decks son HTML autocontenidos —fuentes, CSS, imágenes y JS incrustados, cero
-- referencias externas— así que se sirven tal cual, sin adaptarlos. El archivo
-- vive en Vercel Blob **privado**, no en el repositorio: el repo es público y los
-- apuntes docentes y el material de semanas que aún no llegan no tienen por qué
-- estar a la vista. La ruta al blob se guarda acá, y `pulso_app` no puede leer esa
-- columna (ver los grants por columna al final).
--
-- Los puntos se reparten en tres tramos, porque abrir y estudiar no son lo mismo:
--
--   * `puntos_abrir`     una vez, al abrirla por primera vez;
--   * `puntos_actividad` por cada quiz del deck que responda **bien**, una vez cada uno;
--   * `puntos_terminar`  una vez, al llegar a la última diapositiva.
--
-- La pauta de los quiz se extrae del deck al subirlo y se guarda en `pauta`. El
-- navegador reporta lo que el alumno respondió; quién acertó lo decide Postgres.
-- Ojo con la letra chica: el `data-correcta` sigue estando en el HTML que el
-- alumno descarga, así que quien abra las herramientas del navegador puede verlo.
-- Es material de estudio, no una evaluación: estos puntos empujan a repasar, no
-- miden. Lo que mide son el diagnóstico y los laboratorios.

-- ============================== Tablas ==============================

create table if not exists public.clases (
  id            uuid primary key default gen_random_uuid(),
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  periodo_id    uuid not null references public.periodos(id)    on delete restrict,
  codigo        text not null,                 -- 'S01', 'D1', 'D2'…
  titulo        text not null,
  descripcion   text,
  orden         integer not null default 0,
  dictada_el    date,                          -- para ordenar y para que el alumno se ubique

  -- Dónde está el archivo y cómo se corrige. Ninguna de las dos es legible por
  -- el rol de la aplicación.
  archivo       text not null,                 -- pathname dentro del store de Blob
  pauta         jsonb not null default '{}'::jsonb,  -- {"0":"c","1":"a"} índice de quiz → alternativa

  slides        integer not null default 0,
  actividades   integer not null default 0,    -- cuántos quiz con pauta trae el deck

  puntos_abrir     integer not null default 5,
  puntos_actividad integer not null default 10,
  puntos_terminar  integer not null default 20,

  -- Cuántos segundos como mínimo tiene que pasar entre abrirla y darla por
  -- terminada. Sin esto, saltar a la última diapositiva paga lo mismo que
  -- recorrerla. Se calcula al subir el deck como 15 s por diapositiva.
  segundos_minimos integer not null default 0,

  -- Null = escrita pero no publicada. Así el deck de la próxima semana puede
  -- estar cargado sin que nadie lo vea antes de tiempo.
  publicada_desde  timestamptz,

  creada_en     timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  unique (asignatura_id, periodo_id, codigo)
);

create index if not exists ix_clases_ambito on public.clases (asignatura_id, periodo_id);

-- Una fila por alumno y clase. `aciertos` guarda los índices de quiz que ya se
-- pagaron, para que responder bien dos veces no cobre dos veces.
create table if not exists public.progreso_clase (
  matricula_id uuid not null references public.matriculas(id) on delete cascade,
  clase_id     uuid not null references public.clases(id)     on delete cascade,
  abierta_en   timestamptz not null default now(),
  vista_en     timestamptz not null default now(),
  slide_max    integer not null default 0,
  aciertos     integer[] not null default '{}'::integer[],
  terminada_en timestamptz,
  primary key (matricula_id, clase_id)
);

create index if not exists ix_progreso_clase_matricula on public.progreso_clase (matricula_id);

-- ============================== Helpers del RLS ==============================
-- Mismo patrón que `cursa_articulo` / `docente_ve_articulo`: `security definer`
-- para no reevaluar el RLS de la tabla consultada dentro de la política.

create or replace function public.cursa_clase(p_clase uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.matriculas mt
      join public.secciones s on s.id = mt.seccion_id
      join public.clases    c on c.asignatura_id = s.asignatura_id
                             and c.periodo_id    = s.periodo_id
     where mt.perfil_id = public.usuario_actual() and mt.activa and c.id = p_clase);
$$;

create or replace function public.docente_ve_clase(p_clase uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clases c
      join public.docente_asignaturas da
        on da.asignatura_id = c.asignatura_id and da.periodo_id = c.periodo_id
     where c.id = p_clase and da.docente_id = public.usuario_actual());
$$;

-- La matrícula con la que este alumno cursa esta clase. Es el puente entre
-- «quién soy» y «en qué sección estoy viendo esto», y hace falta porque los
-- puntos se anotan contra la matrícula, no contra la persona.
create or replace function public.mi_matricula_de_clase(p_clase uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select mt.id from public.matriculas mt
    join public.secciones s on s.id = mt.seccion_id
    join public.clases    c on c.asignatura_id = s.asignatura_id
                           and c.periodo_id    = s.periodo_id
   where mt.perfil_id = public.usuario_actual() and mt.activa and c.id = p_clase
   limit 1;
$$;

-- ============================== Abrir una clase ==============================
-- Devuelve la ruta del archivo en Blob y, de paso, anota la visita. La llama
-- `/api/clase`, que ya validó la cookie de sesión. `security definer` porque
-- tiene que insertar en `movimientos_puntos`, donde el alumno no puede escribir.

create or replace function public.abrir_clase(p_clase uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_usuario   uuid := public.usuario_actual();
  v_clase     public.clases;
  v_matricula uuid;
  v_docente   boolean;
  v_nueva     boolean := false;
begin
  if v_usuario is null then
    raise exception 'Sin sesión';
  end if;

  select * into v_clase from public.clases where id = p_clase;
  if not found then
    raise exception 'Esa clase no existe';
  end if;

  v_docente := public.docente_ve_clase(p_clase);

  -- El docente entra siempre, publicada o no: es su material y necesita revisarlo
  -- antes de abrirlo al curso. No se le anota progreso ni se le dan puntos.
  if v_docente then
    return jsonb_build_object(
      'archivo', v_clase.archivo, 'titulo', v_clase.titulo, 'codigo', v_clase.codigo,
      'clase_id', v_clase.id, 'docente', true, 'matricula_id', null,
      'slides', v_clase.slides, 'puntos_nuevos', 0);
  end if;

  if v_clase.publicada_desde is null or v_clase.publicada_desde > now() then
    raise exception 'Esa clase todavía no está publicada';
  end if;

  v_matricula := public.mi_matricula_de_clase(p_clase);
  if v_matricula is null then
    raise exception 'Esa clase no es de un ramo que estés cursando';
  end if;

  -- `do nothing` y no `do update`: así FOUND distingue de verdad la primera
  -- apertura de una repetida, y dos pestañas abiertas a la vez no cobran dos
  -- veces. Con `do update` habría que comparar timestamps para adivinarlo.
  insert into public.progreso_clase (matricula_id, clase_id)
  values (v_matricula, p_clase)
  on conflict (matricula_id, clase_id) do nothing;
  v_nueva := found;

  if not v_nueva then
    update public.progreso_clase set vista_en = now()
     where matricula_id = v_matricula and clase_id = p_clase;
  end if;

  if v_nueva and v_clase.puntos_abrir > 0 then
    insert into public.movimientos_puntos (matricula_id, puntos, motivo)
    values (v_matricula, v_clase.puntos_abrir,
            'Abrió la clase ' || v_clase.codigo || ' · ' || v_clase.titulo);
  end if;

  return jsonb_build_object(
    'archivo', v_clase.archivo, 'titulo', v_clase.titulo, 'codigo', v_clase.codigo,
    'clase_id', v_clase.id, 'docente', false, 'matricula_id', v_matricula,
    'slides', v_clase.slides,
    'puntos_nuevos', case when v_nueva then v_clase.puntos_abrir else 0 end);
end;
$$;

-- ============================== Guardar el avance ==============================
-- El script que se inyecta al servir el deck manda acá lo que el alumno lleva:
-- en qué diapositiva va y qué respondió en cada quiz. La corrección se hace de
-- este lado, contra `pauta`.

create or replace function public.progreso_clase_guardar(
  p_clase      uuid,
  p_slide      integer,
  p_respuestas jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clase       public.clases;
  v_matricula   uuid;
  v_pr          public.progreso_clase;
  v_nuevos      integer[] := '{}'::integer[];
  v_idx         integer;
  v_llave       text;
  v_valor       text;
  v_puntos      integer := 0;
  v_termina     boolean := false;
  v_slide       integer := greatest(coalesce(p_slide, 0), 0);
begin
  select * into v_clase from public.clases where id = p_clase;
  if not found then
    raise exception 'Esa clase no existe';
  end if;

  -- El docente puede recorrer su propio deck sin que le anotemos nada.
  if public.docente_ve_clase(p_clase) then
    return jsonb_build_object('puntos_nuevos', 0, 'aciertos', 0, 'terminada', false);
  end if;

  v_matricula := public.mi_matricula_de_clase(p_clase);
  if v_matricula is null then
    raise exception 'Esa clase no es de un ramo que estés cursando';
  end if;

  select * into v_pr from public.progreso_clase
   where matricula_id = v_matricula and clase_id = p_clase;
  if not found then
    raise exception 'Abre la clase antes de guardar avance';
  end if;

  -- Quiz acertados que todavía no se han pagado. `pauta` manda: si el índice no
  -- está en la pauta, ese widget no da puntos (los de ordenar o completar no
  -- llevan alternativa correcta declarada).
  --
  -- El recorrido va en plpgsql y no en un `select ... where`: las llaves vienen
  -- del navegador, y en plpgsql el `and` corta de izquierda a derecha, así que
  -- el cast a entero solo ocurre después de comprobar que la llave es numérica.
  -- Dentro de un WHERE de SQL el planificador puede reordenar las condiciones y
  -- un `{"hola":"x"}` reventaría el cast antes de que lo filtre nada.
  for v_llave, v_valor in
    select llave, valor
      from jsonb_each_text(coalesce(p_respuestas, '{}'::jsonb)) as r(llave, valor)
  loop
    if v_llave ~ '^[0-9]{1,4}$'
       and v_clase.pauta ? v_llave
       and lower(trim(v_valor)) = lower(trim(v_clase.pauta ->> v_llave))
    then
      v_idx := v_llave::integer;
      if not (v_idx = any (v_pr.aciertos)) and not (v_idx = any (v_nuevos)) then
        v_nuevos := v_nuevos || v_idx;
      end if;
    end if;
  end loop;

  if array_length(v_nuevos, 1) > 0 and v_clase.puntos_actividad > 0 then
    v_puntos := v_puntos + array_length(v_nuevos, 1) * v_clase.puntos_actividad;
    insert into public.movimientos_puntos (matricula_id, puntos, motivo)
    values (v_matricula, array_length(v_nuevos, 1) * v_clase.puntos_actividad,
            'Resolvió ' || array_length(v_nuevos, 1) || ' actividad(es) de '
              || v_clase.codigo);
  end if;

  -- Terminar exige dos cosas: haber llegado al final y haber tardado un mínimo
  -- razonable. Saltar a la última diapositiva no es haber estudiado.
  if v_pr.terminada_en is null
     and v_clase.slides > 0
     and v_slide >= v_clase.slides - 1
     and now() - v_pr.abierta_en >= make_interval(secs => v_clase.segundos_minimos)
  then
    v_termina := true;
    if v_clase.puntos_terminar > 0 then
      v_puntos := v_puntos + v_clase.puntos_terminar;
      insert into public.movimientos_puntos (matricula_id, puntos, motivo)
      values (v_matricula, v_clase.puntos_terminar,
              'Terminó la clase ' || v_clase.codigo || ' · ' || v_clase.titulo);
    end if;
  end if;

  update public.progreso_clase
     set slide_max    = greatest(slide_max, v_slide),
         aciertos     = aciertos || v_nuevos,
         vista_en     = now(),
         terminada_en = case when v_termina then now() else terminada_en end
   where matricula_id = v_matricula and clase_id = p_clase;

  return jsonb_build_object(
    'puntos_nuevos', v_puntos,
    'aciertos', coalesce(array_length(v_pr.aciertos, 1), 0) + coalesce(array_length(v_nuevos, 1), 0),
    'terminada', v_termina or v_pr.terminada_en is not null);
end;
$$;

-- ============================== Vista para la app ==============================
-- Deliberadamente **no** trae `archivo` ni `pauta`. La app lista clases; para
-- abrir una se pasa por `/api/clase`, que es quien conoce la ruta del blob.

drop view if exists public.mis_clases;
create view public.mis_clases with (security_invoker = true) as
  select c.id, c.asignatura_id, c.periodo_id, c.codigo, c.titulo, c.descripcion,
         c.orden, c.dictada_el, c.slides, c.actividades,
         c.puntos_abrir, c.puntos_actividad, c.puntos_terminar, c.publicada_desde,
         mt.id as matricula_id,
         pr.abierta_en, pr.slide_max, pr.terminada_en,
         coalesce(array_length(pr.aciertos, 1), 0)::integer as resueltas,
         (pr.matricula_id is not null) as abierta
    from public.clases     c
    join public.secciones  s  on s.asignatura_id = c.asignatura_id
                             and s.periodo_id    = c.periodo_id
    join public.matriculas mt on mt.seccion_id = s.id
    left join public.progreso_clase pr on pr.clase_id = c.id
                                      and pr.matricula_id = mt.id
   where mt.activa
     and c.publicada_desde is not null
     and c.publicada_desde <= now();

-- ============================== Row Level Security ==============================

alter table public.clases         enable row level security;
alter table public.progreso_clase enable row level security;

create policy "clases: las de mis ramos" on public.clases for select to pulso_app
  using ((publicada_desde is not null and publicada_desde <= now() and public.cursa_clase(id))
         or public.docente_ve_clase(id));

-- Solo lectura del propio avance. No hay insert ni update para nadie: todo pasa
-- por `abrir_clase()` y `progreso_clase_guardar()`, que son las que corrigen y
-- cobran. Si el alumno pudiera escribir acá, se pondría la clase por terminada.
create policy "progreso: el mio" on public.progreso_clase for select to pulso_app
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

-- ============================== Permisos ==============================
-- Grants **por columna**: es la única forma de que una tabla sea legible sin
-- exponer dos de sus columnas. `archivo` delataría la ruta del blob y `pauta`
-- sería la respuesta de los quiz servida en bandeja.

grant select (id, asignatura_id, periodo_id, codigo, titulo, descripcion, orden,
              dictada_el, slides, actividades, puntos_abrir, puntos_actividad,
              puntos_terminar, publicada_desde, creada_en)
  on public.clases to pulso_app;

grant select on public.progreso_clase to pulso_app;
grant select on public.mis_clases     to pulso_app;

grant execute on function
  public.cursa_clase(uuid), public.docente_ve_clase(uuid),
  public.mi_matricula_de_clase(uuid),
  public.abrir_clase(uuid),
  public.progreso_clase_guardar(uuid, integer, jsonb)
  to pulso_app;
