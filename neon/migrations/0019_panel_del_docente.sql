-- Lo que el docente necesita para administrar su curso sin pedirle nada a nadie.
--
-- Hasta ahora media plataforma se administraba con scripts: precios, términos,
-- clases, contraseñas. Eso significa que el docente depende de que alguien más
-- corra algo. Acá van las operaciones que faltaban, todas con la misma forma:
-- `security definer` y, adentro, la comprobación de que la sección o la actividad
-- es de una asignatura que **él dicta**. Cambiar el id en la petición no le abre
-- el curso de otro.
--
-- Un caso merece explicación aparte: `docente_alumnos` devuelve el **correo**, y
-- `usuarios` es la tabla de credenciales, sellada para `pulso_app`. La función
-- expone solo esa columna y solo de sus secciones. El docente necesita el correo
-- para identificar a quién está mirando —hay dos «Benjamín» en el mismo curso—,
-- y no hay forma de dárselo sin pasar por acá. El hash nunca sale.

-- ============================== Secciones que dicta ==============================

create or replace function public.secciones_que_dicto(p_asignatura uuid, p_periodo uuid)
returns table (id uuid, codigo text, activa boolean, matriculados integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.codigo, s.activa,
         (select count(*)::integer from public.matriculas mt
           where mt.seccion_id = s.id and mt.activa)
    from public.secciones s
   where s.asignatura_id = p_asignatura and s.periodo_id = p_periodo
     and public.docente_ve_seccion(s.id)
   order by s.codigo;
$$;

-- ============================== La nómina, con correo ==============================

create or replace function public.docente_alumnos(p_asignatura uuid, p_periodo uuid)
returns table (
  matricula_id uuid,
  perfil_id    uuid,
  nombre       text,
  correo       text,
  avatar       text,
  seccion_id   uuid,
  seccion      text,
  activa       boolean,
  creado_en    timestamptz,
  puntos       integer,
  experiencia  integer,
  clases_abiertas   integer,
  clases_terminadas integer,
  diagnostico  boolean,
  ultimo_ingreso timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select mt.id, pf.id, pf.nombre, u.correo, pf.avatar,
         s.id, s.codigo, mt.activa, mt.creado_en,
         coalesce((select sum(m.puntos)::integer from public.movimientos_puntos m
                    where m.matricula_id = mt.id), 0),
         coalesce((select sum(e.xp)::integer from public.movimientos_experiencia e
                    where e.matricula_id = mt.id), 0),
         (select count(*)::integer from public.progreso_clase pc where pc.matricula_id = mt.id),
         (select count(*)::integer from public.progreso_clase pc
           where pc.matricula_id = mt.id and pc.terminada_en is not null),
         exists (select 1 from public.resultados_actividad r
                   join public.actividades a on a.id = r.actividad_id and a.tipo = 'diagnostico'
                  where r.matricula_id = mt.id),
         u.ultimo_ingreso
    from public.matriculas  mt
    join public.perfiles    pf on pf.id = mt.perfil_id
    join public.usuarios    u  on u.id  = pf.id
    join public.secciones   s  on s.id  = mt.seccion_id
   where s.asignatura_id = p_asignatura and s.periodo_id = p_periodo
     and public.docente_ve_seccion(s.id)
   order by pf.nombre;
$$;

-- ============================== Mover de sección ==============================

create or replace function public.alumno_cambiar_seccion(p_matricula uuid, p_seccion uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_perfil uuid; v_actual uuid;
begin
  if not public.docente_ve_matricula(p_matricula) then
    raise exception 'Esa matrícula no es de un curso que dictes';
  end if;
  if not public.docente_ve_seccion(p_seccion) then
    raise exception 'Esa sección no es de un curso que dictes';
  end if;

  select perfil_id, seccion_id into v_perfil, v_actual
    from public.matriculas where id = p_matricula;
  if v_actual = p_seccion then
    return jsonb_build_object('cambio', false, 'motivo', 'ya estaba en esa sección');
  end if;

  -- La restricción única es (perfil, sección): si ya tiene matrícula en la
  -- sección destino, moverlo crearía un choque. Es un caso real —un alumno que
  -- se cambió y volvió— y conviene decirlo en vez de reventar con un error de
  -- llave duplicada que no explica nada.
  if exists (select 1 from public.matriculas
              where perfil_id = v_perfil and seccion_id = p_seccion) then
    raise exception 'Ese alumno ya tiene una matrícula en esa sección';
  end if;

  -- Los puntos, la experiencia y el progreso cuelgan de la matrícula, así que
  -- moverla los lleva consigo. Es lo que se quiere: cambiarse de sección no
  -- borra lo que hiciste.
  update public.matriculas set seccion_id = p_seccion where id = p_matricula;
  return jsonb_build_object('cambio', true);
end;
$$;

-- ============================== Dar de baja o reactivar ==============================

create or replace function public.alumno_activar(p_matricula uuid, p_activa boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.docente_ve_matricula(p_matricula) then
    raise exception 'Esa matrícula no es de un curso que dictes';
  end if;
  -- Nunca se borra: `activa = false` la saca de listas y promedios sin perder el
  -- historial de lo que el alumno hizo mientras cursaba.
  update public.matriculas set activa = p_activa where id = p_matricula;
end;
$$;

-- ============================== Reiniciar la contraseña ==============================
-- Mientras no exista la pantalla de recuperar contraseña, esto es lo que evita
-- que un alumno bloqueado tenga que esperar a que alguien abra un terminal.

create or replace function public.alumno_reiniciar_clave(p_matricula uuid, p_clave text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_perfil uuid;
begin
  if not public.docente_ve_matricula(p_matricula) then
    raise exception 'Esa matrícula no es de un curso que dictes';
  end if;
  if length(coalesce(p_clave, '')) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres';
  end if;

  select perfil_id into v_perfil from public.matriculas where id = p_matricula;
  update public.usuarios
     set clave_hash = crypt(p_clave, gen_salt('bf'))
   where id = v_perfil;
end;
$$;

-- ============================== Actividades y laboratorios ==============================

create or replace function public.actividades_que_dicto(p_asignatura uuid, p_periodo uuid)
returns table (
  id uuid, codigo text, titulo text, descripcion text, tipo text,
  puntos integer, orden integer, activa boolean, entregas integer
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.codigo, a.titulo, a.descripcion, a.tipo, a.puntos, a.orden, a.activa,
         (select count(*)::integer from public.resultados_actividad r where r.actividad_id = a.id)
    from public.actividades a
   where a.asignatura_id = p_asignatura and a.periodo_id = p_periodo
     and public.docente_ve_actividad(a.id)
   order by a.orden, a.codigo;
$$;

create or replace function public.actividad_guardar(
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
declare v_id uuid;
begin
  -- Al crear se comprueba la asignatura; al editar, la actividad. Son dos
  -- comprobaciones distintas: la primera impide inventar actividades en un curso
  -- ajeno, la segunda impide editar las de otro.
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

  if p_id is null then
    insert into public.actividades (asignatura_id, periodo_id, codigo, titulo, descripcion,
                                    tipo, puntos, orden, activa)
    values (p_asignatura, p_periodo, trim(p_codigo), trim(p_titulo), nullif(trim(p_descripcion), ''),
            p_tipo, coalesce(p_puntos, 0), coalesce(p_orden, 0), coalesce(p_activa, true))
    returning id into v_id;
  else
    update public.actividades
       set codigo = trim(p_codigo), titulo = trim(p_titulo),
           descripcion = nullif(trim(p_descripcion), ''), tipo = p_tipo,
           puntos = coalesce(p_puntos, 0), orden = coalesce(p_orden, 0),
           activa = coalesce(p_activa, true)
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

grant execute on function
  public.secciones_que_dicto(uuid, uuid),
  public.docente_alumnos(uuid, uuid),
  public.alumno_cambiar_seccion(uuid, uuid),
  public.alumno_activar(uuid, boolean),
  public.alumno_reiniciar_clave(uuid, text),
  public.actividades_que_dicto(uuid, uuid),
  public.actividad_guardar(uuid, uuid, uuid, text, text, text, text, integer, integer, boolean)
  to pulso_app;
