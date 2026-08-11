-- Funciones, vistas y Row Level Security.
--
-- Sobre las credenciales: el hash **nunca sale de Postgres**. La capa de API no
-- lee `usuarios` —no tiene permiso—, sino que llama a `autenticar(correo, clave)`
-- y recibe un id o nada. La comparación la hace `crypt()` dentro de la base, con
-- el mismo bcrypt que usaba Supabase, así que los hashes migran tal cual y los
-- alumnos conservan su contraseña.
--
-- Eso deja la tabla de credenciales sellada: RLS activo, ninguna política, ningún
-- permiso para `pulso_app`. Ni un error de programación en la API puede filtrar
-- un hash, porque el rol con el que se conecta no puede leer esa tabla.

create extension if not exists pgcrypto;

-- ============================== Credenciales ==============================

create or replace function public.autenticar(p_correo text, p_clave text)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  update public.usuarios
     set ultimo_ingreso = now()
   where lower(correo) = lower(trim(p_correo))
     and clave_hash = crypt(p_clave, clave_hash)
  returning id;
$$;

-- Crea usuario, perfil y primera matrícula de una vez. Es lo que antes hacía el
-- trigger sobre `auth.users`, ahora explícito y transaccional.
create or replace function public.registrar_alumno(
  p_correo  text,
  p_clave   text,
  p_nombre  text,
  p_seccion uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_nombre text := nullif(trim(p_nombre), '');
begin
  if v_nombre is null or length(v_nombre) < 3 then
    raise exception 'El nombre es demasiado corto';
  end if;
  if position('@' in coalesce(p_correo, '')) < 2 then
    raise exception 'Ese correo no parece válido';
  end if;
  if length(coalesce(p_clave, '')) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres';
  end if;

  if exists (select 1 from public.usuarios where lower(correo) = lower(trim(p_correo))) then
    raise exception 'Ese correo ya tiene una cuenta';
  end if;

  insert into public.usuarios (correo, clave_hash)
  values (trim(p_correo), crypt(p_clave, gen_salt('bf')))
  returning id into v_id;

  insert into public.perfiles (id, nombre) values (v_id, v_nombre);

  -- Sin sección válida se crea igual la cuenta y la app ofrece matricularse
  -- después: el registro no se cae por eso.
  if p_seccion is not null and exists (
        select 1 from public.secciones s
          join public.periodos p on p.id = s.periodo_id
         where s.id = p_seccion and s.activa and p.activo) then
    insert into public.matriculas (perfil_id, seccion_id) values (v_id, p_seccion);
  end if;

  return v_id;
end;
$$;

create or replace function public.cambiar_clave(p_actual text, p_nueva text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid := public.usuario_actual();
begin
  if v_id is null then raise exception 'Sin sesión'; end if;
  if length(coalesce(p_nueva, '')) < 8 then
    raise exception 'La contraseña nueva debe tener al menos 8 caracteres';
  end if;
  if not exists (select 1 from public.usuarios
                  where id = v_id and clave_hash = crypt(p_actual, clave_hash)) then
    raise exception 'La contraseña actual no es correcta';
  end if;
  update public.usuarios set clave_hash = crypt(p_nueva, gen_salt('bf')) where id = v_id;
end;
$$;

-- ============================== Helpers del RLS ==============================
-- `security definer` a propósito: las políticas los llaman desde dentro de otras
-- políticas y, sin esto, la consulta volvería a evaluar el RLS de la tabla
-- consultada y entraría en recursión.

create or replace function public.es_docente()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.docentes d where d.id = public.usuario_actual());
$$;

create or replace function public.docente_ve_seccion(p_seccion uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.secciones s
      join public.docente_asignaturas da
        on da.asignatura_id = s.asignatura_id and da.periodo_id = s.periodo_id
     where s.id = p_seccion and da.docente_id = public.usuario_actual());
$$;

create or replace function public.docente_ve_matricula(p_matricula uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.matriculas mt
                  where mt.id = p_matricula and public.docente_ve_seccion(mt.seccion_id));
$$;

create or replace function public.docente_ve_actividad(p_actividad uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.actividades a
      join public.docente_asignaturas da
        on da.asignatura_id = a.asignatura_id and da.periodo_id = a.periodo_id
     where a.id = p_actividad and da.docente_id = public.usuario_actual());
$$;

create or replace function public.docente_ve_perfil(p_perfil uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.matriculas mt
                  where mt.perfil_id = p_perfil and public.docente_ve_seccion(mt.seccion_id));
$$;

create or replace function public.mi_matricula(p_matricula uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.matriculas mt
                  where mt.id = p_matricula and mt.perfil_id = public.usuario_actual());
$$;

create or replace function public.cursa_actividad(p_actividad uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.matriculas mt
      join public.secciones   s on s.id = mt.seccion_id
      join public.actividades a on a.asignatura_id = s.asignatura_id
                              and a.periodo_id    = s.periodo_id
     where mt.perfil_id = public.usuario_actual() and mt.activa and a.id = p_actividad);
$$;

create or replace function public.cursa_articulo(p_articulo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.matriculas mt
      join public.secciones s on s.id = mt.seccion_id
      join public.articulos a on a.asignatura_id = s.asignatura_id
                            and a.periodo_id    = s.periodo_id
     where mt.perfil_id = public.usuario_actual() and mt.activa and a.id = p_articulo);
$$;

create or replace function public.docente_ve_articulo(p_articulo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.articulos a
      join public.docente_asignaturas da
        on da.asignatura_id = a.asignatura_id and da.periodo_id = a.periodo_id
     where a.id = p_articulo and da.docente_id = public.usuario_actual());
$$;

-- ============================== Triggers de puntos ==============================

create or replace function public.validar_resultado_calza()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.matriculas mt
      join public.secciones   s on s.id = mt.seccion_id
      join public.actividades a on a.id = new.actividad_id
     where mt.id = new.matricula_id and mt.activa and a.activa
       and a.asignatura_id = s.asignatura_id and a.periodo_id = s.periodo_id
  ) then
    raise exception 'La actividad no corresponde a esa matrícula';
  end if;
  return new;
end;
$$;

create or replace function public.otorgar_puntos_actividad()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_puntos integer; v_titulo text;
begin
  select puntos, titulo into v_puntos, v_titulo
    from public.actividades where id = new.actividad_id;
  if coalesce(v_puntos, 0) = 0 then return new; end if;
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (new.matricula_id, v_puntos, v_titulo);
  return new;
end;
$$;

create or replace function public.otorgar_puntos_bienvenida()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sigla text;
begin
  select a.sigla into v_sigla
    from public.secciones s join public.asignaturas a on a.id = s.asignatura_id
   where s.id = new.seccion_id;
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (new.id, 100, 'Bienvenida a ' || coalesce(v_sigla, 'la asignatura'));
  return new;
end;
$$;

drop trigger if exists tr_resultado_calza on public.resultados_actividad;
create trigger tr_resultado_calza before insert on public.resultados_actividad
  for each row execute function public.validar_resultado_calza();

drop trigger if exists tr_puntos_actividad on public.resultados_actividad;
create trigger tr_puntos_actividad after insert on public.resultados_actividad
  for each row execute function public.otorgar_puntos_actividad();

drop trigger if exists tr_puntos_bienvenida on public.matriculas;
create trigger tr_puntos_bienvenida after insert on public.matriculas
  for each row execute function public.otorgar_puntos_bienvenida();

-- ============================== Vistas ==============================
-- `security_invoker` para que se vean a través del RLS de quien consulta y no
-- del dueño. Sin esto una vista es un agujero que salta las políticas.

drop view if exists public.saldos_puntos;
create view public.saldos_puntos with (security_invoker = true) as
  select matricula_id, coalesce(sum(puntos), 0)::integer as saldo
    from public.movimientos_puntos group by matricula_id;

drop view if exists public.mis_ramos;
create view public.mis_ramos with (security_invoker = true) as
  select mt.id as matricula_id, mt.perfil_id, mt.activa, mt.creado_en,
         s.id as seccion_id, s.codigo as seccion,
         a.id as asignatura_id, a.sigla, a.nombre as asignatura,
         p.id as periodo_id, p.codigo as periodo, p.nombre as periodo_nombre,
         p.activo as periodo_activo,
         coalesce((select sum(m.puntos) from public.movimientos_puntos m
                    where m.matricula_id = mt.id), 0)::integer as puntos
    from public.matriculas  mt
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
    join public.periodos    p on p.id = s.periodo_id;

drop view if exists public.resumen_alumnos;
create view public.resumen_alumnos with (security_invoker = true) as
  select mt.id as matricula_id, pf.id as perfil_id, pf.nombre, pf.avatar,
         mt.creado_en, mt.activa,
         s.id as seccion_id, s.codigo as seccion,
         a.sigla as asignatura, a.nombre as asignatura_nombre,
         pe.codigo as periodo,
         coalesce((select sum(m.puntos) from public.movimientos_puntos m
                    where m.matricula_id = mt.id), 0)::integer as puntos
    from public.matriculas  mt
    join public.perfiles    pf on pf.id = mt.perfil_id
    join public.secciones   s  on s.id  = mt.seccion_id
    join public.asignaturas a  on a.id  = s.asignatura_id
    join public.periodos    pe on pe.id = s.periodo_id;

drop view if exists public.vitrina;
create view public.vitrina with (security_invoker = true) as
  select a.*, mt.id as matricula_id,
         coalesce((select sum(m.puntos) from public.movimientos_puntos m
                    where m.matricula_id = mt.id), 0)::integer as saldo,
         (select count(*) from public.canjes c
           where c.articulo_id = a.id and c.matricula_id = mt.id
             and c.estado in ('solicitado','aprobado','entregado'))::integer as ya_canjeados,
         (select count(*) from public.canjes c
           where c.articulo_id = a.id
             and c.estado in ('solicitado','aprobado','entregado'))::integer as colocados
    from public.articulos  a
    join public.secciones  s  on s.asignatura_id = a.asignatura_id
                             and s.periodo_id    = a.periodo_id
    join public.matriculas mt on mt.seccion_id = s.id
   where a.activo and mt.activa;

drop view if exists public.canjes_detalle;
create view public.canjes_detalle with (security_invoker = true) as
  select c.id, c.estado, c.precio_pagado, c.nota_alumno, c.comentario_docente,
         c.creado_en, c.resuelto_en, c.matricula_id, c.articulo_id,
         ar.codigo as articulo_codigo, ar.nombre as articulo, ar.icono, ar.categoria,
         ar.requiere_aprobacion,
         mt.perfil_id, pf.nombre as alumno, pf.avatar,
         s.codigo as seccion, a.id as asignatura_id, a.sigla,
         p.id as periodo_id, p.codigo as periodo
    from public.canjes      c
    join public.articulos   ar on ar.id = c.articulo_id
    join public.matriculas  mt on mt.id = c.matricula_id
    join public.perfiles    pf on pf.id = mt.perfil_id
    join public.secciones   s  on s.id  = mt.seccion_id
    join public.asignaturas a  on a.id  = s.asignatura_id
    join public.periodos    p  on p.id  = s.periodo_id;

-- ============================== Row Level Security ==============================

alter table public.usuarios              enable row level security;
alter table public.periodos              enable row level security;
alter table public.asignaturas           enable row level security;
alter table public.secciones             enable row level security;
alter table public.perfiles              enable row level security;
alter table public.docentes              enable row level security;
alter table public.docente_asignaturas   enable row level security;
alter table public.matriculas            enable row level security;
alter table public.movimientos_puntos    enable row level security;
alter table public.actividades           enable row level security;
alter table public.resultados_actividad  enable row level security;
alter table public.diagnostico_secciones enable row level security;
alter table public.diagnostico_preguntas enable row level security;
alter table public.articulos             enable row level security;
alter table public.canjes                enable row level security;

-- `usuarios` no lleva ninguna política: queda sellada. Solo se entra por
-- `autenticar()`, `registrar_alumno()` y `cambiar_clave()`.

-- Catálogo: lectura completa, también con sesión cerrada, porque el desplegable
-- del registro se llena antes de iniciar sesión. El flag `activa` decide qué se
-- ofrece, no quién puede mirar: si filtrara acá, al cerrar el semestre los
-- alumnos perderían de vista sus propios ramos pasados.
create policy "periodos: lectura publica"    on public.periodos    for select to pulso_app using (true);
create policy "asignaturas: lectura publica" on public.asignaturas for select to pulso_app using (true);
create policy "secciones: lectura publica"   on public.secciones   for select to pulso_app using (true);

create policy "perfil propio: leer" on public.perfiles for select to pulso_app
  using (id = public.usuario_actual() or public.docente_ve_perfil(id));
create policy "perfil propio: actualizar" on public.perfiles for update to pulso_app
  using (id = public.usuario_actual()) with check (id = public.usuario_actual());

create policy "matriculas: leer las propias" on public.matriculas for select to pulso_app
  using (perfil_id = public.usuario_actual() or public.docente_ve_seccion(seccion_id));
create policy "matriculas: matricularme" on public.matriculas for insert to pulso_app
  with check (perfil_id = public.usuario_actual()
    and exists (select 1 from public.secciones s join public.periodos p on p.id = s.periodo_id
                 where s.id = seccion_id and s.activa and p.activo));
create policy "matriculas: el docente da de baja" on public.matriculas for update to pulso_app
  using (public.docente_ve_seccion(seccion_id))
  with check (public.docente_ve_seccion(seccion_id));

create policy "actividades: solo las de mis ramos" on public.actividades for select to pulso_app
  using ((activa and public.cursa_actividad(id)) or public.docente_ve_actividad(id));

create policy "resultados: leer los propios" on public.resultados_actividad for select to pulso_app
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));
create policy "resultados: registrar el propio" on public.resultados_actividad for insert to pulso_app
  with check (public.mi_matricula(matricula_id) and public.cursa_actividad(actividad_id));

-- El alumno no tiene política de insert: los puntos los otorgan los triggers
-- `security definer` o el docente. Sin update ni delete: el libro solo crece.
create policy "puntos: leer los mios" on public.movimientos_puntos for select to pulso_app
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));
create policy "puntos: el docente otorga" on public.movimientos_puntos for insert to pulso_app
  with check (public.docente_ve_matricula(matricula_id));

create policy "docentes: ver la propia ficha" on public.docentes for select to pulso_app
  using (id = public.usuario_actual());
create policy "docente_asignaturas: ver las propias" on public.docente_asignaturas for select to pulso_app
  using (docente_id = public.usuario_actual());

-- El alumno **no** lee las preguntas: entra por diagnostico_cuestionario().
create policy "diagnostico: el docente lee sus secciones" on public.diagnostico_secciones
  for select to pulso_app using (public.docente_ve_actividad(actividad_id));
create policy "diagnostico: el docente lee sus preguntas" on public.diagnostico_preguntas
  for select to pulso_app using (exists (
    select 1 from public.diagnostico_secciones ds
     where ds.id = seccion_id and public.docente_ve_actividad(ds.actividad_id)));

create policy "articulos: los de mis ramos" on public.articulos for select to pulso_app
  using ((activo and public.cursa_articulo(id)) or public.docente_ve_articulo(id));

-- `canjes` no tiene insert, update ni delete: todo pasa por las funciones que
-- cobran, devuelven y comprueban stock. Si el alumno pudiera insertar acá, se
-- llevaría el artículo sin pagar.
create policy "canjes: los mios" on public.canjes for select to pulso_app
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

-- ============================== Permisos del rol de la app ==============================

grant usage on schema public to pulso_app;

grant select on public.periodos, public.asignaturas, public.secciones,
                public.actividades, public.docentes, public.docente_asignaturas,
                public.diagnostico_secciones, public.diagnostico_preguntas,
                public.articulos, public.canjes,
                public.saldos_puntos, public.mis_ramos, public.resumen_alumnos,
                public.vitrina, public.canjes_detalle
  to pulso_app;

grant select, update         on public.perfiles            to pulso_app;
grant select, insert, update on public.matriculas          to pulso_app;
grant select, insert         on public.movimientos_puntos  to pulso_app;
grant select, insert         on public.resultados_actividad to pulso_app;

-- Nada sobre `usuarios`: la tabla de credenciales queda fuera del alcance del rol.

grant execute on function
  public.usuario_actual(), public.es_docente(),
  public.mi_matricula(uuid), public.cursa_actividad(uuid), public.cursa_articulo(uuid),
  public.docente_ve_seccion(uuid), public.docente_ve_matricula(uuid),
  public.docente_ve_actividad(uuid), public.docente_ve_perfil(uuid),
  public.docente_ve_articulo(uuid),
  public.autenticar(text, text), public.cambiar_clave(text, text),
  public.registrar_alumno(text, text, text, uuid)
  to pulso_app;

-- Las de trigger no se otorgan a nadie: el trigger las ejecuta igual.
revoke execute on function public.validar_resultado_calza()   from public;
revoke execute on function public.otorgar_puntos_actividad()  from public;
revoke execute on function public.otorgar_puntos_bienvenida() from public;
