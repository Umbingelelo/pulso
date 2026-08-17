-- Sugerencias por IA para cada caja del laboratorio.
--
-- El alumno escribe su respuesta y aprieta un botón al lado de esa caja. El
-- modelo lee **el laboratorio completo**, ubica la caja que se está revisando y
-- le dice si lo que hizo capta la idea, sin exigir palabras exactas.
--
-- ── No es un impedimento, y eso está sostenido acá ──
--
-- `laboratorio_entregar` **no mira esta columna**. No la exige, no la cuenta, no
-- cambia de mensaje según ella. Se puede entregar con cero revisiones, con todas
-- en «incompleto» o con el modelo caído, y el resultado es idéntico. Esa es la
-- garantía, y está donde no se puede romper por accidente: la función que paga
-- los puntos no sabe que las revisiones existen.
--
-- ── Por qué se guardan ──
--
-- Tres cosas que salen gratis de guardarlas y que se pierden si no:
--
--   1. El alumno recarga la página —o vuelve al día siguiente— y su sugerencia
--      sigue ahí. En un laboratorio de dos horas eso pasa.
--   2. Si aprieta el botón sin haber cambiado el texto, el hash calza y **no se
--      vuelve a llamar al modelo**. Es la diferencia entre pagar una vez y pagar
--      cada vez que alguien se pone nervioso.
--   3. Queda el dato para el día que quieras saber quién se atascó en qué.
--
-- ── Por qué el hash incluye el enunciado ──
--
-- No basta con el texto del alumno: si el enunciado de esa caja cambia, la
-- sugerencia vieja puede haber quedado sin sentido. El hash mezcla las dos cosas,
-- así que un enunciado editado invalida la caché por sí solo.
--
-- ── Por qué se puede revisar después de entregar ──
--
-- Entregar cierra la edición pero no cierra el aprendizaje. Es la única
-- retroalimentación que ese alumno va a recibir sobre lo que escribió, y no
-- cuesta nada dejarlo pedirla. Por eso `laboratorio_revisar_guardar` **no**
-- comprueba `entregado_en`, a diferencia de `laboratorio_guardar`.

alter table public.laboratorio_avance
  add column if not exists revisiones jsonb not null default '{}'::jsonb;

-- ============================== Leerlo ==============================
-- Igual que antes más `revisiones`: el navegador necesita las dos cosas juntas
-- para dibujar cada caja con su sugerencia ya puesta.

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
         coalesce(av.revisiones, '{}'::jsonb) as revisiones,
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

-- ============================== Guardar una sugerencia ==============================
-- Una caja a la vez. La llama `/api/laboratorio` después de que el modelo
-- responde, con la identidad del alumno.

create or replace function public.laboratorio_revisar_guardar(
  p_matricula uuid, p_codigo text, p_caja text,
  p_veredicto text, p_mensaje text, p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_act uuid; v_existe boolean;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  if p_veredicto not in ('logrado', 'parcial', 'incompleto') then
    raise exception 'Veredicto desconocido: %', p_veredicto;
  end if;

  select a.id into v_act
    from public.actividades a
    join public.laboratorios l on l.actividad_id = a.id
    join public.secciones    s on s.asignatura_id = a.asignatura_id
                              and s.periodo_id    = a.periodo_id
    join public.matriculas  mt on mt.seccion_id = s.id
   where mt.id = p_matricula and a.codigo = p_codigo and a.activa;
  if v_act is null then raise exception 'Ese laboratorio no es de un ramo que curses'; end if;

  -- Que la caja exista en el enunciado. Sin esto, una llave inventada desde el
  -- navegador ensucia el jsonb con basura que nadie va a leer ni a limpiar.
  select exists (
    select 1 from public.laboratorios l, jsonb_array_elements(l.bloques) b
     where l.actividad_id = v_act
       and b->>'tipo' = 'caja' and b->>'id' = p_caja)
    into v_existe;
  if not v_existe then raise exception 'La caja «%» no existe en este laboratorio', p_caja; end if;

  -- Ojo: **no** se comprueba `entregado_en`. Entregar cierra la edición, no el
  -- aprendizaje, y esta es la única retroalimentación que va a recibir.
  insert into public.laboratorio_avance (matricula_id, actividad_id, revisiones)
  values (p_matricula, v_act,
          jsonb_build_object(p_caja, jsonb_build_object(
            'veredicto', p_veredicto, 'mensaje', p_mensaje,
            'hash', p_hash, 'en', now())))
  on conflict (matricula_id, actividad_id) do update
    set revisiones = public.laboratorio_avance.revisiones ||
          jsonb_build_object(p_caja, jsonb_build_object(
            'veredicto', p_veredicto, 'mensaje', p_mensaje,
            'hash', p_hash, 'en', now())),
        actualizado_en = now();

  return jsonb_build_object('veredicto', p_veredicto, 'mensaje', p_mensaje, 'caja', p_caja);
end;
$$;

grant execute on function
  public.laboratorio_revisar_guardar(uuid, text, text, text, text, text)
  to pulso_app;
