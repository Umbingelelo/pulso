-- Guardar una actividad sin nombrar el plazo lo deja como estaba.
--
-- La 0028 le agregó a `actividad_guardar` los dos parámetros del plazo **con valor
-- por omisión nulo**. Parecía lo compatible: una llamada de diez argumentos sigue
-- resolviendo contra la firma de doce. Y sigue —pero le escribe nulo a las dos
-- columnas, así que **borra el plazo**.
--
-- Eso ya está pasando en producción. La base quedó migrada antes que el frontend, y
-- el panel que hay desplegado manda diez argumentos: apretar «Guardar» en cualquier
-- actividad —para corregirle una tilde al título— le quita la fecha y el laboratorio
-- vuelve a pagar siempre, para todos. Sin error en ninguna parte. Comprobado contra
-- la base antes de escribir esto.
--
-- ── Por qué dos firmas y no un `coalesce` ──
--
-- Con valores por omisión no se puede distinguir «no me lo mencionaron» de «me lo
-- mandaron nulo a propósito», y las dos cosas tienen que existir: el panel nuevo
-- necesita poder **quitar** un plazo mandando nulo. Así que la diferencia se lleva a
-- la firma, que es lo único que Postgres puede mirar:
--
--   diez argumentos  → edita la actividad y **no toca** el plazo
--   doce argumentos  → el plazo es exactamente lo que digan los dos últimos
--
-- Y por eso la de doce pierde sus valores por omisión: con ellos, una llamada de
-- diez calzaría con las dos firmas y Postgres la rechazaría por ambigua.
--
-- La de diez no repite ninguna validación: lee el plazo que ya está guardado y llama
-- a la de doce con eso. Dos copias de las mismas reglas es como se terminan
-- comportando distinto.

-- ============================== La de doce, sin omisiones ==============================

drop function if exists public.actividad_guardar(
  uuid, uuid, uuid, text, text, text, text, integer, integer, boolean, timestamptz, timestamptz);

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
  p_puntua_desde timestamptz,
  p_puntua_hasta timestamptz
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
           -- Sin `coalesce`: acá nulo significa «quítale el plazo». Quien no quiera
           -- tocarlo llama a la firma de diez.
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

-- ============================== La de diez, que respeta el plazo ==============================

/**
 * Editar una actividad sin hablar del plazo.
 *
 * Es la firma que existía antes de la 0028, y vuelve a existir con el mismo
 * significado que tenía: cambia lo que le pasan y **nada más**. Al crear una
 * actividad nueva el `select` no encuentra fila, así que nace sin plazo, que es lo
 * correcto.
 */
create function public.actividad_guardar(
  p_id          uuid,
  p_asignatura  uuid,
  p_periodo     uuid,
  p_codigo      text,
  p_titulo      text,
  p_descripcion text,
  p_tipo        text,
  p_puntos      integer,
  p_orden       integer,
  p_activa      boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_desde timestamptz; v_hasta timestamptz;
begin
  select puntua_desde, puntua_hasta into v_desde, v_hasta
    from public.actividades where id = p_id;

  return public.actividad_guardar(
    p_id, p_asignatura, p_periodo, p_codigo, p_titulo, p_descripcion,
    p_tipo, p_puntos, p_orden, p_activa, v_desde, v_hasta);
end;
$$;

grant execute on function
  public.actividad_guardar(uuid, uuid, uuid, text, text, text, text,
                           integer, integer, boolean),
  public.actividad_guardar(uuid, uuid, uuid, text, text, text, text,
                           integer, integer, boolean, timestamptz, timestamptz)
  to pulso_app;
