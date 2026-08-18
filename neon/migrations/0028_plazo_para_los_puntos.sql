-- El plazo de una actividad: hacerla en su semana paga, hacerla después no.
--
-- Un laboratorio de la semana 1 valía lo mismo entregado el martes en clase que
-- el día antes del examen. Eso convierte el laboratorio en una tarea que se puede
-- acumular, y acumularlas es exactamente lo que no queremos: el laboratorio se
-- hace en la sala, con el docente al lado, porque ahí es donde sirve.
--
--   puntua_desde ──────────────── puntua_hasta ─────────────────▶
--        │        paga los puntos        │      no paga nada
--        │                               │
--    empieza a pagar                cierra el plazo
--
-- Nulo en cualquiera de las dos = ese lado no tiene límite. Nulo en las dos = sin
-- plazo, que es como se comportaba todo hasta ahora: **ninguna actividad ya subida
-- cambia de conducta con esta migración.**
--
-- ── El plazo decide puntos, no acceso ──
--
-- Fuera de plazo el laboratorio se abre igual, se escribe igual y se entrega
-- igual. Solo no paga. Quién puede ver qué sigue siendo asunto de `activa` (lo
-- publicado) y de `requiere` (el candado de la 0026), que son cosas distintas y no
-- hay que mezclarlas.
--
-- Eso no es una concesión: es lo que hace que el resto siga funcionando. La fila de
-- `resultados_actividad` se escribe igual que antes, así que el alumno atrasado
-- conserva su trabajo, aparece en el avance del docente, y **el desafío opcional se
-- le sigue desbloqueando** —el candado de la 0026 mira esa fila, no los puntos—.
-- Si en cambio bloqueáramos la entrega, el que se atrasó una vez quedaría con el
-- laboratorio congelado a medias y sin acceso a ningún desafío por el resto del
-- semestre.
--
-- ── Cuenta el momento de la entrega, no el del cobro ──
--
-- El trigger valora `completada_en`, no `now()`. Es el mismo criterio que la 0009
-- usa con `alcanzo_final_en`: se juzga el instante del hecho y no el instante en
-- que nuestra propia máquina alcanzó a apuntarlo. Y `laboratorio_entregar` le pasa
-- explícitamente el mismo `now()` que usó para decidir qué contestarle al alumno,
-- para que no exista el caso en que la pantalla dice una cosa y el libro de puntos
-- apunta otra porque entre las dos líneas cambió el segundo.
--
-- ── Por qué en `actividades` y no en `laboratorios` ──
--
-- Porque `actividades` es donde el trigger que paga ya lee los puntos, así que la
-- regla vive junto al número que gobierna. De paso queda disponible para las
-- entregas y para el diagnóstico. El trigger es compartido con ellos, pero nacen
-- con las dos fechas nulas, así que no cambian hasta que el docente decida.

-- ============================== Campos nuevos ==============================

alter table public.actividades
  add column if not exists puntua_desde timestamptz,
  add column if not exists puntua_hasta timestamptz;

alter table public.actividades
  drop constraint if exists actividades_plazo_ordenado;
alter table public.actividades
  add constraint actividades_plazo_ordenado
  check (puntua_hasta is null or puntua_desde is null or puntua_hasta >= puntua_desde);

-- ============================== La regla, en un solo lugar ==============================

/**
 * ¿Pagaba esta actividad en ese momento?
 *
 * La llaman el trigger que cobra, la entrega que le responde al alumno y las tres
 * funciones de lectura que pintan el plazo en pantalla. Está en una sola función
 * por la misma razón que `puntos_con_factor` en la 0009: cuatro sitios calculando
 * lo mismo son cuatro sitios que pueden discrepar, y el que discrepa acá le cobra
 * de menos a un alumno sin dejar rastro.
 *
 * Una actividad que no existe devuelve `null`, no `false`: quien llama decide. El
 * trigger lo trata como que sí paga, porque el caso imposible no debe traducirse
 * en dejar de pagarle a alguien.
 */
create or replace function public.actividad_en_plazo(
  p_actividad uuid, p_momento timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (a.puntua_desde is null or coalesce(p_momento, now()) >= a.puntua_desde)
     and (a.puntua_hasta is null or coalesce(p_momento, now()) <= a.puntua_hasta)
    from public.actividades a
   where a.id = p_actividad;
$$;

-- ============================== Dónde se cobra ==============================
-- El único cambio de conducta de toda la migración está acá dentro.

create or replace function public.otorgar_puntos_actividad()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_puntos integer; v_titulo text; v_en_plazo boolean;
begin
  -- Las tres cosas en una consulta. `actividad_en_plazo` es `stable`, así que
  -- entra en el select sin costo aparte.
  select a.puntos, a.titulo, public.actividad_en_plazo(a.id, new.completada_en)
    into v_puntos, v_titulo, v_en_plazo
    from public.actividades a
   where a.id = new.actividad_id;

  if coalesce(v_puntos, 0) = 0 then return new; end if;

  -- `coalesce(…, true)` es lo que deja pagando a todo lo que no tiene plazo, que
  -- es todo lo subido antes de esta migración. El valor por omisión de la regla
  -- nueva tiene que ser la conducta vieja.
  if not coalesce(v_en_plazo, true) then return new; end if;

  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (new.matricula_id, v_puntos, v_titulo);
  return new;
end;
$$;

-- ============================== Entregar ==============================
-- Igual que en la 0026, más el plazo. Y con los puntos que de verdad se pagaron:
-- devolvía `a.puntos` fijo, y la pantalla del alumno decía «Ganaste 100 puntos»
-- fuera lo que fuera que hubiera hecho el trigger.

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

-- ============================== Leerlo ==============================
-- Igual que en la 0026, más las dos fechas y `en_plazo`.
--
-- Esto es la mitad de la función: un plazo que el alumno descubre después de
-- entregar no es un plazo, es una trampa. La pantalla necesita poder decir «da
-- puntos hasta el domingo» **antes**, y «esto ya no paga» mientras todavía puede
-- decidir si igual lo hace.

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
         a.puntua_desde, a.puntua_hasta,
         coalesce(public.actividad_en_plazo(a.id, now()), true) as en_plazo,
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
    if public.docente_ve_matricula(p_matricula) then
      return to_jsonb(v_r) || jsonb_build_object('falta', v_falta);
    end if;
    return jsonb_build_object(
      'actividad_id', v_r.actividad_id, 'codigo', v_r.codigo, 'titulo', v_r.titulo,
      'descripcion', v_r.descripcion, 'puntos', v_r.puntos, 'minutos', v_r.minutos,
      'cajas', v_r.cajas, 'controles', v_r.controles,
      'opcional', v_r.opcional, 'requiere', v_r.requiere, 'falta', v_falta,
      -- El plazo sí va, aunque esté bloqueado: es justo lo que el alumno necesita
      -- para decidir si le conviene apurarse con el oficial.
      'puntua_desde', v_r.puntua_desde, 'puntua_hasta', v_r.puntua_hasta,
      'en_plazo', v_r.en_plazo,
      'bloques', '[]'::jsonb, 'respuestas', '{}'::jsonb, 'revisiones', '{}'::jsonb,
      'tramo', 0, 'entregado_en', null);
  end if;

  return to_jsonb(v_r) || jsonb_build_object('falta', null);
end;
$$;

-- ============================== La lista ==============================
-- Cambia la forma de la tabla que devuelve, así que hay que soltarla antes:
-- `create or replace` no puede alterar las columnas de salida de una función.

drop function if exists public.mis_laboratorios(uuid);

create function public.mis_laboratorios(p_matricula uuid)
returns table (
  codigo text, titulo text, opcional boolean, requiere text, falta text,
  puntua_desde timestamptz, puntua_hasta timestamptz, en_plazo boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select a.codigo, a.titulo, l.opcional, l.requiere,
         public.laboratorio_falta(p_matricula, a.id),
         a.puntua_desde, a.puntua_hasta,
         coalesce(public.actividad_en_plazo(a.id, now()), true)
    from public.actividades a
    join public.laboratorios l on l.actividad_id = a.id
    join public.secciones    s on s.asignatura_id = a.asignatura_id
                              and s.periodo_id    = a.periodo_id
    join public.matriculas  mt on mt.seccion_id = s.id
   where mt.id = p_matricula and a.activa
     and (public.mi_matricula(p_matricula) or public.docente_ve_matricula(p_matricula))
   order by a.orden;
$$;

-- ============================== Lo que ve el docente ==============================
-- Las dos fechas, si el plazo está abierto ahora, y cuántas de las entregas
-- cobraron. Ese último número es el que dice si el plazo está puesto donde
-- corresponde: «24 entregas · 5 a tiempo» significa que la fecha está mal, no que
-- el curso sea flojo.

drop function if exists public.actividades_que_dicto(uuid, uuid);

create function public.actividades_que_dicto(p_asignatura uuid, p_periodo uuid)
returns table (
  id uuid, codigo text, titulo text, descripcion text, tipo text,
  puntos integer, orden integer, activa boolean, entregas integer,
  puntua_desde timestamptz, puntua_hasta timestamptz,
  en_plazo boolean, a_tiempo integer
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.codigo, a.titulo, a.descripcion, a.tipo, a.puntos, a.orden, a.activa,
         (select count(*)::integer from public.resultados_actividad r
           where r.actividad_id = a.id),
         a.puntua_desde, a.puntua_hasta,
         coalesce(public.actividad_en_plazo(a.id, now()), true),
         -- Se recalcula contra `completada_en` en vez de leer el `a_tiempo` que
         -- `laboratorio_entregar` deja en el detalle: así el número también sale
         -- bien para lo entregado antes de esta migración y para el diagnóstico,
         -- que no escribe ese campo.
         (select count(*)::integer from public.resultados_actividad r
           where r.actividad_id = a.id
             and coalesce(public.actividad_en_plazo(a.id, r.completada_en), true))
    from public.actividades a
   where a.asignatura_id = p_asignatura and a.periodo_id = p_periodo
     and public.docente_ve_actividad(a.id)
   order by a.orden, a.codigo;
$$;

-- ============================== Administrar el plazo ==============================
-- Dos parámetros más. Se suelta la firma vieja en vez de dejar que convivan: dos
-- sobrecargas con los mismos primeros diez argumentos son una llamada ambigua
-- esperando a ocurrir, y el `grant` de la 0019 nombra la firma exacta.

drop function if exists public.actividad_guardar(
  uuid, uuid, uuid, text, text, text, text, integer, integer, boolean);

create function public.actividad_guardar(
  p_id           uuid,
  p_asignatura   uuid,
  p_periodo      uuid,
  p_codigo       text,
  p_titulo       text,
  p_descripcion  text,
  p_tipo         text,
  p_puntos       integer,
  p_orden        integer,
  p_activa       boolean,
  p_puntua_desde timestamptz default null,
  p_puntua_hasta timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_id is null then
    if not exists (select 1 from public.docente_asignaturas da
                    where da.docente_id = public.usuario_actual()
                      and da.asignatura_id = p_asignatura and da.periodo_id = p_periodo) then
      raise exception 'No dictas esa asignatura en ese periodo';
    end if;
  elsif not public.docente_ve_actividad(p_id) then
    raise exception 'Esa actividad no es de un curso que dictes';
  end if;

  if coalesce(trim(p_codigo), '') = '' then raise exception 'La actividad necesita un código'; end if;
  if coalesce(trim(p_titulo), '') = '' then raise exception 'La actividad necesita un título'; end if;
  if p_tipo not in ('diagnostico', 'laboratorio', 'entrega') then
    raise exception 'Tipo desconocido: %', p_tipo;
  end if;
  if coalesce(p_puntos, 0) < 0 then raise exception 'Los puntos no pueden ser negativos'; end if;

  -- El `check` de la tabla lo atajaría igual, pero con un mensaje que habla de
  -- restricciones y no de fechas. El docente está mirando dos campos.
  if p_puntua_desde is not null and p_puntua_hasta is not null
     and p_puntua_hasta < p_puntua_desde then
    raise exception 'El plazo termina antes de empezar: revisa las dos fechas';
  end if;

  if p_id is null then
    insert into public.actividades (asignatura_id, periodo_id, codigo, titulo, descripcion,
                                    tipo, puntos, orden, activa, puntua_desde, puntua_hasta)
    values (p_asignatura, p_periodo, trim(p_codigo), trim(p_titulo), nullif(trim(p_descripcion), ''),
            p_tipo, coalesce(p_puntos, 0), coalesce(p_orden, 0), coalesce(p_activa, true),
            p_puntua_desde, p_puntua_hasta)
    returning id into v_id;
  else
    update public.actividades
       set codigo = trim(p_codigo), titulo = trim(p_titulo),
           descripcion = nullif(trim(p_descripcion), ''), tipo = p_tipo,
           puntos = coalesce(p_puntos, 0), orden = coalesce(p_orden, 0),
           activa = coalesce(p_activa, true),
           -- Sin `coalesce`: nulo acá significa «quítale el plazo», y el panel
           -- necesita poder hacerlo. Quien no quiera tocarlas manda las que ya
           -- estaban, que es lo que hace el formulario.
           puntua_desde = p_puntua_desde, puntua_hasta = p_puntua_hasta
     where id = p_id
    returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id);
exception
  when unique_violation then
    raise exception 'Ya existe una actividad con el código % en este ramo', p_codigo;
end;
$$;

-- ============================== Permisos ==============================
-- Las columnas nuevas no necesitan `grant`: `actividades` tiene el select a nivel
-- de tabla (0002). Las funciones sí, porque tres se soltaron y volvieron a nacer.

grant execute on function
  public.actividad_en_plazo(uuid, timestamptz),
  public.mis_laboratorios(uuid),
  public.actividades_que_dicto(uuid, uuid),
  public.actividad_guardar(uuid, uuid, uuid, text, text, text, text,
                           integer, integer, boolean, timestamptz, timestamptz)
  to pulso_app;
