-- El contexto del alumno, para que su misión sea suya.
--
-- Hasta ahora el término se elegía al azar entre los 124 del banco. Eso tenía dos
-- problemas, y el primero es grave: **el banco cubre las 16 clases del semestre y
-- solo dos están dictadas**. Un alumno en la semana 2 podía recibir una pregunta
-- sobre `consumer group` de Kafka, que ve en noviembre. No es difícil: es injusto,
-- y además le enseña que las misiones son ruido.
--
-- Lo que se arma acá es un perfil pedagógico —qué ha visto, en qué anda flojo,
-- qué ya le preguntamos, cómo le ha ido— y con eso se elige el término y se
-- calibra la dificultad.
--
-- ── Qué sale de la casa y qué no ──
--
-- Este perfil viaja en el prompt hacia OpenRouter y de ahí al proveedor del
-- modelo. Por eso **no lleva nombre, correo ni identificador**: lleva señales.
-- «Sacó 2 de 6 en Web y HTTP» personaliza exactamente igual que un nombre y no
-- expone a nadie. El modelo no necesita saber quién es para saber qué sabe.

-- ============================== El perfil ==============================

create or replace function public.contexto_mision(p_matricula uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_debiles   jsonb;
  v_vistas    text[];
  v_usados    text[];
  v_intentos  integer;
  v_aciertos  integer;
  v_dificultad text;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  -- Secciones del diagnóstico bajo el umbral. Es la señal más honesta que
  -- tenemos de dónde le cuesta, porque la rindió antes de que empezara el curso.
  select coalesce(jsonb_agg(jsonb_build_object(
           'seccion', ds.titulo, 'obtuvo', (r.detalle->'puntajes'->>ds.codigo)::int,
           'de', (select count(*) from public.diagnostico_preguntas dp where dp.seccion_id = ds.id))
         order by (r.detalle->'puntajes'->>ds.codigo)::int), '[]'::jsonb)
    into v_debiles
    from public.resultados_actividad r
    join public.actividades a  on a.id = r.actividad_id and a.tipo = 'diagnostico'
    join public.diagnostico_secciones ds on ds.actividad_id = a.id
   where r.matricula_id = p_matricula
     and (r.detalle->'puntajes'->>ds.codigo) is not null
     and (r.detalle->'puntajes'->>ds.codigo)::int < ds.umbral;

  -- Las clases que **abrió**. Es el filtro que impide preguntarle por materia que
  -- todavía no ha visto. Si no ha abierto ninguna, se cae a las ya publicadas:
  -- un alumno nuevo igual tiene que poder jugar.
  select coalesce(array_agg(distinct c.codigo), '{}')
    into v_vistas
    from public.progreso_clase pc
    join public.clases c on c.id = pc.clase_id
   where pc.matricula_id = p_matricula;

  if array_length(v_vistas, 1) is null then
    select coalesce(array_agg(distinct c.codigo), '{}')
      into v_vistas
      from public.clases c
      join public.secciones  s  on s.asignatura_id = c.asignatura_id
                               and s.periodo_id    = c.periodo_id
      join public.matriculas mt on mt.seccion_id = s.id
     where mt.id = p_matricula
       and c.publicada_desde is not null and c.publicada_desde <= now();
  end if;

  -- Lo que ya se le preguntó: la variedad es la mitad de la gracia.
  select coalesce(array_agg(m.enunciado->>'termino'), '{}')
    into v_usados
    from (select enunciado from public.misiones
           where matricula_id = p_matricula and enunciado ? 'termino'
           order by fecha desc limit 30) m;

  select count(*), count(*) filter (where acertada)
    into v_intentos, v_aciertos
    from public.misiones
   where matricula_id = p_matricula and resuelta_en is not null;

  -- La dificultad se mueve con lo que le ha ido pasando, no con una nota fija.
  v_dificultad := case
    when v_intentos < 3 then 'media'
    when v_aciertos::numeric / nullif(v_intentos, 0) >= 0.8 then 'alta'
    when v_aciertos::numeric / nullif(v_intentos, 0) <= 0.4 then 'base'
    else 'media' end;

  return jsonb_build_object(
    'secciones_debiles', v_debiles,
    'clases_vistas',     to_jsonb(v_vistas),
    'terminos_usados',   to_jsonb(v_usados),
    'misiones_resueltas', v_intentos,
    'misiones_acertadas', v_aciertos,
    'dificultad',        v_dificultad);
end;
$$;

-- ============================== Elegir el término ==============================
-- Solo de clases que el alumno vio, y sin repetir lo reciente. Si con esos dos
-- filtros no queda nada —porque ya recorrió todo su material— se relaja el de
-- «no repetir» antes que el de «no ha visto»: preferimos repetir una pregunta a
-- preguntarle por algo que no le han enseñado.

create or replace function public.termino_para_mision(p_matricula uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ctx    jsonb := public.contexto_mision(p_matricula);
  v_vistas text[] := array(select jsonb_array_elements_text(v_ctx->'clases_vistas'));
  v_usados text[] := array(select jsonb_array_elements_text(v_ctx->'terminos_usados'));
  v_t      record;
begin
  select b.termino, b.definicion, b.fuente, a.nombre as asignatura
    into v_t
    from public.mision_banco b
    join public.asignaturas  a  on a.id = b.asignatura_id
    join public.secciones    s  on s.asignatura_id = b.asignatura_id
                               and s.periodo_id    = b.periodo_id
    join public.matriculas   mt on mt.seccion_id = s.id
   where mt.id = p_matricula
     and b.activo
     and split_part(b.fuente, ' ', 1) = any (v_vistas)
     and not (b.termino = any (v_usados))
   order by random() limit 1;

  -- Ya recorrió todo lo suyo: se permite repetir, pero nunca salirse de lo visto.
  if not found then
    select b.termino, b.definicion, b.fuente, a.nombre as asignatura
      into v_t
      from public.mision_banco b
      join public.asignaturas  a  on a.id = b.asignatura_id
      join public.secciones    s  on s.asignatura_id = b.asignatura_id
                                 and s.periodo_id    = b.periodo_id
      join public.matriculas   mt on mt.seccion_id = s.id
     where mt.id = p_matricula
       and b.activo
       and split_part(b.fuente, ' ', 1) = any (v_vistas)
     order by random() limit 1;
  end if;

  if not found then return null; end if;

  return jsonb_build_object(
    'termino', v_t.termino, 'definicion', v_t.definicion,
    'fuente', v_t.fuente, 'asignatura', v_t.asignatura,
    'perfil', v_ctx);
end;
$$;

grant execute on function
  public.contexto_mision(uuid),
  public.termino_para_mision(uuid)
  to pulso_app;
