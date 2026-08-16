-- Qué cuenta como caja respondida.
--
-- `trim(texto)` en Postgres quita **solo espacios**: `trim(E'\n')` devuelve el
-- salto de línea intacto y `length(...) > 0` da verdadero. Así que una caja con
-- un Enter y nada más contaba como respondida.
--
-- Eso rompía dos cosas. El alumno podía entregar sin haber escrito nada —y la
-- entrega es irreversible desde su lado y paga los puntos—. Y la cuenta del
-- docente no coincidía con la que ve el alumno en pantalla, porque el `.trim()`
-- de JavaScript sí considera vacío un salto de línea: los dos números salían de
-- la misma respuesta y no daban igual.
--
-- Se saca a una función para que la entrega, la cuenta del docente y cualquier
-- cosa que venga después usen la misma definición. Que «respondida» signifique
-- dos cosas distintas en dos consultas es exactamente cómo empezó esto.

create or replace function public.tiene_texto(p_valor text)
returns boolean
language sql
immutable
parallel safe
as $$
  -- Espacio, tabulación, salto de línea y retorno de carro: lo que un teclado
  -- deja caer en una caja sin que el alumno haya escrito nada.
  select coalesce(length(btrim(p_valor, E' \t\n\r\f\v')) > 0, false);
$$;

grant execute on function public.tiene_texto(text) to pulso_app;

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
   where public.tiene_texto(value);
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
           where public.tiene_texto(e.value)),
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

grant execute on function
  public.laboratorio_entregar(uuid, text),
  public.laboratorio_avances(uuid, uuid, text)
  to pulso_app;
