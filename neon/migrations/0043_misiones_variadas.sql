-- La misión diaria deja de ser siempre un quiz.
--
-- El docente lo planteó así: una sola pregunta de alternativas al día es
-- monótona, y los alumnos ya detectaron los vicios —«la más larga es la
-- correcta»—. A la vez, no se puede gastar la key del modelo como si sobrara.
--
-- Esta migración es la parte de la base de cinco mecánicas, y las tres cosas que
-- cuidan el gasto y la seguridad:
--
--   * `quiz` queda como estaba (la corrección no cambia);
--   * `emparejar`, `verdadero_falso` y `diagrama` se corrigen acá, de forma
--     determinista, contra la pauta guardada. `emparejar` además no usa modelo;
--   * `desarrollo` es respuesta abierta y la corrige un modelo **en el servidor**.
--     La base nunca recibe un veredicto de la aplicación: solo `pulso_misiones`
--     puede ejecutar `mision_calificar()`, y `mision_responder()` se niega a
--     corregir esta mecánica. Ver la nota de más abajo.
--
-- ── Compatible con el frontend y la API publicados ──
--
-- La base migra antes que el despliegue (README «La base migra antes que el
-- frontend»). Lo que sigue corriendo hasta entonces es `/api/mision`, que llama
-- `mision_registrar` con seis argumentos y siempre con la plantilla `quiz`.
--
--   * `mision_registrar` gana dos parámetros (tokens y costo) como una **segunda
--     firma** de ocho argumentos sin valores por omisión; la de seis queda como
--     envoltorio que llama a la nueva con nulos. Con omisiones, una llamada de
--     seis calzaría con las dos y Postgres la rechazaría por ambigua.
--   * `mision_responder` conserva la rama `quiz` tal cual.
--   * Las plantillas nuevas se insertan activas, pero nadie las sortea hasta que
--     se despliegue la API que rota.
--
-- ── Qué se guarda de la respuesta ──
--
-- Hasta ahora no se guardaba nada de lo que el alumno contestó: bastaba con
-- `acertada`. Para las mecánicas nuevas se guarda dentro de `solucion` (clave
-- `respuesta`), por dos razones: la pantalla, al recargar, puede mostrar **cuáles
-- de las cuatro** parejas estaban mal —sin eso, solo ve las correctas—, y en
-- `desarrollo` el docente necesita poder ver qué escribió el alumno cuando
-- reclama por un veredicto del modelo. `solucion` sigue sin grant para
-- `pulso_app`; `mi_mision` la entrega solo una vez resuelta (0033).
--
-- ── El veredicto de un modelo paga XP, y es una decisión consciente ──
--
-- En los laboratorios, el veredicto del modelo es una sugerencia que no toca los
-- puntos, porque los puntos de laboratorio cuentan para la nota. La experiencia
-- de las misiones es otra moneda —alimenta el pase y el ranking, no la
-- evaluación—, así que acá un veredicto puede pagar: logrado, todo; parcial, la
-- mitad; incompleto, nada. `acertada` queda como «pagó algo».

-- ============================== Qué costó cada misión ==============================
-- Nulo = no se midió (las que ya existen, y las que registra la API anterior).
-- Sin grant para `pulso_app`: es contabilidad del docente, no del alumno.

alter table public.misiones
  add column if not exists tokens    integer,
  add column if not exists costo_usd numeric(10, 6);

-- ============================== Registrar, con el gasto ==============================

create or replace function public.mision_registrar(
  p_matricula uuid,
  p_plantilla text,
  p_tipo      text,
  p_enunciado jsonb,
  p_solucion  jsonb,
  p_origen    text,
  p_tokens    integer,
  p_costo     numeric
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_pl    public.mision_plantillas;
  v_id    uuid;
  v_fecha date := public.dia_mision();
begin
  select * into v_pl from public.mision_plantillas where codigo = p_plantilla and activa;
  if not found then
    raise exception 'No existe la plantilla % o está desactivada', p_plantilla;
  end if;
  if not exists (select 1 from public.matriculas where id = p_matricula and activa) then
    raise exception 'Esa matrícula no existe o está dada de baja';
  end if;

  insert into public.misiones (matricula_id, plantilla_id, fecha, tipo,
                               enunciado, solucion, xp, origen, tokens, costo_usd)
  values (p_matricula, v_pl.id, v_fecha, p_tipo, p_enunciado, p_solucion, v_pl.xp, p_origen,
          p_tokens, p_costo)
  -- Dos pestañas apretando el botón a la vez: gana la primera y la segunda
  -- recibe la que ya existe. Nadie termina con dos misiones del mismo día.
  on conflict (matricula_id, fecha, tipo) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.misiones
     where matricula_id = p_matricula and fecha = v_fecha and tipo = p_tipo;
  end if;

  return jsonb_build_object('id', v_id, 'fecha', v_fecha, 'xp', v_pl.xp);
end;
$$;

-- La firma de seis argumentos sigue sirviendo a la API publicada.
create or replace function public.mision_registrar(
  p_matricula uuid,
  p_plantilla text,
  p_tipo      text,
  p_enunciado jsonb,
  p_solucion  jsonb,
  p_origen    text default 'modelo'
)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
  select public.mision_registrar(p_matricula, p_plantilla, p_tipo, p_enunciado, p_solucion,
                                 p_origen, null::integer, null::numeric);
$$;

-- Igual que la de seis: nunca a `pulso_app`, que podría inscribirse una misión
-- con la solución elegida por él mismo.
revoke execute on function
  public.mision_registrar(uuid, text, text, jsonb, jsonb, text, integer, numeric) from public;
grant execute on function
  public.mision_registrar(uuid, text, text, jsonb, jsonb, text, integer, numeric) to pulso_misiones;

-- ============================== Las plantillas nuevas ==============================
-- La instrucción y el esquema reales los copia `neon/sembrar-plantillas.mjs` desde
-- el código; acá van los marcadores para que la fila exista y pague 75 como el
-- quiz (0039). `on conflict do nothing`: si el docente ya ajustó una, no se pisa.

insert into public.mision_plantillas (codigo, nombre, mecanica, banda, instruccion, esquema, xp, activa, orden)
values
  ('emparejar',       'Une cada término con su definición', 'emparejar',       'contenido',
   'Sin modelo: las definiciones salen del banco del docente.', '{}'::jsonb, 75, true, 2),
  ('verdadero_falso', 'Verdadero o falso',                  'verdadero_falso', 'contenido',
   '(la instrucción se siembra desde lib/mecanicas)',            '{}'::jsonb, 75, true, 3),
  ('diagrama',        'Completa el diagrama',               'diagrama',        'ingenio',
   '(la instrucción se siembra desde lib/mecanicas)',            '{}'::jsonb, 75, true, 4),
  ('desarrollo',      'Pregunta de desarrollo',             'desarrollo',      'contenido',
   '(la instrucción se siembra desde lib/mecanicas)',            '{}'::jsonb, 75, true, 5)
on conflict (codigo) do nothing;

-- ============================== Lo que ya se preguntó, con los términos de varios ==============================
-- `contexto_mision` armaba «lo ya preguntado» con `enunciado->>'termino'`. Un
-- emparejar trae cuatro términos en `enunciado->'terminos'` y ninguno en
-- `termino`; sin esto, esos cuatro se podían repetir mañana. Y ojo con el nulo:
-- `x = any(array[null, 'a'])` da nulo, y `not nulo` es nulo, o sea que **un solo
-- nulo en el arreglo dejaba sin candidatos a todo el banco**. Por eso se filtra.
-- Es la misma función de la 0013, con una sola consulta distinta.

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

  -- Lo que ya se le preguntó: el término de las misiones de un término y los
  -- cuatro de las de emparejar. Sin nulos.
  select coalesce(array_agg(t), '{}')
    into v_usados
    from (select unnest(
                   array_remove(
                     array[m.enunciado->>'termino']
                       || coalesce(array(select jsonb_array_elements_text(m.enunciado->'terminos')), '{}'),
                     null)) as t
            from (select enunciado from public.misiones
                   where matricula_id = p_matricula
                   order by fecha desc limit 30) m) u;

  select count(*), count(*) filter (where acertada)
    into v_intentos, v_aciertos
    from public.misiones
   where matricula_id = p_matricula and resuelta_en is not null;

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

-- ============================== Candidatos para emparejar ==============================
-- Devuelve hasta `p_n` términos con su definición, de las clases que el alumno
-- abrió, **los menos usados primero** (y entre ellos al azar). El servidor pide
-- más de los cuatro que necesita (8) y elige cuatro que no se pisen entre sí: una
-- definición que nombra a otro de los términos deja la pareja resuelta por
-- descarte.
--
-- El filtro de forma —entre 25 y 200 caracteres y sin viñeta ni número al inicio—
-- descarta lo que en el banco no se sostiene solo: hay entradas que son un
-- fragmento («se confunden todo el tiempo…») o que arrancan con una viñeta suelta
-- («· lo micro Captura…»). Son útiles como contexto de un quiz, no como una
-- definición que emparejar.
--
-- Si el alumno ya vio todo, los usados se permiten (van al final): igual que
-- `termino_para_mision`, se prefiere repetir a preguntar por lo que no se ha
-- enseñado.

create or replace function public.terminos_para_emparejar(p_matricula uuid, p_n integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ctx    jsonb := public.contexto_mision(p_matricula);   -- también valida que sea suya
  v_vistas text[] := array(select jsonb_array_elements_text(v_ctx->'clases_vistas'));
  v_usados text[] := array(select jsonb_array_elements_text(v_ctx->'terminos_usados'));
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'termino', x.termino, 'definicion', x.definicion, 'fuente', x.fuente))
      from (
        select b.termino, b.definicion, b.fuente
          from public.mision_banco b
          join public.secciones  s  on s.asignatura_id = b.asignatura_id
                                   and s.periodo_id    = b.periodo_id
          join public.matriculas mt on mt.seccion_id = s.id
         where mt.id = p_matricula
           and b.activo
           and split_part(b.fuente, ' ', 1) = any (v_vistas)
           and length(b.definicion) between 25 and 200
           and b.definicion !~ '^[·•*0-9[:space:]–—-]'
         order by (b.termino = any (v_usados)), random()
         limit greatest(4, least(coalesce(p_n, 8), 16))) x
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.terminos_para_emparejar(uuid, integer) to pulso_app;

-- ============================== Responder ==============================
-- Misma función de la 0011 con cuatro ramas nuevas. `quiz` no cambia ni una
-- línea. Las ramas nuevas **guardan lo que el alumno contestó**, acotado a las
-- claves que esa mecánica espera: esta función la puede llamar cualquiera con su
-- token, y no hay razón para guardarle a un alumno un jsonb de tamaño libre.
--
-- `desarrollo` revienta a propósito: esa mecánica la corrige un modelo en el
-- servidor y la anota `mision_calificar()`. Si esta función aceptara algo para
-- ella, sería un camino para cobrar sin que nadie corrija.

create or replace function public.mision_responder(p_mision uuid, p_respuesta jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_m        public.misiones;
  v_mecanica text;
  v_acerto   boolean;
  v_xp       integer := 0;
  v_extra    jsonb;
  v_n        integer;
  v_i        integer;
  v_resp     jsonb;
begin
  select * into v_m from public.misiones where id = p_mision;
  if not found then raise exception 'Esa misión no existe'; end if;
  if not public.mi_matricula(v_m.matricula_id) then
    raise exception 'Esa misión no es tuya';
  end if;
  if v_m.resuelta_en is not null then
    raise exception 'Esa misión ya está resuelta';
  end if;
  if v_m.fecha <> public.dia_mision() then
    raise exception 'Esa misión ya venció';
  end if;

  select mecanica into v_mecanica
    from public.mision_plantillas where id = v_m.plantilla_id;

  case v_mecanica
    when 'quiz' then
      v_acerto := (p_respuesta ->> 'elegida') is not null
              and (p_respuesta ->> 'elegida') = (v_m.solucion ->> 'correcta');

    when 'diagrama' then
      v_acerto := (p_respuesta ->> 'elegida') is not null
              and (p_respuesta ->> 'elegida') = (v_m.solucion ->> 'correcta');
      v_extra := jsonb_build_object('respuesta', left(coalesce(p_respuesta ->> 'elegida', ''), 8));

    when 'verdadero_falso' then
      -- `solucion.respuestas[i]` es 'v' o 'f' para la afirmación i; el alumno
      -- manda `a0`…`a3`. Las cuatro bien o nada.
      v_n := coalesce(jsonb_array_length(v_m.solucion -> 'respuestas'), 0);
      v_acerto := v_n > 0;
      v_resp := '[]'::jsonb;
      for v_i in 0 .. v_n - 1 loop
        if (p_respuesta ->> ('a' || v_i)) is distinct from (v_m.solucion -> 'respuestas' ->> v_i) then
          v_acerto := false;
        end if;
        v_resp := v_resp || to_jsonb(left(coalesce(p_respuesta ->> ('a' || v_i), ''), 8));
      end loop;
      v_extra := jsonb_build_object('respuesta', v_resp);

    when 'emparejar' then
      -- `solucion.pares[j]` es el término de la definición j; el alumno manda
      -- `d0`…`d3` con el índice de término que eligió para cada definición.
      v_n := coalesce(jsonb_array_length(v_m.solucion -> 'pares'), 0);
      v_acerto := v_n > 0;
      v_resp := '[]'::jsonb;
      for v_i in 0 .. v_n - 1 loop
        if (p_respuesta ->> ('d' || v_i)) is distinct from (v_m.solucion -> 'pares' ->> v_i) then
          v_acerto := false;
        end if;
        v_resp := v_resp || to_jsonb(left(coalesce(p_respuesta ->> ('d' || v_i), ''), 8));
      end loop;
      v_extra := jsonb_build_object('respuesta', v_resp);

    when 'desarrollo' then
      raise exception 'Esa misión se corrige en el servidor, con tu texto: no se responde por acá';

    else
      -- Que reviente. Dar por buena una respuesta que no se sabe corregir es
      -- regalar experiencia, y en silencio.
      raise exception 'La mecánica % todavía no sabe corregirse', v_mecanica;
  end case;

  update public.misiones
     set resuelta_en = now(),
         acertada    = v_acerto,
         intentos    = intentos + 1,
         solucion    = solucion || coalesce(v_extra, '{}'::jsonb)
   where id = p_mision;

  if v_acerto then
    v_xp := v_m.xp;
    insert into public.movimientos_experiencia (matricula_id, xp, motivo)
    values (v_m.matricula_id, v_xp,
            case v_m.tipo when 'semanal' then 'Misión semanal' else 'Misión diaria' end
              || ' · ' || to_char(v_m.fecha, 'DD/MM'));
  end if;

  return jsonb_build_object(
    'acertada', v_acerto,
    'xp_ganada', v_xp,
    'solucion', v_m.solucion || coalesce(v_extra, '{}'::jsonb));   -- ya respondió: ahora sí puede ver la pauta
end;
$$;

grant execute on function public.mision_responder(uuid, jsonb) to pulso_app;

-- ============================== Desarrollo: leer la pauta y calificar ==============================
-- Dos funciones, **ninguna para `pulso_app`**, y las dos reciben el id del usuario
-- porque el servidor llega con el rol `pulso_misiones` y no con la identidad del
-- alumno (`mi_matricula()` no sirve acá). Ese id sale de la cookie de sesión
-- firmada, ya verificada por `/api/mision-responder`; las funciones lo cruzan con
-- el dueño de la misión.
--
--   mision_pauta     → lo que el modelo necesita para corregir: la pregunta, la
--                       definición del docente y las ideas clave. El alumno no
--                       puede leerlo antes de responder, y acá tampoco lo recibe.
--   mision_calificar → anota el veredicto, paga la experiencia y guarda lo que
--                       escribió. Una sola vez: bloquea la fila, así que dos
--                       envíos simultáneos no pagan doble.
--
-- Pago: logrado = todo; parcial = la mitad (entera, hacia abajo); incompleto = 0.

create or replace function public.mision_pauta(p_mision uuid, p_usuario uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_m        public.misiones;
  v_mecanica text;
begin
  select * into v_m from public.misiones where id = p_mision;
  if not found then raise exception 'Esa misión no existe'; end if;
  if not exists (select 1 from public.matriculas
                  where id = v_m.matricula_id and perfil_id = p_usuario) then
    raise exception 'Esa misión no es tuya';
  end if;
  if v_m.resuelta_en is not null then raise exception 'Esa misión ya está resuelta'; end if;
  if v_m.fecha <> public.dia_mision() then raise exception 'Esa misión ya venció'; end if;

  select mecanica into v_mecanica from public.mision_plantillas where id = v_m.plantilla_id;
  if v_mecanica <> 'desarrollo' then
    raise exception 'Esa misión no se corrige con texto libre';
  end if;

  return jsonb_build_object(
    'enunciado', v_m.enunciado,
    'solucion',  v_m.solucion,
    'asignatura', (select a.nombre
                     from public.matriculas mt
                     join public.secciones   s on s.id = mt.seccion_id
                     join public.asignaturas a on a.id = s.asignatura_id
                    where mt.id = v_m.matricula_id));
end;
$$;

create or replace function public.mision_calificar(
  p_mision     uuid,
  p_usuario    uuid,
  p_veredicto  text,
  p_comentario text,
  p_respuesta  text,
  p_tokens     integer,
  p_costo      numeric
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_m        public.misiones;
  v_mecanica text;
  v_xp       integer;
  v_extra    jsonb;
begin
  -- `for update`: si llegan dos envíos a la vez, el segundo espera y ve la misión
  -- ya resuelta. Sin esto, los dos pagarían.
  select * into v_m from public.misiones where id = p_mision for update;
  if not found then raise exception 'Esa misión no existe'; end if;
  if not exists (select 1 from public.matriculas
                  where id = v_m.matricula_id and perfil_id = p_usuario) then
    raise exception 'Esa misión no es tuya';
  end if;
  if v_m.resuelta_en is not null then raise exception 'Esa misión ya está resuelta'; end if;
  if v_m.fecha <> public.dia_mision() then raise exception 'Esa misión ya venció'; end if;

  select mecanica into v_mecanica from public.mision_plantillas where id = v_m.plantilla_id;
  if v_mecanica <> 'desarrollo' then
    raise exception 'Esa misión no se corrige con texto libre';
  end if;
  if p_veredicto is null or p_veredicto not in ('logrado', 'parcial', 'incompleto') then
    raise exception 'Veredicto desconocido: %', p_veredicto;
  end if;

  v_xp := case p_veredicto
            when 'logrado' then v_m.xp
            when 'parcial' then v_m.xp / 2
            else 0 end;

  v_extra := jsonb_build_object(
    'respuesta',   left(coalesce(p_respuesta, ''), 600),
    'veredicto',   p_veredicto,
    'explicacion', left(coalesce(p_comentario, ''), 700),
    'xp_ganada',   v_xp);

  update public.misiones
     set resuelta_en = now(),
         acertada    = v_xp > 0,
         intentos    = intentos + 1,
         solucion    = solucion || v_extra,
         tokens      = coalesce(tokens, 0)    + coalesce(p_tokens, 0),
         costo_usd   = coalesce(costo_usd, 0) + coalesce(p_costo, 0)
   where id = p_mision;

  if v_xp > 0 then
    insert into public.movimientos_experiencia (matricula_id, xp, motivo)
    values (v_m.matricula_id, v_xp,
            case v_m.tipo when 'semanal' then 'Misión semanal' else 'Misión diaria' end
              || ' · ' || to_char(v_m.fecha, 'DD/MM')
              || case when p_veredicto = 'parcial' then ' · respuesta parcial' else '' end);
  end if;

  return jsonb_build_object(
    'acertada',  v_xp > 0,
    'xp_ganada', v_xp,
    'veredicto', p_veredicto,
    'solucion',  v_m.solucion || v_extra);
end;
$$;

-- Ni `pulso_app` ni nadie más: ver la cabecera de esta sección.
revoke execute on function public.mision_pauta(uuid, uuid) from public;
revoke execute on function
  public.mision_calificar(uuid, uuid, text, text, text, integer, numeric) from public;
grant execute on function public.mision_pauta(uuid, uuid)  to pulso_misiones;
grant execute on function
  public.mision_calificar(uuid, uuid, text, text, text, integer, numeric) to pulso_misiones;

-- ============================== Comprobación ==============================

do $$
begin
  if (select count(*) from public.mision_plantillas
       where codigo in ('quiz', 'emparejar', 'verdadero_falso', 'diagrama', 'desarrollo')
         and activa and xp = 75) <> 5 then
    raise exception 'Las cinco plantillas de misión tienen que existir, activas y a 75 XP';
  end if;

  -- La que protege el XP: la app no puede ni leer la pauta ni calificar, ni
  -- inscribirse una misión.
  if has_function_privilege('pulso_app', 'public.mision_calificar(uuid,uuid,text,text,text,integer,numeric)', 'EXECUTE')
     or has_function_privilege('pulso_app', 'public.mision_pauta(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('pulso_app', 'public.mision_registrar(uuid,text,text,jsonb,jsonb,text,integer,numeric)', 'EXECUTE')
     or has_function_privilege('pulso_app', 'public.mision_registrar(uuid,text,text,jsonb,jsonb,text)', 'EXECUTE') then
    raise exception 'pulso_app no debe poder calificar, leer la pauta ni registrar misiones';
  end if;

  if not has_function_privilege('pulso_misiones', 'public.mision_calificar(uuid,uuid,text,text,text,integer,numeric)', 'EXECUTE')
     or not has_function_privilege('pulso_misiones', 'public.mision_pauta(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('pulso_misiones', 'public.mision_registrar(uuid,text,text,jsonb,jsonb,text,integer,numeric)', 'EXECUTE')
     or not has_function_privilege('pulso_misiones', 'public.mision_registrar(uuid,text,text,jsonb,jsonb,text)', 'EXECUTE') then
    raise exception 'pulso_misiones perdió un permiso que necesita';
  end if;

  if not has_function_privilege('pulso_app', 'public.mision_responder(uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('pulso_app', 'public.terminos_para_emparejar(uuid,integer)', 'EXECUTE')
     or not has_function_privilege('pulso_app', 'public.mi_mision(uuid,text)', 'EXECUTE') then
    raise exception 'Una función de las misiones quedó sin grant para pulso_app';
  end if;
end
$$;
