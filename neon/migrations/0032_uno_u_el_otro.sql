-- Dos laboratorios que son alternativas: se hace uno o el otro, no los dos.
--
-- El caso concreto: L2 de DSY1107 se reescribió porque los alumnos no podían crear
-- un tenant en Azure con su cuenta de estudiante. La versión nueva es la de la
-- línea principal, y la vieja —la que sí exige poder crear el tenant— queda como
-- **desafío opcional** para quien pueda. Son el mismo aprendizaje por dos caminos,
-- así que cobrar los dos sería cobrar dos veces lo mismo.
--
-- ── Por qué no alcanzaba con lo que ya había ──
--
-- `laboratorios.requiere` dice «esto se abre cuando entregues aquello». Es lo
-- contrario de lo que hace falta: acá uno **cierra** al otro. Y no se puede
-- expresar con `requiere` invertido, porque `requiere` bloquea hasta que se cumple
-- y esto bloquea desde que se cumple.
--
-- ── La exclusión se lee en las dos direcciones ──
--
-- `excluye` se declara en el `.md` de cualquiera de los dos y vale igual para
-- ambos. Se podría exigir declararlo en los dos archivos, pero los laboratorios se
-- suben por separado: quedaría una ventana —entre subir uno y subir el otro— en
-- que la exclusión funciona para un lado y no para el otro, y nadie se enteraría
-- hasta que alguien cobrara los dos. Leyéndolo simétrico, declararlo una vez
-- basta y declararlo dos veces no molesta.
--
-- ── Solo hacia adelante, y eso no hay que programarlo ──
--
-- Quien ya entregó uno conserva sus puntos: esto no toca `resultados_actividad` ni
-- `movimientos_puntos`. Lo único que hace es cerrar **el otro**. Cuando esto se
-- aplica, dos alumnos tienen L2 entregado y nadie tiene el desafío nuevo, así que
-- el efecto es exactamente el que se pidió: esos dos conservan sus 100 puntos y el
-- desafío les queda cerrado. Nadie pierde nada.
--
-- Y cuarenta y cuatro alumnos tienen L2 **a medias**: para ellos los dos siguen
-- abiertos hasta que entreguen uno. Elegir es suyo.

alter table public.laboratorios
  add column if not exists excluye text;

comment on column public.laboratorios.excluye is
  'Código del laboratorio alternativo: entregar uno cierra el otro. Se lee en las '
  'dos direcciones, así que declararlo en un solo lado alcanza.';

-- ============================== Quién lo cerró ==============================

/**
 * El código del laboratorio que cierra a éste, o nulo si está abierto.
 *
 * Devuelve el código y no un booleano por lo mismo que `laboratorio_falta`: la
 * pantalla tiene que poder decir **cuál** lo cerró. «Ya hiciste L2» es útil;
 * «cerrado» deja al alumno sin saber qué pasó ni si fue su culpa.
 */
create or replace function public.laboratorio_cerrado_por(p_matricula uuid, p_actividad uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_codigo text; v_asig uuid; v_per uuid; v_otro text;
begin
  select a.codigo, a.asignatura_id, a.periodo_id
    into v_codigo, v_asig, v_per
    from public.actividades a where a.id = p_actividad;
  if v_codigo is null then return null; end if;

  -- El código del alternativo, mirando las dos direcciones: lo que este
  -- laboratorio declara excluir, y lo que otro declara excluir de éste.
  select x.codigo into v_otro
    from (
      select l.excluye as codigo
        from public.laboratorios l
       where l.actividad_id = p_actividad and coalesce(l.excluye, '') <> ''
      union
      select otra.codigo
        from public.laboratorios l2
        join public.actividades otra on otra.id = l2.actividad_id
       where l2.excluye = v_codigo
         and otra.asignatura_id = v_asig and otra.periodo_id = v_per
    ) x
    -- Entre varios candidatos gana el que el alumno ya entregó: es el que cierra.
    join public.actividades cand on cand.codigo = x.codigo
                                and cand.asignatura_id = v_asig
                                and cand.periodo_id = v_per
    join public.resultados_actividad ra on ra.actividad_id = cand.id
                                       and ra.matricula_id = p_matricula
   limit 1;

  return v_otro;
end;
$$;

-- ============================== Leerlo ==============================
-- Igual que la versión viva, más `excluye` y `cerrado_por`. Un laboratorio cerrado
-- se comporta como uno bloqueado: la ficha se ve, el enunciado no. Si bajara los
-- bloques, el alumno podría leer el desafío entero después de haber cobrado el
-- oficial, y la mitad del sentido de que sea una alternativa se pierde.

create or replace function public.mi_laboratorio(p_matricula uuid, p_codigo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_r record; v_falta text; v_cerrado text;
begin
  if not public.mi_matricula(p_matricula) and not public.docente_ve_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select a.id as actividad_id, a.codigo, a.titulo, a.descripcion, a.puntos,
         a.puntua_desde, a.puntua_hasta,
         coalesce(public.actividad_en_plazo(a.id, now()), true) as en_plazo,
         l.bloques, l.minutos, l.cajas, l.controles, l.opcional, l.requiere, l.excluye,
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

  v_falta   := public.laboratorio_falta(p_matricula, v_r.actividad_id);
  v_cerrado := public.laboratorio_cerrado_por(p_matricula, v_r.actividad_id);

  -- Ojo con el orden: si el alumno **ya entregó éste**, no está cerrado para él
  -- aunque haya entregado el otro. Cerrarlo le esconderría su propio trabajo y su
  -- propia nota, que es lo peor que podría hacer esta función.
  if v_r.entregado_en is not null then v_cerrado := null; end if;

  if v_falta is not null or v_cerrado is not null then
    if public.docente_ve_matricula(p_matricula) then
      return to_jsonb(v_r) || jsonb_build_object('falta', v_falta, 'cerrado_por', v_cerrado);
    end if;
    return jsonb_build_object(
      'actividad_id', v_r.actividad_id, 'codigo', v_r.codigo, 'titulo', v_r.titulo,
      'descripcion', v_r.descripcion, 'puntos', v_r.puntos, 'minutos', v_r.minutos,
      'cajas', v_r.cajas, 'controles', v_r.controles,
      'opcional', v_r.opcional, 'requiere', v_r.requiere, 'excluye', v_r.excluye,
      'falta', v_falta, 'cerrado_por', v_cerrado,
      'puntua_desde', v_r.puntua_desde, 'puntua_hasta', v_r.puntua_hasta,
      'en_plazo', v_r.en_plazo,
      'bloques', '[]'::jsonb, 'respuestas', '{}'::jsonb, 'revisiones', '{}'::jsonb,
      'tramo', 0, 'entregado_en', null);
  end if;

  return to_jsonb(v_r) || jsonb_build_object('falta', null, 'cerrado_por', null);
end;
$$;

-- La lista que pinta la pantalla de Actividades.
--
-- Va con `drop` y no con `create or replace`: gana dos columnas y Postgres no deja
-- cambiar el tipo de retorno de una función existente. El `drop` se lleva el grant,
-- así que se vuelve a dar más abajo — olvidarlo dejaría la pantalla de Actividades
-- con «permission denied» para todo el curso.
--
-- La firma no cambia, así que el frontend que hay publicado sigue llamándola igual:
-- pide `select *` y las dos columnas nuevas le llegan de más y las ignora.

drop function if exists public.mis_laboratorios(uuid);

create or replace function public.mis_laboratorios(p_matricula uuid)
returns table (codigo text, titulo text, opcional boolean, requiere text, falta text,
               puntua_desde timestamptz, puntua_hasta timestamptz, en_plazo boolean,
               excluye text, cerrado_por text)
language sql
stable
security definer
set search_path = public
as $$
  select a.codigo, a.titulo, l.opcional, l.requiere,
         public.laboratorio_falta(p_matricula, a.id),
         a.puntua_desde, a.puntua_hasta,
         coalesce(public.actividad_en_plazo(a.id, now()), true),
         l.excluye,
         -- Nulo si ya lo entregó: lo suyo nunca se le esconde.
         case when exists (select 1 from public.laboratorio_avance av
                            where av.actividad_id = a.id and av.matricula_id = p_matricula
                              and av.entregado_en is not null)
              then null
              else public.laboratorio_cerrado_por(p_matricula, a.id) end
    from public.actividades a
    join public.laboratorios l on l.actividad_id = a.id
    join public.secciones    s on s.asignatura_id = a.asignatura_id
                              and s.periodo_id    = a.periodo_id
    join public.matriculas  mt on mt.seccion_id = s.id
   where mt.id = p_matricula and a.activa
     and (public.mi_matricula(p_matricula) or public.docente_ve_matricula(p_matricula))
   order by a.orden;
$$;

-- ============================== Las tres puertas de escritura ==============================
-- Esconder el enunciado no basta: la dirección `/laboratorio/X2` se escribe a mano
-- y las funciones se pueden llamar por la Data API. El candado va donde se escribe,
-- igual que el de `requiere`.

create or replace function public.laboratorio_guardar(
  p_matricula uuid, p_codigo text, p_respuestas jsonb, p_tramo integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_act uuid; v_entregado timestamptz; v_falta text; v_cerrado text;
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

  v_falta := public.laboratorio_falta(p_matricula, v_act);
  if v_falta is not null then
    raise exception 'Todavía no se abre: primero tienes que entregar %', v_falta;
  end if;

  select entregado_en into v_entregado from public.laboratorio_avance
   where matricula_id = p_matricula and actividad_id = v_act;

  -- Solo si no lo ha entregado él: si ya lo entregó, es suyo y se sigue leyendo.
  if v_entregado is null then
    v_cerrado := public.laboratorio_cerrado_por(p_matricula, v_act);
    if v_cerrado is not null then
      raise exception 'Ya entregaste %, y son alternativas: se hace uno o el otro', v_cerrado;
    end if;
  end if;

  if v_entregado is not null then
    raise exception 'Ya lo entregaste: no se puede seguir editando';
  end if;

  insert into public.laboratorio_avance (matricula_id, actividad_id, respuestas, tramo)
  values (p_matricula, v_act, coalesce(p_respuestas, '{}'::jsonb), greatest(coalesce(p_tramo, 0), 0))
  on conflict (matricula_id, actividad_id) do update
    set respuestas = excluded.respuestas,
        tramo = greatest(public.laboratorio_avance.tramo, excluded.tramo),
        actualizado_en = now();

  return jsonb_build_object('guardado', true);
end;
$$;

-- OJO con de dónde sale esta función. La primera versión de esta migración la
-- copió de la 0026 y **pisó el plazo que agregó la 0028**: L0, que está fuera de
-- plazo, volvió a pagar 100 puntos en vez de cero, y el detalle dejó de anotar
-- `a_tiempo`. Lo cazaron `probar-plazo` y `probar-laboratorio --codigo L0`. Lo que
-- sigue es la de la 0028 con el chequeo de exclusión insertado, y nada más.

create or replace function public.laboratorio_entregar(p_matricula uuid, p_codigo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_a        record;
  v_av       public.laboratorio_avance;
  v_llenas   integer;
  v_falta    text;
  v_cerrado  text;
  v_en_plazo boolean;
  -- Un solo instante para las tres decisiones: qué se le responde, qué se guarda
  -- en el detalle y con qué fecha juzga el trigger.
  v_ahora    timestamptz := now();
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select a.id, a.codigo, a.titulo, a.puntos, a.puntua_desde, a.puntua_hasta, l.cajas
    into v_a
    from public.actividades a
    join public.laboratorios l on l.actividad_id = a.id
    join public.secciones    s on s.asignatura_id = a.asignatura_id
                              and s.periodo_id    = a.periodo_id
    join public.matriculas  mt on mt.seccion_id = s.id
   where mt.id = p_matricula and a.codigo = p_codigo and a.activa;
  if v_a.id is null then raise exception 'Ese laboratorio no es de un ramo que curses'; end if;

  v_falta := public.laboratorio_falta(p_matricula, v_a.id);
  if v_falta is not null then
    raise exception 'Todavía no se abre: primero tienes que entregar %', v_falta;
  end if;

  -- La puerta por la que se cobra: si ya entregó la alternativa, acá se corta.
  v_cerrado := public.laboratorio_cerrado_por(p_matricula, v_a.id);
  if v_cerrado is not null then
    raise exception 'Ya entregaste %, y son alternativas: se hace uno o el otro', v_cerrado;
  end if;

  select * into v_av from public.laboratorio_avance
   where matricula_id = p_matricula and actividad_id = v_a.id;
  if v_av.entregado_en is not null then
    raise exception 'Ya lo habías entregado';
  end if;

  select count(*) into v_llenas
    from jsonb_each_text(coalesce(v_av.respuestas, '{}'::jsonb))
   where public.tiene_texto(value);
  if v_llenas = 0 then
    raise exception 'No has respondido ninguna caja todavía';
  end if;

  -- Fuera de plazo se entrega igual. No hay `raise` acá y es a propósito: ver el
  -- comentario de arriba sobre por qué bloquear la entrega saldría peor.
  v_en_plazo := coalesce(public.actividad_en_plazo(v_a.id, v_ahora), true);

  update public.laboratorio_avance
     set entregado_en = v_ahora, actualizado_en = v_ahora
   where matricula_id = p_matricula and actividad_id = v_a.id;

  -- `completada_en` explícito, con el mismo instante: si se dejara el `default
  -- now()` el trigger juzgaría con su propio reloj y podría decidir distinto que
  -- la línea de arriba.
  insert into public.resultados_actividad (actividad_id, matricula_id, detalle, completada_en)
  values (v_a.id, p_matricula,
          jsonb_build_object('cajas_respondidas', v_llenas, 'de', v_a.cajas,
                             'tramo', v_av.tramo, 'a_tiempo', v_en_plazo),
          v_ahora)
  on conflict (actividad_id, matricula_id) do nothing;

  return jsonb_build_object(
    'entregado', true, 'respondidas', v_llenas, 'de', v_a.cajas,
    'puntos', case when v_en_plazo then v_a.puntos else 0 end,
    'a_tiempo', v_en_plazo,
    'puntua_desde', v_a.puntua_desde, 'puntua_hasta', v_a.puntua_hasta);
end;
$$;

-- La sugerencia por IA también: pedirla sobre un laboratorio cerrado sería leer su
-- enunciado de a pedazos, con el modelo de intermediario.

create or replace function public.laboratorio_revisar_guardar(
  p_matricula uuid, p_codigo text, p_caja text,
  p_veredicto text, p_mensaje text, p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_act uuid; v_existe boolean; v_falta text; v_cerrado text; v_entregado timestamptz;
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

  v_falta := public.laboratorio_falta(p_matricula, v_act);
  if v_falta is not null then
    raise exception 'Todavía no se abre: primero tienes que entregar %', v_falta;
  end if;

  -- Se puede pedir sugerencia después de entregar —entregar cierra la edición, no
  -- el aprendizaje—, así que la exclusión solo aplica si **no** lo entregó él.
  select entregado_en into v_entregado from public.laboratorio_avance
   where matricula_id = p_matricula and actividad_id = v_act;
  if v_entregado is null then
    v_cerrado := public.laboratorio_cerrado_por(p_matricula, v_act);
    if v_cerrado is not null then
      raise exception 'Ya entregaste %, y son alternativas: se hace uno o el otro', v_cerrado;
    end if;
  end if;

  select exists (
    select 1 from public.laboratorios l, jsonb_array_elements(l.bloques) b
     where l.actividad_id = v_act
       and b->>'tipo' = 'caja' and b->>'id' = p_caja)
    into v_existe;
  if not v_existe then raise exception 'La caja «%» no existe en este laboratorio', p_caja; end if;

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
  public.laboratorio_cerrado_por(uuid, uuid),
  public.mis_laboratorios(uuid)
  to pulso_app;
