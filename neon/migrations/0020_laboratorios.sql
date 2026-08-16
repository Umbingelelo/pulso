-- Los laboratorios: el enunciado y lo que el alumno va escribiendo.
--
-- Un laboratorio es una actividad de tipo `laboratorio` con un cuerpo: una lista
-- ordenada de bloques —prosa, cajas de respuesta y puntos de control— que se
-- arma al subirlo desde el Markdown de la carpeta de la asignatura.
--
-- ── Por qué bloques y no Markdown crudo ──
--
-- El enunciado trae cajas donde el alumno escribe. Si el navegador recibiera
-- Markdown, tendría que traer un intérprete y además ubicar dónde va cada caja
-- dentro del texto ya convertido. Partirlo al subir deja el trabajo hecho una
-- vez, del lado del servidor, donde se puede revisar: la app solo recorre una
-- lista y dibuja un `<textarea>` donde toca.
--
-- ── El identificador de cada caja ──
--
-- `caja{1.2}` es la llave con la que se guarda esa respuesta. Si cambia después
-- de publicar, lo que el alumno ya escribió queda huérfano: la caja aparece
-- vacía y su texto sigue en la base sin que nadie lo lea. El publicador lo
-- verifica antes de subir.

create table if not exists public.laboratorios (
  actividad_id  uuid primary key references public.actividades(id) on delete cascade,
  bloques       jsonb not null,
  minutos       integer,
  cajas         integer not null default 0,
  controles     integer not null default 0,
  actualizado_en timestamptz not null default now()
);

-- Lo que el alumno lleva escrito. Una fila por alumno y laboratorio; las
-- respuestas viven en un jsonb con la llave de cada caja.
create table if not exists public.laboratorio_avance (
  matricula_id uuid not null references public.matriculas(id)  on delete cascade,
  actividad_id uuid not null references public.actividades(id) on delete cascade,
  respuestas   jsonb not null default '{}'::jsonb,
  -- Hasta qué punto de control llegó. Los controles los valida el docente en
  -- sala, así que esto es lo que el alumno declara haber alcanzado.
  tramo        integer not null default 0,
  entregado_en timestamptz,
  actualizado_en timestamptz not null default now(),
  primary key (matricula_id, actividad_id)
);

create index if not exists ix_lab_avance_matricula on public.laboratorio_avance (matricula_id);

-- ============================== Leerlo ==============================

create or replace function public.mi_laboratorio(p_matricula uuid, p_codigo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_r record;
begin
  if not public.mi_matricula(p_matricula) and not public.docente_ve_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select a.id as actividad_id, a.codigo, a.titulo, a.descripcion, a.puntos,
         l.bloques, l.minutos, l.cajas, l.controles,
         coalesce(av.respuestas, '{}'::jsonb) as respuestas,
         coalesce(av.tramo, 0) as tramo,
         av.entregado_en
    into v_r
    from public.actividades a
    join public.laboratorios l on l.actividad_id = a.id
    join public.secciones    s on s.asignatura_id = a.asignatura_id
                              and s.periodo_id    = a.periodo_id
    join public.matriculas  mt on mt.seccion_id = s.id
    left join public.laboratorio_avance av on av.actividad_id = a.id
                                          and av.matricula_id = p_matricula
   where mt.id = p_matricula and a.codigo = p_codigo and a.activa;

  if not found then return null; end if;
  return to_jsonb(v_r);
end;
$$;

-- ============================== Guardar el avance ==============================
-- Se llama seguido, mientras el alumno escribe. No paga nada: los puntos los
-- otorga la entrega.

create or replace function public.laboratorio_guardar(
  p_matricula uuid, p_codigo text, p_respuestas jsonb, p_tramo integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_act uuid; v_entregado timestamptz;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select a.id into v_act
    from public.actividades a
    join public.laboratorios l on l.actividad_id = a.id
    join public.secciones    s on s.asignatura_id = a.asignatura_id
                              and s.periodo_id    = a.periodo_id
    join public.matriculas  mt on mt.seccion_id = s.id
   where mt.id = p_matricula and a.codigo = p_codigo and a.activa;
  if v_act is null then raise exception 'Ese laboratorio no es de un ramo que curses'; end if;

  select entregado_en into v_entregado from public.laboratorio_avance
   where matricula_id = p_matricula and actividad_id = v_act;
  if v_entregado is not null then
    raise exception 'Ya lo entregaste: no se puede seguir editando';
  end if;

  insert into public.laboratorio_avance (matricula_id, actividad_id, respuestas, tramo)
  values (p_matricula, v_act, coalesce(p_respuestas, '{}'::jsonb), greatest(coalesce(p_tramo, 0), 0))
  on conflict (matricula_id, actividad_id) do update
    set respuestas = excluded.respuestas,
        -- El tramo solo avanza. Si el alumno vuelve atrás a corregir una caja no
        -- pierde el punto de control que ya alcanzó.
        tramo = greatest(public.laboratorio_avance.tramo, excluded.tramo),
        actualizado_en = now();

  return jsonb_build_object('guardado', true);
end;
$$;

-- ============================== Entregar ==============================

create or replace function public.laboratorio_entregar(p_matricula uuid, p_codigo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_a      record;
  v_av     public.laboratorio_avance;
  v_llenas integer;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select a.id, a.codigo, a.titulo, a.puntos, l.cajas into v_a
    from public.actividades a
    join public.laboratorios l on l.actividad_id = a.id
    join public.secciones    s on s.asignatura_id = a.asignatura_id
                              and s.periodo_id    = a.periodo_id
    join public.matriculas  mt on mt.seccion_id = s.id
   where mt.id = p_matricula and a.codigo = p_codigo and a.activa;
  if v_a.id is null then raise exception 'Ese laboratorio no es de un ramo que curses'; end if;

  select * into v_av from public.laboratorio_avance
   where matricula_id = p_matricula and actividad_id = v_a.id;
  if v_av.entregado_en is not null then
    raise exception 'Ya lo habías entregado';
  end if;

  -- Se cuentan las cajas con algo escrito. No se exige que estén todas —hay
  -- laboratorios que se cortan por tiempo— pero sí que no esté vacío, porque
  -- entregar en blanco por accidente y perder el intento sería peor.
  select count(*) into v_llenas
    from jsonb_each_text(coalesce(v_av.respuestas, '{}'::jsonb))
   where length(trim(value)) > 0;
  if v_llenas = 0 then
    raise exception 'No has respondido ninguna caja todavía';
  end if;

  update public.laboratorio_avance
     set entregado_en = now(), actualizado_en = now()
   where matricula_id = p_matricula and actividad_id = v_a.id;

  -- El resultado alimenta la pantalla de actividades y dispara el trigger que
  -- paga los puntos, el mismo que usa el diagnóstico.
  insert into public.resultados_actividad (actividad_id, matricula_id, detalle)
  values (v_a.id, p_matricula,
          jsonb_build_object('cajas_respondidas', v_llenas, 'de', v_a.cajas, 'tramo', v_av.tramo))
  on conflict (actividad_id, matricula_id) do nothing;

  return jsonb_build_object(
    'entregado', true, 'respondidas', v_llenas, 'de', v_a.cajas, 'puntos', v_a.puntos);
end;
$$;

-- ============================== Lo que ve el docente ==============================

create or replace function public.laboratorio_avances(p_asignatura uuid, p_periodo uuid, p_codigo text)
returns table (
  matricula_id uuid, alumno text, seccion text,
  respondidas integer, de integer, tramo integer, entregado_en timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select mt.id, pf.nombre, s.codigo,
         (select count(*)::integer from jsonb_each_text(av.respuestas) e
           where length(trim(e.value)) > 0),
         l.cajas, av.tramo, av.entregado_en
    from public.laboratorio_avance av
    join public.actividades a  on a.id  = av.actividad_id
    join public.laboratorios l on l.actividad_id = a.id
    join public.matriculas  mt on mt.id = av.matricula_id
    join public.perfiles    pf on pf.id = mt.perfil_id
    join public.secciones   s  on s.id  = mt.seccion_id
   where a.asignatura_id = p_asignatura and a.periodo_id = p_periodo and a.codigo = p_codigo
     and public.docente_ve_seccion(s.id)
   order by pf.nombre;
$$;

-- ============================== Permisos ==============================

alter table public.laboratorios       enable row level security;
alter table public.laboratorio_avance enable row level security;

-- El enunciado no es secreto: es material de clase. Pero se lee por
-- `mi_laboratorio()`, que además trae el avance propio, así que la tabla no
-- necesita política de lectura directa.
drop policy if exists "avance: el mio" on public.laboratorio_avance;
create policy "avance: el mio" on public.laboratorio_avance for select to pulso_app
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

grant select on public.laboratorio_avance to pulso_app;

grant execute on function
  public.mi_laboratorio(uuid, text),
  public.laboratorio_guardar(uuid, text, jsonb, integer),
  public.laboratorio_entregar(uuid, text),
  public.laboratorio_avances(uuid, uuid, text)
  to pulso_app;
