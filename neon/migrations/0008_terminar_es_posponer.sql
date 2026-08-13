-- El mínimo de tiempo tiene que posponer el término, no negarlo.
--
-- Cómo se rompió: `progreso_clase_guardar()` exige que hayan pasado
-- `segundos_minimos` desde la apertura para pagar el término. La idea era que
-- saltar al final no valiera lo mismo que recorrer la clase. Pero el alumno que
-- llegaba al final **antes** de ese plazo recibía un «no» y ese «no» quedaba para
-- siempre, porque el script del navegador deduplica: si el avance reportado no
-- cambia —y al final ya no cambia nada— no vuelve a preguntar nunca. Da igual que
-- se quede una hora con la pestaña abierta.
--
-- Se vio en los datos: 14 de 38 alumnos en DSY1107/S01 llegaron a la última
-- diapositiva y no cobraron, y Brad estuvo 2.976 segundos en DSY1107/D1 —cinco
-- veces el umbral de 570— sin cobrar tampoco. Ese último caso es la prueba de que
-- el problema no era solo el umbral, sino que nadie volvía a preguntar.
--
-- Tres cambios:
--
--   1. `progreso_clase_guardar()` devuelve `faltan_segundos`, para que el
--      navegador sepa exactamente cuándo volver a preguntar en vez de adivinar.
--   2. `abrir_clase()` liquida un término pendiente al reabrir la clase. Así,
--      aunque el alumno cierre la pestaña, la próxima vez que entre lo cobra.
--      Es la red que hace que nunca se pierda.
--   3. El umbral baja de 15 a 8 segundos por diapositiva. Con los tiempos reales
--      a la vista, 15 era demasiado: alumnos que claramente leyeron —257, 262,
--      244 segundos en un deck de 21 diapositivas— quedaban bajo la línea.

-- ============================== Umbral más razonable ==============================

update public.clases
   set segundos_minimos = slides * 8,
       actualizada_en   = now()
 where segundos_minimos <> slides * 8;

-- ============================== Abrir liquida lo pendiente ==============================

create or replace function public.abrir_clase(p_clase uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_usuario   uuid := public.usuario_actual();
  v_clase     public.clases;
  v_matricula uuid;
  v_docente   boolean;
  v_nueva     boolean := false;
  v_pr        public.progreso_clase;
  v_puntos    integer := 0;
begin
  if v_usuario is null then
    raise exception 'Sin sesión';
  end if;

  select * into v_clase from public.clases where id = p_clase;
  if not found then
    raise exception 'Esa clase no existe';
  end if;

  v_docente := public.docente_ve_clase(p_clase);

  -- El docente entra siempre, publicada o no: es su material y necesita revisarlo
  -- antes de abrirlo al curso. No se le anota progreso ni se le dan puntos.
  if v_docente then
    return jsonb_build_object(
      'archivo', v_clase.archivo, 'titulo', v_clase.titulo, 'codigo', v_clase.codigo,
      'clase_id', v_clase.id, 'docente', true, 'matricula_id', null,
      'slides', v_clase.slides, 'puntos_nuevos', 0);
  end if;

  if v_clase.publicada_desde is null or v_clase.publicada_desde > now() then
    raise exception 'Esa clase todavía no está publicada';
  end if;

  v_matricula := public.mi_matricula_de_clase(p_clase);
  if v_matricula is null then
    raise exception 'Esa clase no es de un ramo que estés cursando';
  end if;

  -- `do nothing` y no `do update`: así FOUND distingue de verdad la primera
  -- apertura de una repetida, y dos pestañas abiertas a la vez no cobran dos
  -- veces. Con `do update` habría que comparar timestamps para adivinarlo.
  insert into public.progreso_clase (matricula_id, clase_id)
  values (v_matricula, p_clase)
  on conflict (matricula_id, clase_id) do nothing;
  v_nueva := found;

  if not v_nueva then
    update public.progreso_clase set vista_en = now()
     where matricula_id = v_matricula and clase_id = p_clase;
  end if;

  if v_nueva and v_clase.puntos_abrir > 0 then
    insert into public.movimientos_puntos (matricula_id, puntos, motivo)
    values (v_matricula, v_clase.puntos_abrir,
            'Abrió la clase ' || v_clase.codigo || ' · ' || v_clase.titulo);
    v_puntos := v_puntos + v_clase.puntos_abrir;
  end if;

  -- La red de seguridad: si ya había llegado al final y solo le faltaba cumplir el
  -- tiempo, se le paga acá. El alumno que recorrió la clase rápido y cerró la
  -- pestaña lo cobra la próxima vez que entre, sin tener que hacer nada especial.
  select * into v_pr from public.progreso_clase
   where matricula_id = v_matricula and clase_id = p_clase;

  if v_pr.terminada_en is null
     and v_clase.slides > 0
     and v_pr.slide_max >= v_clase.slides - 1
     and now() - v_pr.abierta_en >= make_interval(secs => v_clase.segundos_minimos)
  then
    update public.progreso_clase set terminada_en = now()
     where matricula_id = v_matricula and clase_id = p_clase;
    if v_clase.puntos_terminar > 0 then
      insert into public.movimientos_puntos (matricula_id, puntos, motivo)
      values (v_matricula, v_clase.puntos_terminar,
              'Terminó la clase ' || v_clase.codigo || ' · ' || v_clase.titulo);
      v_puntos := v_puntos + v_clase.puntos_terminar;
    end if;
  end if;

  return jsonb_build_object(
    'archivo', v_clase.archivo, 'titulo', v_clase.titulo, 'codigo', v_clase.codigo,
    'clase_id', v_clase.id, 'docente', false, 'matricula_id', v_matricula,
    'slides', v_clase.slides, 'puntos_nuevos', v_puntos);
end;
$$;

-- ============================== Decir cuánto falta ==============================

create or replace function public.progreso_clase_guardar(
  p_clase      uuid,
  p_slide      integer,
  p_respuestas jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clase       public.clases;
  v_matricula   uuid;
  v_pr          public.progreso_clase;
  v_nuevos      integer[] := '{}'::integer[];
  v_idx         integer;
  v_llave       text;
  v_valor       text;
  v_puntos      integer := 0;
  v_termina     boolean := false;
  v_slide       integer := greatest(coalesce(p_slide, 0), 0);
  v_slide_max   integer;
  v_faltan      integer := 0;
begin
  select * into v_clase from public.clases where id = p_clase;
  if not found then
    raise exception 'Esa clase no existe';
  end if;

  -- El docente puede recorrer su propio deck sin que le anotemos nada.
  if public.docente_ve_clase(p_clase) then
    return jsonb_build_object('puntos_nuevos', 0, 'aciertos', 0,
                              'terminada', false, 'faltan_segundos', 0);
  end if;

  v_matricula := public.mi_matricula_de_clase(p_clase);
  if v_matricula is null then
    raise exception 'Esa clase no es de un ramo que estés cursando';
  end if;

  select * into v_pr from public.progreso_clase
   where matricula_id = v_matricula and clase_id = p_clase;
  if not found then
    raise exception 'Abre la clase antes de guardar avance';
  end if;

  -- Quiz acertados que todavía no se han pagado. `pauta` manda: si el índice no
  -- está en la pauta, ese widget no da puntos (los de ordenar o completar no
  -- llevan alternativa correcta declarada).
  --
  -- El recorrido va en plpgsql y no en un `select ... where`: las llaves vienen
  -- del navegador, y en plpgsql el `and` corta de izquierda a derecha, así que
  -- el cast a entero solo ocurre después de comprobar que la llave es numérica.
  -- Dentro de un WHERE de SQL el planificador puede reordenar las condiciones y
  -- un `{"hola":"x"}` reventaría el cast antes de que lo filtre nada.
  for v_llave, v_valor in
    select llave, valor
      from jsonb_each_text(coalesce(p_respuestas, '{}'::jsonb)) as r(llave, valor)
  loop
    if v_llave ~ '^[0-9]{1,4}$'
       and v_clase.pauta ? v_llave
       and lower(trim(v_valor)) = lower(trim(v_clase.pauta ->> v_llave))
    then
      v_idx := v_llave::integer;
      if not (v_idx = any (v_pr.aciertos)) and not (v_idx = any (v_nuevos)) then
        v_nuevos := v_nuevos || v_idx;
      end if;
    end if;
  end loop;

  -- El motivo se lee en el historial de puntos del alumno, así que se escribe
  -- como se habla: «una actividad», no «1 actividad(es)».
  if array_length(v_nuevos, 1) > 0 and v_clase.puntos_actividad > 0 then
    v_puntos := v_puntos + array_length(v_nuevos, 1) * v_clase.puntos_actividad;
    insert into public.movimientos_puntos (matricula_id, puntos, motivo)
    values (v_matricula, array_length(v_nuevos, 1) * v_clase.puntos_actividad,
            case when array_length(v_nuevos, 1) = 1
                 then 'Resolvió una actividad de ' || v_clase.codigo
                 else 'Resolvió ' || array_length(v_nuevos, 1)
                        || ' actividades de ' || v_clase.codigo
            end);
  end if;

  v_slide_max := greatest(v_pr.slide_max, v_slide);

  -- Terminar exige llegar al final y haber tardado un mínimo razonable. Pero el
  -- mínimo **pospone**, no niega: si todavía no se cumple, se devuelve cuánto
  -- falta para que el navegador vuelva a preguntar en el momento justo. Y si
  -- cierra la pestaña, `abrir_clase()` lo liquida la próxima vez que entre.
  if v_pr.terminada_en is null and v_clase.slides > 0 and v_slide_max >= v_clase.slides - 1 then
    v_faltan := greatest(0, ceil(extract(epoch from (
                  v_pr.abierta_en + make_interval(secs => v_clase.segundos_minimos) - now()
                )))::integer);
    if v_faltan = 0 then
      v_termina := true;
      if v_clase.puntos_terminar > 0 then
        v_puntos := v_puntos + v_clase.puntos_terminar;
        insert into public.movimientos_puntos (matricula_id, puntos, motivo)
        values (v_matricula, v_clase.puntos_terminar,
                'Terminó la clase ' || v_clase.codigo || ' · ' || v_clase.titulo);
      end if;
    end if;
  end if;

  update public.progreso_clase
     set slide_max    = v_slide_max,
         aciertos     = aciertos || v_nuevos,
         vista_en     = now(),
         terminada_en = case when v_termina then now() else terminada_en end
   where matricula_id = v_matricula and clase_id = p_clase;

  return jsonb_build_object(
    'puntos_nuevos', v_puntos,
    'aciertos', coalesce(array_length(v_pr.aciertos, 1), 0) + coalesce(array_length(v_nuevos, 1), 0),
    'terminada', v_termina or v_pr.terminada_en is not null,
    'faltan_segundos', v_faltan);
end;
$$;

grant execute on function
  public.abrir_clase(uuid),
  public.progreso_clase_guardar(uuid, integer, jsonb)
  to pulso_app;

-- ============================== Pagar lo que se debe ==============================
-- A quien llegó a la última diapositiva y no cobró el término. No se distingue
-- quién habría cumplido el tiempo si el reintento hubiera funcionado, y el fallo
-- fue nuestro, así que se paga a todos los que llegaron al final.

with pendientes as (
  select pc.matricula_id, pc.clase_id, c.codigo, c.titulo, c.puntos_terminar
    from public.progreso_clase pc
    join public.clases c on c.id = pc.clase_id
   where pc.terminada_en is null
     and c.slides > 0
     and pc.slide_max >= c.slides - 1
     and c.puntos_terminar > 0
), pagados as (
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  select matricula_id, puntos_terminar,
         'Terminó la clase ' || codigo || ' · ' || titulo
    from pendientes
  returning matricula_id
)
update public.progreso_clase pc
   set terminada_en = now()
 where exists (select 1 from pendientes p
                where p.matricula_id = pc.matricula_id and p.clase_id = pc.clase_id);
