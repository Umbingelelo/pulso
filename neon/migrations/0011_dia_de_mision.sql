-- El día de misión no empieza a medianoche: empieza a las 23:59.
--
-- El alumno genera su misión diaria apretando un botón, y ese botón se vuelve a
-- habilitar a las 23:59 hora de Chile. Expresado como fecha, es correr el borde
-- del día un minuto hacia atrás:
--
--     23:58 → +1 min = 23:59 del mismo día  → cuenta como HOY
--     23:59 → +1 min = 00:00 del siguiente  → cuenta como MAÑANA
--     00:30 → +1 min = 00:31                → cuenta como HOY
--
-- Con eso, «una vez cada 24 horas» sale gratis: la restricción única sobre
-- (matrícula, día, tipo) ya impide dos misiones del mismo día, y el día cambia
-- a las 23:59.
--
-- Efecto secundario conocido, y es chico: en la transición 23:58 → 23:59 alguien
-- puede tomar la misión de hoy y, un minuto después, la de mañana. Al día
-- siguiente ya no tiene ninguna pendiente a las 23:58, así que el ritmo vuelve a
-- ser de una por día. El truco rinde **una** misión extra en todo el semestre;
-- no vale la pena defenderse de eso con más maquinaria.

create or replace function public.dia_mision()
returns date
language sql
stable
as $$
  select ((now() at time zone 'America/Santiago') + interval '1 minute')::date;
$$;

comment on function public.dia_mision() is
  'El día al que pertenece una misión. Cambia a las 23:59 de Santiago, no a medianoche.';

-- ============================== Usarlo en todas partes ==============================
-- `hoy_en_chile()` se queda para lo que sea calendario de verdad; las misiones
-- pasan a `dia_mision()`. Tenerlas separadas evita que alguien «arregle» una y
-- desincronice la otra sin darse cuenta.

create or replace function public.mision_registrar(
  p_matricula uuid,
  p_plantilla text,
  p_tipo      text,
  p_enunciado jsonb,
  p_solucion  jsonb,
  p_origen    text default 'modelo'
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
                               enunciado, solucion, xp, origen)
  values (p_matricula, v_pl.id, v_fecha, p_tipo, p_enunciado, p_solucion, v_pl.xp, p_origen)
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

create or replace function public.mi_mision(p_matricula uuid, p_tipo text default 'diaria')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_m record;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select m.id, m.fecha, m.tipo, m.enunciado, m.xp, m.resuelta_en, m.acertada,
         m.intentos, p.codigo as plantilla, p.nombre, p.mecanica, p.banda
    into v_m
    from public.misiones m
    join public.mision_plantillas p on p.id = m.plantilla_id
   where m.matricula_id = p_matricula
     and m.tipo = p_tipo
     and m.fecha = public.dia_mision();

  if not found then return null; end if;
  return to_jsonb(v_m);
end;
$$;

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
    else
      -- Que reviente. Dar por buena una respuesta que no se sabe corregir es
      -- regalar experiencia, y en silencio.
      raise exception 'La mecánica % todavía no sabe corregirse', v_mecanica;
  end case;

  update public.misiones
     set resuelta_en = now(),
         acertada    = v_acerto,
         intentos    = intentos + 1
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
    'solucion', v_m.solucion);   -- ya respondió: ahora sí puede ver la pauta
end;
$$;

-- ============================== Estado del botón ==============================
-- Lo que necesita la pantalla para decidir si el botón va habilitado, y desde
-- cuándo lo estará si no. La cuenta regresiva la calcula el servidor: el reloj
-- del computador del alumno no es una fuente de verdad.

create or replace function public.estado_mision(p_matricula uuid, p_tipo text default 'diaria')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tiene    boolean;
  v_proximo  timestamptz;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select exists (select 1 from public.misiones
                  where matricula_id = p_matricula and tipo = p_tipo
                    and fecha = public.dia_mision())
    into v_tiene;

  -- Las 23:59 de Chile del día de misión en curso, expresadas en UTC.
  v_proximo := ((public.dia_mision()::timestamp - interval '1 day' + time '23:59')
                  at time zone 'America/Santiago');
  if v_proximo <= now() then
    v_proximo := ((public.dia_mision()::timestamp + time '23:59') at time zone 'America/Santiago');
  end if;

  return jsonb_build_object(
    'dia', public.dia_mision(),
    'ya_tiene', v_tiene,
    'puede_generar', not v_tiene,
    'proxima_en', v_proximo,
    'faltan_segundos', greatest(0, ceil(extract(epoch from (v_proximo - now())))::bigint));
end;
$$;

grant execute on function
  public.dia_mision(),
  public.mi_mision(uuid, text),
  public.estado_mision(uuid, text),
  public.mision_responder(uuid, jsonb)
  to pulso_app;

grant execute on function
  public.mision_registrar(uuid, text, text, jsonb, jsonb, text),
  public.dia_mision()
  to pulso_misiones;

revoke execute on function
  public.mision_registrar(uuid, text, text, jsonb, jsonb, text) from public;
