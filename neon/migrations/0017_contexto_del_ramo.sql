-- Contexto del ramo y de la semana en curso, para el generador de misiones.
--
-- Hasta ahora el modelo recibía el término, su definición y el perfil del alumno.
-- Con eso escribe preguntas correctas pero **desubicadas**: no sabe si el curso
-- es de segundo o de sexto semestre, ni con qué herramientas trabaja, ni en qué
-- clase van. Una pregunta sobre «log» redactada sin saber que el ramo llega a
-- Kafka en noviembre puede apuntar a cualquier parte.
--
-- Se le agregan tres cosas:
--
--   * `contexto`: qué es el ramo, escrito por el docente. Es lo que fija el nivel
--     y el vocabulario. Editable sin despliegue, como todo lo demás.
--   * la clase en curso: la última publicada, que es en la que va el curso hoy.
--   * el recorrido: los títulos de lo que el alumno ya vio, que es el arco del
--     semestre hasta este punto.
--
-- Lo que **no** se le da es la clase que viene: si la conoce, tiende a preguntar
-- por materia que todavía no se ha dictado.

alter table public.asignaturas
  add column if not exists contexto text;

update public.asignaturas set contexto =
  'Curso de Desarrollo Cloud Native de la Escuela de Informática y Telecomunicaciones '
  || 'de Duoc UC. Los alumnos vienen de programación básica y acá arman un sistema '
  || 'completo: peticiones HTTP y API Gateway, identidad con OAuth2 y OIDC, JWT y JWKS, '
  || 'TypeScript y asincronía, un BFF en NestJS, Docker y Compose, y mensajería con '
  || 'RabbitMQ y Kafka. Es un curso práctico: se programa, se despliega y se defiende '
  || 'lo construido. El tono es directo y aterrizado, sin solemnidad.'
 where sigla = 'DSY1107';

update public.asignaturas set contexto =
  'Curso de Arquitectura de Sistemas de IA de la Escuela de Informática y '
  || 'Telecomunicaciones de Duoc UC. Se trabaja el diseño y la documentación de '
  || 'arquitecturas que llevan un modelo adentro: arc42 y el modelo C4, atributos de '
  || 'calidad y escalabilidad, CI/CD y MLOps, microservicios y Pub/Sub, orquestación, '
  || 'seguridad y monitoreo, y servicios gestionados como Bedrock y SageMaker. El foco '
  || 'está en decidir y justificar, no en programar. El tono es directo y aterrizado.'
 where sigla = 'ITY1102';

-- ============================== El término, con su semana ==============================

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
  v_asig   record;
  v_actual jsonb;
  v_arco   jsonb;
begin
  select b.termino, b.definicion, b.fuente, a.nombre as asignatura, a.contexto, a.id as asig_id
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
    select b.termino, b.definicion, b.fuente, a.nombre as asignatura, a.contexto, a.id as asig_id
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

  -- La clase en curso: la última que se habilitó. Es donde va el curso hoy.
  select jsonb_build_object('codigo', c.codigo, 'titulo', c.titulo, 'dictada_el', c.dictada_el)
    into v_actual
    from public.clases c
   where c.asignatura_id = v_t.asig_id
     and c.publicada_desde is not null and c.publicada_desde <= now()
   order by c.publicada_desde desc limit 1;

  -- El arco: lo que el alumno ya recorrió, en orden.
  select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'titulo', c.titulo)
                            order by c.orden), '[]'::jsonb)
    into v_arco
    from public.clases c
   where c.asignatura_id = v_t.asig_id
     and c.codigo = any (v_vistas);

  return jsonb_build_object(
    'termino', v_t.termino, 'definicion', v_t.definicion,
    'fuente', v_t.fuente, 'asignatura', v_t.asignatura,
    'contexto', v_t.contexto,
    'clase_actual', v_actual,
    'recorrido', v_arco,
    'perfil', v_ctx);
end;
$$;

grant execute on function public.termino_para_mision(uuid) to pulso_app;
