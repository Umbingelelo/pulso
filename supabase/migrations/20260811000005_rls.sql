-- Row Level Security completo, reescrito para el modelo de matrículas.
--
-- Regla de fondo: todo lo que el alumno puede ver o escribir se decide contra
-- *sus matrículas*, no contra su cuenta. Y el docente decide contra las secciones
-- que declaró dictar en `docente_asignaturas`, no contra el hecho de ser docente.

-- ====================== Helpers que faltaban ======================

-- ¿La actividad pertenece a algún ramo que curso?
create or replace function public.cursa_actividad(p_actividad uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.matriculas  mt
      join public.secciones   s on s.id = mt.seccion_id
      join public.actividades a on a.asignatura_id = s.asignatura_id
                               and a.periodo_id    = s.periodo_id
     where mt.perfil_id = auth.uid()
       and mt.activa
       and a.id = p_actividad);
$$;

-- ¿Ese alumno está en alguna de mis secciones?
create or replace function public.docente_ve_perfil(p_perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.matriculas mt
     where mt.perfil_id = p_perfil
       and public.docente_ve_seccion(mt.seccion_id));
$$;

-- ====================== Limpiar las políticas anteriores ======================

drop policy if exists "asignaturas: lectura publica"          on public.asignaturas;
drop policy if exists "secciones: lectura publica"            on public.secciones;
drop policy if exists "actividades: lectura autenticada"      on public.actividades;
drop policy if exists "docentes: ver la propia ficha"         on public.docentes;
drop policy if exists "perfil propio: leer"                   on public.perfiles;
drop policy if exists "perfil propio: crear"                  on public.perfiles;
drop policy if exists "perfil propio: actualizar"             on public.perfiles;
drop policy if exists "docentes ven todos los perfiles"       on public.perfiles;
drop policy if exists "movimientos propios: leer"             on public.movimientos_puntos;
drop policy if exists "docentes ven todos los movimientos"    on public.movimientos_puntos;
drop policy if exists "docentes otorgan puntos"               on public.movimientos_puntos;
drop policy if exists "resultado propio: leer"                on public.resultados_actividad;
drop policy if exists "resultado propio: crear"               on public.resultados_actividad;
drop policy if exists "docentes ven todos los resultados"     on public.resultados_actividad;

-- ====================== Catálogo ======================
-- Lectura pública y completa: el desplegable del registro se llena antes de que
-- exista sesión. No hay nada reservado en una sigla ni en un código de sección.
--
-- Ojo: se leen **todas** las filas, también las que tienen `activa = false`. Ese
-- flag decide qué se ofrece en el registro y qué acepta la matrícula, no quién
-- puede mirar. Si filtrara acá, al desactivar una sección al cierre del semestre
-- los alumnos perderían de vista sus propios ramos pasados.

create policy "periodos: lectura publica" on public.periodos
  for select to anon, authenticated using (true);

create policy "asignaturas: lectura publica" on public.asignaturas
  for select to anon, authenticated using (true);

create policy "secciones: lectura publica" on public.secciones
  for select to anon, authenticated using (true);

-- ====================== Perfiles ======================

create policy "perfil propio: leer" on public.perfiles
  for select to authenticated
  using (id = auth.uid() or public.docente_ve_perfil(id));

create policy "perfil propio: crear" on public.perfiles
  for insert to authenticated
  with check (id = auth.uid());

create policy "perfil propio: actualizar" on public.perfiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ====================== Matrículas ======================

create policy "matriculas: leer las propias" on public.matriculas
  for select to authenticated
  using (perfil_id = auth.uid() or public.docente_ve_seccion(seccion_id));

-- El alumno se matricula solo, pero únicamente en una sección abierta de un
-- periodo abierto. Así puede agregar un ramo nuevo sin pasar por el docente.
create policy "matriculas: matricularme" on public.matriculas
  for insert to authenticated
  with check (
    perfil_id = auth.uid()
    and exists (
      select 1 from public.secciones s
        join public.periodos p on p.id = s.periodo_id
       where s.id = seccion_id and s.activa and p.activo));

-- Dar de baja a alguien de una sección es del docente. El alumno no edita ni
-- borra su matrícula: si se retira, queda `activa = false` y el historial vive.
create policy "matriculas: el docente da de baja" on public.matriculas
  for update to authenticated
  using (public.docente_ve_seccion(seccion_id))
  with check (public.docente_ve_seccion(seccion_id));

-- ====================== Actividades ======================

create policy "actividades: solo las de mis ramos" on public.actividades
  for select to authenticated
  using ((activa and public.cursa_actividad(id)) or public.docente_ve_actividad(id));

-- ====================== Resultados ======================

create policy "resultados: leer los propios" on public.resultados_actividad
  for select to authenticated
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

-- Solo sobre una matrícula propia y una actividad de ese mismo ramo. El trigger
-- `tr_resultado_calza` vuelve a comprobarlo, por si algo entra sin pasar por RLS.
create policy "resultados: registrar el propio" on public.resultados_actividad
  for insert to authenticated
  with check (public.mi_matricula(matricula_id) and public.cursa_actividad(actividad_id));

-- Sin update ni delete: un resultado no se edita.

-- ====================== Puntos ======================

create policy "puntos: leer los míos" on public.movimientos_puntos
  for select to authenticated
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

-- El alumno no tiene política de insert: un intento desde el cliente recibe 403.
-- Los puntos los otorgan los triggers (`security definer`) o el docente.
create policy "puntos: el docente otorga" on public.movimientos_puntos
  for insert to authenticated
  with check (public.docente_ve_matricula(matricula_id));

-- Sin update ni delete: el libro de movimientos solo crece.

-- ====================== Docentes ======================

create policy "docentes: ver la propia ficha" on public.docentes
  for select to authenticated using (id = auth.uid());

create policy "docente_asignaturas: ver las propias" on public.docente_asignaturas
  for select to authenticated using (docente_id = auth.uid());

-- ====================== Diagnóstico ======================
-- El alumno **no tiene** política de lectura sobre estas dos tablas. Ni siquiera
-- para las preguntas: entra por `diagnostico_cuestionario()`, que devuelve el
-- cuestionario sin la pauta. `correcta` y `explicacion` no salen de la base hasta
-- que entrega. El docente sí las lee, para revisar lo que preguntó.

create policy "diagnostico: el docente lee sus secciones" on public.diagnostico_secciones
  for select to authenticated using (public.docente_ve_actividad(actividad_id));

create policy "diagnostico: el docente lee sus preguntas" on public.diagnostico_preguntas
  for select to authenticated
  using (exists (
    select 1 from public.diagnostico_secciones ds
     where ds.id = seccion_id and public.docente_ve_actividad(ds.actividad_id)));

revoke execute on function public.cursa_actividad(uuid)   from anon;
revoke execute on function public.docente_ve_perfil(uuid) from anon;
