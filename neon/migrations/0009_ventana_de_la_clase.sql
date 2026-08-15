-- La ventana de la clase: llegar a tiempo vale más que llegar después.
--
-- Hasta ahora una clase valía lo mismo el día que se dictaba que tres semanas
-- después. Eso premia por igual a quien llegó preparado y a quien la abrió la
-- noche antes de la prueba. Ahora cada clase tiene una **ventana**:
--
--   publicada_desde ──────────── ventana_hasta ──────────────▶
--        │      puntos completos       │   puntos × factor_atrasado
--        │                             │
--     se puede abrir              cierra la ventana
--
-- Antes de `publicada_desde` no se puede abrir; el alumno no la ve. Entre las dos
-- fechas todo vale completo. Después de `ventana_hasta` sigue valiendo —queremos
-- que repase igual— pero menos. `ventana_hasta` en null significa que no hay
-- castigo nunca, que es como se comportaban las clases que ya estaban subidas.
--
-- El factor se decide **en el momento de cada cobro**, no al abrir. Así el alumno
-- que abre durante la clase y resuelve las actividades ahí mismo cobra completo,
-- y el que abre a tiempo pero la termina en tres semanas cobra completo la
-- apertura y reducido el resto. Es lo que se quiere premiar: haberla visto, no
-- haber alcanzado a hacer clic.
--
-- Con una excepción que importa: el término se valora con el instante en que el
-- alumno **llegó a la última diapositiva**, no con el instante en que se le paga.
-- Entre los dos puede pasar el mínimo de tiempo de la 0008, y sería absurdo que
-- nuestra propia demora lo dejara fuera de la ventana. Para eso está
-- `alcanzo_final_en`.

-- ============================== Campos nuevos ==============================

alter table public.clases
  add column if not exists ventana_hasta    timestamptz,
  add column if not exists factor_atrasado  numeric(4,2) not null default 0.50;

alter table public.clases
  drop constraint if exists clases_factor_sensato;
alter table public.clases
  add constraint clases_factor_sensato check (factor_atrasado >= 0 and factor_atrasado <= 1);

alter table public.clases
  drop constraint if exists clases_ventana_despues_de_publicar;
alter table public.clases
  add constraint clases_ventana_despues_de_publicar
  check (ventana_hasta is null or publicada_desde is null or ventana_hasta >= publicada_desde);

alter table public.progreso_clase
  add column if not exists alcanzo_final_en timestamptz;

-- Las filas que ya existen: se toma el momento en que se dio por terminada, o la
-- última vez que se vio. Todas son anteriores a que existieran las ventanas, así
-- que ninguna queda castigada —`ventana_hasta` es null en todas.
update public.progreso_clase pc
   set alcanzo_final_en = coalesce(pc.terminada_en, pc.vista_en)
  from public.clases c
 where c.id = pc.clase_id
   and pc.alcanzo_final_en is null
   and c.slides > 0
   and pc.slide_max >= c.slides - 1;

-- ============================== El factor ==============================

create or replace function public.factor_clase(p_clase uuid, p_momento timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
           when c.ventana_hasta is null then 1.00
           when coalesce(p_momento, now()) <= c.ventana_hasta then 1.00
           else c.factor_atrasado
         end
    from public.clases c where c.id = p_clase;
$$;

-- Cuánto vale de verdad un tramo, ya redondeado. En un solo lugar para que abrir,
-- resolver y terminar no puedan discrepar entre sí.
create or replace function public.puntos_con_factor(
  p_clase uuid, p_puntos integer, p_momento timestamptz)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, round(coalesce(p_puntos, 0) * public.factor_clase(p_clase, p_momento)))::integer;
$$;

-- Para que el motivo del movimiento diga la verdad en el historial del alumno.
create or replace function public.sufijo_atraso(p_clase uuid, p_momento timestamptz)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.factor_clase(p_clase, p_momento) < 1 then ' (fuera de plazo)' else '' end;
$$;

-- ============================== Abrir ==============================

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
  v_pago      integer;
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
      'slides', v_clase.slides, 'puntos_nuevos', 0, 'en_ventana', true);
  end if;

  if v_clase.publicada_desde is null or v_clase.publicada_desde > now() then
    raise exception 'Esa clase todavía no está publicada';
  end if;

  v_matricula := public.mi_matricula_de_clase(p_clase);
  if v_matricula is null then
    raise exception 'Esa clase no es de un ramo que estés cursando';
  end if;

  insert into public.progreso_clase (matricula_id, clase_id)
  values (v_matricula, p_clase)
  on conflict (matricula_id, clase_id) do nothing;
  v_nueva := found;

  if not v_nueva then
    update public.progreso_clase set vista_en = now()
     where matricula_id = v_matricula and clase_id = p_clase;
  end if;

  if v_nueva then
    v_pago := public.puntos_con_factor(p_clase, v_clase.puntos_abrir, now());
    if v_pago > 0 then
      insert into public.movimientos_puntos (matricula_id, puntos, motivo)
      values (v_matricula, v_pago,
              'Abrió la clase ' || v_clase.codigo || ' · ' || v_clase.titulo
                || public.sufijo_atraso(p_clase, now()));
      v_puntos := v_puntos + v_pago;
    end if;
  end if;

  -- La red de la 0008: si ya había llegado al final y solo le faltaba cumplir el
  -- tiempo, se le paga acá. El factor se calcula con `alcanzo_final_en`, no con
  -- ahora: llegó al final cuando llegó, y puede haber sido dentro de la ventana.
  select * into v_pr from public.progreso_clase
   where matricula_id = v_matricula and clase_id = p_clase;

  if v_pr.terminada_en is null
     and v_clase.slides > 0
     and v_pr.slide_max >= v_clase.slides - 1
     and now() - v_pr.abierta_en >= make_interval(secs => v_clase.segundos_minimos)
  then
    update public.progreso_clase set terminada_en = now()
     where matricula_id = v_matricula and clase_id = p_clase;
    v_pago := public.puntos_con_factor(
                p_clase, v_clase.puntos_terminar,
                coalesce(v_pr.alcanzo_final_en, v_pr.vista_en));
    if v_pago > 0 then
      insert into public.movimientos_puntos (matricula_id, puntos, motivo)
      values (v_matricula, v_pago,
              'Terminó la clase ' || v_clase.codigo || ' · ' || v_clase.titulo
                || public.sufijo_atraso(p_clase, coalesce(v_pr.alcanzo_final_en, v_pr.vista_en)));
      v_puntos := v_puntos + v_pago;
    end if;
  end if;

  return jsonb_build_object(
    'archivo', v_clase.archivo, 'titulo', v_clase.titulo, 'codigo', v_clase.codigo,
    'clase_id', v_clase.id, 'docente', false, 'matricula_id', v_matricula,
    'slides', v_clase.slides, 'puntos_nuevos', v_puntos,
    'en_ventana', public.factor_clase(p_clase, now()) = 1);
end;
$$;

-- ============================== Guardar el avance ==============================

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
  v_pago        integer;
  v_termina     boolean := false;
  v_slide       integer := greatest(coalesce(p_slide, 0), 0);
  v_slide_max   integer;
  v_faltan      integer := 0;
  v_final_en    timestamptz;
begin
  select * into v_clase from public.clases where id = p_clase;
  if not found then
    raise exception 'Esa clase no existe';
  end if;

  if public.docente_ve_clase(p_clase) then
    return jsonb_build_object('puntos_nuevos', 0, 'aciertos', 0,
                              'terminada', false, 'faltan_segundos', 0, 'en_ventana', true);
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

  -- Quiz acertados que todavía no se han pagado. El recorrido va en plpgsql y no
  -- en un `select ... where`: las llaves vienen del navegador, y en plpgsql el
  -- `and` corta de izquierda a derecha, así que el cast a entero solo ocurre
  -- después de comprobar que la llave es numérica. Dentro de un WHERE de SQL el
  -- planificador puede reordenar y un {"hola":"x"} reventaría el cast.
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

  -- Las actividades se valoran ahora: resolverlas es el acto, y hacerlo durante
  -- la clase es justo lo que se quiere premiar.
  if array_length(v_nuevos, 1) > 0 then
    v_pago := array_length(v_nuevos, 1)
              * public.puntos_con_factor(p_clase, v_clase.puntos_actividad, now());
    if v_pago > 0 then
      v_puntos := v_puntos + v_pago;
      insert into public.movimientos_puntos (matricula_id, puntos, motivo)
      values (v_matricula, v_pago,
              case when array_length(v_nuevos, 1) = 1
                   then 'Resolvió una actividad de ' || v_clase.codigo
                   else 'Resolvió ' || array_length(v_nuevos, 1)
                          || ' actividades de ' || v_clase.codigo
              end || public.sufijo_atraso(p_clase, now()));
    end if;
  end if;

  v_slide_max := greatest(v_pr.slide_max, v_slide);

  -- El instante en que llegó al final se anota la primera vez que ocurre, y es el
  -- que decide el factor del término. Si se usara `now()` al pagar, el mínimo de
  -- tiempo de la 0008 podría empujarlo fuera de la ventana por culpa nuestra.
  v_final_en := v_pr.alcanzo_final_en;
  if v_final_en is null and v_clase.slides > 0 and v_slide_max >= v_clase.slides - 1 then
    v_final_en := now();
  end if;

  if v_pr.terminada_en is null and v_clase.slides > 0 and v_slide_max >= v_clase.slides - 1 then
    v_faltan := greatest(0, ceil(extract(epoch from (
                  v_pr.abierta_en + make_interval(secs => v_clase.segundos_minimos) - now()
                )))::integer);
    if v_faltan = 0 then
      v_termina := true;
      v_pago := public.puntos_con_factor(p_clase, v_clase.puntos_terminar, v_final_en);
      if v_pago > 0 then
        v_puntos := v_puntos + v_pago;
        insert into public.movimientos_puntos (matricula_id, puntos, motivo)
        values (v_matricula, v_pago,
                'Terminó la clase ' || v_clase.codigo || ' · ' || v_clase.titulo
                  || public.sufijo_atraso(p_clase, v_final_en));
      end if;
    end if;
  end if;

  update public.progreso_clase
     set slide_max        = v_slide_max,
         aciertos         = aciertos || v_nuevos,
         vista_en         = now(),
         alcanzo_final_en = coalesce(alcanzo_final_en, v_final_en),
         terminada_en     = case when v_termina then now() else terminada_en end
   where matricula_id = v_matricula and clase_id = p_clase;

  return jsonb_build_object(
    'puntos_nuevos', v_puntos,
    'aciertos', coalesce(array_length(v_pr.aciertos, 1), 0) + coalesce(array_length(v_nuevos, 1), 0),
    'terminada', v_termina or v_pr.terminada_en is not null,
    'faltan_segundos', v_faltan,
    'en_ventana', public.factor_clase(p_clase, now()) = 1);
end;
$$;

-- ============================== Lo que ve el alumno ==============================

drop view if exists public.mis_clases;
create view public.mis_clases with (security_invoker = true) as
  select c.id, c.asignatura_id, c.periodo_id, c.codigo, c.titulo, c.descripcion,
         c.orden, c.dictada_el, c.slides, c.actividades,
         c.puntos_abrir, c.puntos_actividad, c.puntos_terminar,
         c.publicada_desde, c.ventana_hasta, c.factor_atrasado,
         (c.ventana_hasta is null or now() <= c.ventana_hasta) as en_ventana,
         mt.id as matricula_id,
         pr.abierta_en, pr.slide_max, pr.terminada_en,
         coalesce(array_length(pr.aciertos, 1), 0)::integer as resueltas,
         (pr.matricula_id is not null) as abierta
    from public.clases     c
    join public.secciones  s  on s.asignatura_id = c.asignatura_id
                             and s.periodo_id    = c.periodo_id
    join public.matriculas mt on mt.seccion_id = s.id
    left join public.progreso_clase pr on pr.clase_id = c.id
                                      and pr.matricula_id = mt.id
   where mt.activa
     and c.publicada_desde is not null
     and c.publicada_desde <= now();

-- ============================== Lo que ve el docente ==============================
-- Trae también las **no publicadas**, que es justo lo que hay que programar. El
-- RLS de `clases` ya deja entrar al docente a las suyas, publicadas o no.

drop view if exists public.clases_que_dicto;
create view public.clases_que_dicto with (security_invoker = true) as
  select c.id, c.asignatura_id, c.periodo_id, a.sigla, a.nombre as asignatura,
         p.codigo as periodo, c.codigo, c.titulo, c.descripcion, c.orden,
         c.dictada_el, c.slides, c.actividades,
         c.puntos_abrir, c.puntos_actividad, c.puntos_terminar,
         c.publicada_desde, c.ventana_hasta, c.factor_atrasado,
         (c.publicada_desde is not null and c.publicada_desde <= now()) as publicada,
         (c.ventana_hasta is null or now() <= c.ventana_hasta)          as en_ventana,
         (select count(*) from public.progreso_clase pc where pc.clase_id = c.id)::integer
           as abrieron,
         (select count(*) from public.progreso_clase pc
           where pc.clase_id = c.id and pc.terminada_en is not null)::integer
           as terminaron,
         (select count(*) from public.progreso_clase pc
           where pc.clase_id = c.id
             and (c.ventana_hasta is null or pc.abierta_en <= c.ventana_hasta))::integer
           as a_tiempo
    from public.clases      c
    join public.asignaturas a on a.id = c.asignatura_id
    join public.periodos    p on p.id = c.periodo_id
   where public.docente_ve_clase(c.id);

-- ============================== Programar, desde la app ==============================
-- El docente ajusta horario, ventana y puntos sin tocar el terminal. `security
-- definer` porque `clases` no tiene política de update para nadie: si la tuviera,
-- habría que confiar en que el cliente mande solo lo suyo. Acá se comprueba
-- adentro y no hay forma de programar la clase de otro.

create or replace function public.clase_programar(
  p_clase            uuid,
  p_publicada_desde  timestamptz,
  p_ventana_hasta    timestamptz,
  p_factor_atrasado  numeric   default null,
  p_puntos_abrir     integer   default null,
  p_puntos_actividad integer   default null,
  p_puntos_terminar  integer   default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_clase public.clases;
begin
  if not public.docente_ve_clase(p_clase) then
    raise exception 'Esa clase no es de una asignatura que dictes';
  end if;

  if p_ventana_hasta is not null and p_publicada_desde is not null
     and p_ventana_hasta < p_publicada_desde then
    raise exception 'La ventana no puede cerrarse antes de que la clase se publique';
  end if;
  if p_factor_atrasado is not null and (p_factor_atrasado < 0 or p_factor_atrasado > 1) then
    raise exception 'El factor fuera de plazo va entre 0 y 1';
  end if;
  if coalesce(p_puntos_abrir, 0) < 0 or coalesce(p_puntos_actividad, 0) < 0
     or coalesce(p_puntos_terminar, 0) < 0 then
    raise exception 'Los puntos no pueden ser negativos';
  end if;

  update public.clases
     set publicada_desde  = p_publicada_desde,
         ventana_hasta    = p_ventana_hasta,
         factor_atrasado  = coalesce(p_factor_atrasado,  factor_atrasado),
         puntos_abrir     = coalesce(p_puntos_abrir,     puntos_abrir),
         puntos_actividad = coalesce(p_puntos_actividad, puntos_actividad),
         puntos_terminar  = coalesce(p_puntos_terminar,  puntos_terminar),
         actualizada_en   = now()
   where id = p_clase
  returning * into v_clase;

  return jsonb_build_object(
    'id', v_clase.id, 'codigo', v_clase.codigo,
    'publicada_desde', v_clase.publicada_desde, 'ventana_hasta', v_clase.ventana_hasta,
    'factor_atrasado', v_clase.factor_atrasado,
    'puntos_abrir', v_clase.puntos_abrir, 'puntos_actividad', v_clase.puntos_actividad,
    'puntos_terminar', v_clase.puntos_terminar);
end;
$$;

-- ============================== Permisos ==============================

grant select (id, asignatura_id, periodo_id, codigo, titulo, descripcion, orden,
              dictada_el, slides, actividades, puntos_abrir, puntos_actividad,
              puntos_terminar, publicada_desde, ventana_hasta, factor_atrasado,
              creada_en)
  on public.clases to pulso_app;

grant select on public.mis_clases       to pulso_app;
grant select on public.clases_que_dicto to pulso_app;

grant execute on function
  public.factor_clase(uuid, timestamptz),
  public.puntos_con_factor(uuid, integer, timestamptz),
  public.sufijo_atraso(uuid, timestamptz),
  public.abrir_clase(uuid),
  public.progreso_clase_guardar(uuid, integer, jsonb),
  public.clase_programar(uuid, timestamptz, timestamptz, numeric, integer, integer, integer)
  to pulso_app;
