-- Laboratorios opcionales que se desbloquean al terminar el oficial.
--
-- Hay un desafío por semana para quien terminó el laboratorio de la línea
-- principal y quiere más. No entra en ninguna nota. Y **no se abre hasta que el
-- oficial esté entregado**: es un premio por haber terminado, no una alternativa
-- para quien no quiso hacer el otro.
--
-- ── El candado va en la base, no en la pantalla ──
--
-- Esconder la tarjeta no sirve de nada: la dirección `/laboratorio/X1` se escribe
-- a mano y el enunciado bajaría igual. Así que el candado está en las cuatro
-- funciones por las que se toca un laboratorio —leer, guardar, sugerir y
-- entregar— y la pantalla solo refleja lo que la base ya decidió.
--
-- ── Bloqueado significa que no se ve ──
--
-- `mi_laboratorio` devuelve la ficha —código, título, por qué está bloqueado— pero
-- **no los bloques**. Si devolviera el enunciado, el alumno podría leer los tres
-- desafíos sin haber entregado L1, y la mitad del sentido de que sea un premio se
-- pierde.
--
-- ── El prerrequisito se declara por código y no por id ──
--
-- `requiere: L1` en el Markdown. El código es lo que el docente escribe y lee, y se
-- resuelve dentro de la **misma asignatura y periodo**: el `L1` de Cloud Native no
-- desbloquea nada en Arquitectura, aunque los dos se llamen igual.

alter table public.laboratorios
  add column if not exists opcional boolean not null default false,
  -- El código de la actividad que hay que haber entregado antes. Nulo = sin candado.
  add column if not exists requiere text;

-- ============================== El candado ==============================

/**
 * Qué le falta a esta matrícula para abrir este laboratorio.
 *
 * Devuelve el **código** que falta entregar, o nulo si está abierto. Se devuelve el
 * código y no un booleano porque la pantalla tiene que poder decir *cuál* falta:
 * «termina L1 primero» es útil, «bloqueado» no.
 */
create or replace function public.laboratorio_falta(p_matricula uuid, p_actividad uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_req text; v_asig uuid; v_per uuid; v_listo boolean;
begin
  select l.requiere, a.asignatura_id, a.periodo_id
    into v_req, v_asig, v_per
    from public.laboratorios l
    join public.actividades a on a.id = l.actividad_id
   where l.actividad_id = p_actividad;

  if v_req is null or v_req = '' then return null; end if;

  -- Entregado = tiene fila en `resultados_actividad`, que es lo que escribe
  -- `laboratorio_entregar`. Se mira eso y no `laboratorio_avance.entregado_en`
  -- porque el resultado es el que paga los puntos: es la definición de «terminó».
  select exists (
    select 1
      from public.resultados_actividad ra
      join public.actividades req on req.id = ra.actividad_id
     where ra.matricula_id = p_matricula
       and req.codigo = v_req
       and req.asignatura_id = v_asig
       and req.periodo_id    = v_per)
    into v_listo;

  if v_listo then return null; end if;
  return v_req;
end;
$$;

-- ============================== Leerlo ==============================
-- Igual que antes, más `opcional`, `requiere` y `falta`. Y si falta algo, **sin
-- bloques**: la ficha se ve, el enunciado no.

create or replace function public.mi_laboratorio(p_matricula uuid, p_codigo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_r record; v_falta text;
begin
  if not public.mi_matricula(p_matricula) and not public.docente_ve_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select a.id as actividad_id, a.codigo, a.titulo, a.descripcion, a.puntos,
         l.bloques, l.minutos, l.cajas, l.controles, l.opcional, l.requiere,
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

  v_falta := public.laboratorio_falta(p_matricula, v_r.actividad_id);

  if v_falta is not null then
    -- El docente sí lo ve completo: tiene que poder revisar el enunciado sin
    -- entregar nada.
    if public.docente_ve_matricula(p_matricula) then
      return to_jsonb(v_r) || jsonb_build_object('falta', v_falta);
    end if;
    return jsonb_build_object(
      'actividad_id', v_r.actividad_id, 'codigo', v_r.codigo, 'titulo', v_r.titulo,
      'descripcion', v_r.descripcion, 'puntos', v_r.puntos, 'minutos', v_r.minutos,
      'cajas', v_r.cajas, 'controles', v_r.controles,
      'opcional', v_r.opcional, 'requiere', v_r.requiere, 'falta', v_falta,
      'bloques', '[]'::jsonb, 'respuestas', '{}'::jsonb, 'revisiones', '{}'::jsonb,
      'tramo', 0, 'entregado_en', null);
  end if;

  return to_jsonb(v_r) || jsonb_build_object('falta', null);
end;
$$;

-- ============================== Los tres candados de escritura ==============================
-- Leer bloqueado devuelve una ficha vacía; escribir bloqueado tiene que fallar y
-- decir por qué. Son tres funciones y las tres comprueban lo mismo, porque las
-- tres son una puerta.

create or replace function public.laboratorio_guardar(
  p_matricula uuid, p_codigo text, p_respuestas jsonb, p_tramo integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_act uuid; v_entregado timestamptz; v_falta text;
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

create or replace function public.laboratorio_revisar_guardar(
  p_matricula uuid, p_codigo text, p_caja text,
  p_veredicto text, p_mensaje text, p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_act uuid; v_existe boolean; v_falta text;
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
  v_falta  text;
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

  v_falta := public.laboratorio_falta(p_matricula, v_a.id);
  if v_falta is not null then
    raise exception 'Todavía no se abre: primero tienes que entregar %', v_falta;
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

  update public.laboratorio_avance
     set entregado_en = now(), actualizado_en = now()
   where matricula_id = p_matricula and actividad_id = v_a.id;

  insert into public.resultados_actividad (actividad_id, matricula_id, detalle)
  values (v_a.id, p_matricula,
          jsonb_build_object('cajas_respondidas', v_llenas, 'de', v_a.cajas, 'tramo', v_av.tramo))
  on conflict (actividad_id, matricula_id) do nothing;

  return jsonb_build_object(
    'entregado', true, 'respondidas', v_llenas, 'de', v_a.cajas, 'puntos', v_a.puntos);
end;
$$;

-- ============================== Lo que la pantalla necesita saber ==============================
-- Para pintar la tarjeta de Actividades sin abrir cada laboratorio: qué es
-- opcional, qué está bloqueado y por qué.

create or replace function public.mis_laboratorios(p_matricula uuid)
returns table (codigo text, titulo text, opcional boolean, requiere text, falta text)
language sql
stable
security definer
set search_path = public
as $$
  select a.codigo, a.titulo, l.opcional, l.requiere,
         public.laboratorio_falta(p_matricula, a.id)
    from public.actividades a
    join public.laboratorios l on l.actividad_id = a.id
    join public.secciones    s on s.asignatura_id = a.asignatura_id
                              and s.periodo_id    = a.periodo_id
    join public.matriculas  mt on mt.seccion_id = s.id
   where mt.id = p_matricula and a.activa
     and (public.mi_matricula(p_matricula) or public.docente_ve_matricula(p_matricula))
   order by a.orden;
$$;

grant execute on function
  public.laboratorio_falta(uuid, uuid),
  public.mis_laboratorios(uuid)
  to pulso_app;
