-- Las operaciones que la API expone: diagnóstico, tienda y ficha.
--
-- Son las mismas funciones que corrían en Supabase. Lo único que cambia es que
-- `auth.uid()` pasó a ser `usuario_actual()`, y que el `grant execute` va a
-- `pulso_app` en vez de a `authenticated`.
--
-- Todas son `security definer` porque necesitan leer más de lo que el RLS le
-- permite a quien llama —la pauta del diagnóstico, el precio de un artículo— y
-- devolver solo la parte que corresponde. La autorización la comprueban ellas
-- mismas en la primera línea.

-- ============================== Diagnóstico ==============================

create or replace function public.actividad_diagnostico(p_matricula uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select a.id
    from public.matriculas  mt
    join public.secciones   s on s.id = mt.seccion_id
    join public.actividades a on a.asignatura_id = s.asignatura_id
                             and a.periodo_id    = s.periodo_id
   where mt.id = p_matricula and a.tipo = 'diagnostico' and a.activa
   order by a.orden limit 1;
$$;

-- Devuelve `correcta` y `explicacion` solo si ya entregó. Antes de eso viajan en
-- null: la pauta no sale de la base.
create or replace function public.diagnostico_cuestionario(p_matricula uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actividad uuid; v_rendido boolean; v_detalle jsonb; v_act jsonb; v_secs jsonb;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  v_actividad := public.actividad_diagnostico(p_matricula);
  if v_actividad is null then return null; end if;

  select jsonb_build_object('id', a.id, 'codigo', a.codigo, 'titulo', a.titulo,
                            'descripcion', a.descripcion, 'puntos', a.puntos)
    into v_act from public.actividades a where a.id = v_actividad;

  select r.detalle into v_detalle from public.resultados_actividad r
   where r.actividad_id = v_actividad and r.matricula_id = p_matricula;
  v_rendido := v_detalle is not null;

  select coalesce(jsonb_agg(t.sec order by t.orden), '[]'::jsonb) into v_secs
    from (
      select ds.orden,
             jsonb_build_object(
               'codigo', ds.codigo, 'titulo', ds.titulo, 'umbral', ds.umbral,
               'repaso', ds.repaso, 'critica', ds.critica, 'intro', ds.intro,
               'preguntas', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'orden', dp.orden, 'enunciado', dp.enunciado, 'codigo', dp.codigo,
                          -- «No sé» se agrega acá y no se guarda: es siempre la última
                          'opciones', dp.opciones || jsonb_build_array('No sé'),
                          'puntua', dp.correcta is not null,
                          'correcta',    case when v_rendido then to_jsonb(dp.correcta)    end,
                          'explicacion', case when v_rendido then to_jsonb(dp.explicacion) end
                        ) order by dp.orden), '[]'::jsonb)
                   from public.diagnostico_preguntas dp where dp.seccion_id = ds.id)) as sec
        from public.diagnostico_secciones ds where ds.actividad_id = v_actividad) t;

  return jsonb_build_object(
    'actividad', v_act, 'rendido', v_rendido,
    'puntajes',   coalesce(v_detalle -> 'puntajes',   '{}'::jsonb),
    'respuestas', coalesce(v_detalle -> 'respuestas', '{}'::jsonb),
    'secciones',  v_secs);
end;
$$;

-- Corrige el servidor. El cliente solo manda {"A1": 0, "A2": 3, …}.
create or replace function public.rendir_diagnostico(p_matricula uuid, p_respuestas jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actividad uuid; v_puntajes jsonb := '{}'::jsonb; v_faltan integer; r record;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;
  if p_respuestas is null or jsonb_typeof(p_respuestas) <> 'object' then
    raise exception 'Respuestas mal formadas';
  end if;

  v_actividad := public.actividad_diagnostico(p_matricula);
  if v_actividad is null then
    raise exception 'No hay diagnóstico disponible para ese ramo';
  end if;
  if exists (select 1 from public.resultados_actividad
              where actividad_id = v_actividad and matricula_id = p_matricula) then
    raise exception 'Ya rendiste este diagnóstico';
  end if;

  -- Se rinde completo: «No sé» es una respuesta válida, dejarla en blanco no.
  select count(*) into v_faltan
    from public.diagnostico_secciones ds
    join public.diagnostico_preguntas dp on dp.seccion_id = ds.id
   where ds.actividad_id = v_actividad
     and (p_respuestas ->> (ds.codigo || dp.orden::text)) is null;
  if v_faltan > 0 then
    raise exception 'Faltan % preguntas por responder', v_faltan;
  end if;

  for r in
    select ds.codigo,
           count(*) filter (
             where dp.correcta is not null
               and (p_respuestas ->> (ds.codigo || dp.orden::text)) ~ '^[0-9]+$'
               and (p_respuestas ->> (ds.codigo || dp.orden::text))::integer = dp.correcta
           ) as aciertos
      from public.diagnostico_secciones ds
      join public.diagnostico_preguntas dp on dp.seccion_id = ds.id
     where ds.actividad_id = v_actividad
     group by ds.codigo
  loop
    v_puntajes := v_puntajes || jsonb_build_object(r.codigo, r.aciertos);
  end loop;

  -- El trigger de puntos se dispara acá: el alumno nunca escribe en el libro.
  insert into public.resultados_actividad (actividad_id, matricula_id, detalle)
  values (v_actividad, p_matricula,
          jsonb_build_object('puntajes', v_puntajes, 'respuestas', p_respuestas, 'version', 2));

  return public.diagnostico_cuestionario(p_matricula);
end;
$$;

create or replace function public.diagnostico_resumen(p_actividad uuid)
returns table (codigo text, titulo text, umbral integer, maximo bigint,
               promedio numeric, bajo bigint, rendidos bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.docente_ve_actividad(p_actividad) then
    raise exception 'No dictas esa asignatura';
  end if;
  return query
  with secs as (
    select ds.id, ds.codigo, ds.titulo, ds.umbral, ds.orden,
           count(*) filter (where dp.correcta is not null) as maximo
      from public.diagnostico_secciones ds
      left join public.diagnostico_preguntas dp on dp.seccion_id = ds.id
     where ds.actividad_id = p_actividad group by ds.id),
  valores as (
    select s.codigo, ((r.detalle -> 'puntajes' ->> s.codigo))::numeric as valor
      from public.resultados_actividad r cross join secs s
     where r.actividad_id = p_actividad and r.detalle -> 'puntajes' ? s.codigo)
  select s.codigo, s.titulo, s.umbral, s.maximo,
         round(coalesce(avg(v.valor), 0), 1),
         count(*) filter (where v.valor < s.umbral),
         count(v.valor)
    from secs s left join valores v on v.codigo = s.codigo
   group by s.codigo, s.titulo, s.umbral, s.maximo, s.orden
   order by s.orden;
end;
$$;

-- Reparte las correctas entre las posiciones. Escribiendo a mano uno tiende a
-- dejarlas todas en el mismo lugar; sin esto, responder todo «A» sacaba más del
-- 70%. Determinista: la semilla la llama al final y el resultado es reproducible.
create or replace function public.equilibrar_alternativas(p_actividad uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  q record; n integer; comodin boolean; tope integer; destino integer;
  i integer := 0; cambiadas integer := 0; ops jsonb; tmp jsonb;
begin
  if exists (select 1 from public.resultados_actividad where actividad_id = p_actividad) then
    raise exception 'Ya hay resultados de esta actividad: cambiar la pauta invalidaría los puntajes guardados';
  end if;

  for q in
    select dp.id, dp.opciones, dp.correcta
      from public.diagnostico_preguntas dp
      join public.diagnostico_secciones ds on ds.id = dp.seccion_id
     where ds.actividad_id = p_actividad and dp.correcta is not null
     order by ds.orden, dp.orden
  loop
    n := jsonb_array_length(q.opciones);
    -- No mueve de la última posición a los comodines: leerlos en el medio suena
    -- raro y delata cuál es la respuesta de relleno.
    comodin := lower(q.opciones ->> (n - 1)) ~
      '^(ninguna|ninguno|ningún|son lo mismo|son sinónimos|es al revés|es al reves|las dos|ambas|da lo mismo|todas)';
    tope := case when comodin then n - 2 else n - 1 end;
    if tope < 0 then tope := 0; end if;

    destino := i % (tope + 1);
    i := i + 1;

    if destino <> q.correcta then
      ops := q.opciones;
      tmp := ops -> destino;
      ops := jsonb_set(ops, array[destino::text],    ops -> q.correcta);
      ops := jsonb_set(ops, array[q.correcta::text], tmp);
      update public.diagnostico_preguntas set opciones = ops, correcta = destino where id = q.id;
      cambiadas := cambiadas + 1;
    end if;
  end loop;
  return cambiadas;
end;
$$;

-- ============================== Tienda ==============================

create or replace function public.solicitar_canje(
  p_matricula uuid, p_articulo uuid, p_nota text default null)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare
  a public.articulos%rowtype; v_saldo integer; v_mios integer; v_todos integer;
  v_estado text; v_canje bigint;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select * into a from public.articulos where id = p_articulo;
  if a.id is null or not a.activo then
    raise exception 'Ese artículo no está disponible';
  end if;

  if not exists (
    select 1 from public.matriculas mt join public.secciones s on s.id = mt.seccion_id
     where mt.id = p_matricula and mt.activa
       and s.asignatura_id = a.asignatura_id and s.periodo_id = a.periodo_id) then
    raise exception 'Ese artículo no es de este ramo';
  end if;

  if a.precio is null then
    raise exception 'Ese artículo todavía no tiene precio';
  end if;

  select coalesce(sum(puntos), 0) into v_saldo
    from public.movimientos_puntos where matricula_id = p_matricula;
  if v_saldo < a.precio then
    raise exception 'No te alcanzan los puntos: cuesta % y tienes %', a.precio, v_saldo;
  end if;

  select count(*) into v_mios from public.canjes
   where articulo_id = p_articulo and matricula_id = p_matricula
     and estado in ('solicitado','aprobado','entregado');
  if a.limite_por_alumno is not null and v_mios >= a.limite_por_alumno then
    raise exception 'Ya alcanzaste el máximo de % para este artículo', a.limite_por_alumno;
  end if;

  if a.stock is not null then
    select count(*) into v_todos from public.canjes
     where articulo_id = p_articulo and estado in ('solicitado','aprobado','entregado');
    if v_todos >= a.stock then raise exception 'Se agotó'; end if;
  end if;

  v_estado := case when a.requiere_aprobacion then 'solicitado' else 'entregado' end;

  insert into public.canjes (articulo_id, matricula_id, estado, precio_pagado, nota_alumno, resuelto_en)
  values (p_articulo, p_matricula, v_estado, a.precio, nullif(trim(p_nota), ''),
          case when v_estado = 'entregado' then now() end)
  returning id into v_canje;

  -- Se descuenta al solicitar, no al aprobar: así nadie compromete el mismo
  -- saldo dos veces mientras espera respuesta.
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (p_matricula, -a.precio, 'Canje: ' || a.nombre);

  return v_canje;
end;
$$;

create or replace function public.resolver_canje(
  p_canje bigint, p_estado text, p_comentario text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c public.canjes%rowtype; v_nom text;
begin
  select * into c from public.canjes where id = p_canje;
  if c.id is null then raise exception 'Ese canje no existe'; end if;
  if not public.docente_ve_matricula(c.matricula_id) then
    raise exception 'Ese canje no es de una sección que dictes';
  end if;
  if p_estado not in ('aprobado','entregado','rechazado') then
    raise exception 'Estado no válido: %', p_estado;
  end if;
  if c.estado in ('rechazado','cancelado') then
    raise exception 'Ese canje ya está cerrado';
  end if;
  if p_estado = 'rechazado' and c.estado = 'entregado' then
    raise exception 'No se puede rechazar algo ya entregado';
  end if;

  select nombre into v_nom from public.articulos where id = c.articulo_id;

  update public.canjes
     set estado = p_estado,
         comentario_docente = coalesce(nullif(trim(p_comentario), ''), comentario_docente),
         resuelto_en = now(), resuelto_por = public.usuario_actual()
   where id = p_canje;

  -- Rechazar devuelve los puntos con una línea nueva: el libro no se edita.
  if p_estado = 'rechazado' then
    insert into public.movimientos_puntos (matricula_id, puntos, motivo)
    values (c.matricula_id, c.precio_pagado, 'Devolución: ' || coalesce(v_nom, 'canje rechazado'));
  end if;
end;
$$;

create or replace function public.cancelar_canje(p_canje bigint)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c public.canjes%rowtype; v_nom text;
begin
  select * into c from public.canjes where id = p_canje;
  if c.id is null then raise exception 'Ese canje no existe'; end if;
  if not public.mi_matricula(c.matricula_id) then
    raise exception 'Ese canje no es tuyo';
  end if;
  -- Solo mientras nadie lo ha revisado. Después ya no es del alumno.
  if c.estado <> 'solicitado' then
    raise exception 'Ya no se puede cancelar: está %', c.estado;
  end if;

  select nombre into v_nom from public.articulos where id = c.articulo_id;
  update public.canjes set estado = 'cancelado', resuelto_en = now() where id = p_canje;
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (c.matricula_id, c.precio_pagado, 'Devolución: ' || coalesce(v_nom, 'canje cancelado'));
end;
$$;

create or replace function public.clonar_catalogo(
  p_asignatura uuid, p_periodo_origen uuid, p_periodo_destino uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_n integer;
begin
  if not exists (select 1 from public.docente_asignaturas
                  where docente_id = public.usuario_actual()
                    and asignatura_id = p_asignatura and periodo_id = p_periodo_destino) then
    raise exception 'No dictas esa asignatura en el periodo de destino';
  end if;

  insert into public.articulos (asignatura_id, periodo_id, codigo, nombre, descripcion, detalle,
                                categoria, icono, precio, requiere_aprobacion, stock,
                                limite_por_alumno, activo, orden)
  select a.asignatura_id, p_periodo_destino, a.codigo, a.nombre, a.descripcion, a.detalle,
         a.categoria, a.icono, a.precio, a.requiere_aprobacion, a.stock,
         a.limite_por_alumno, a.activo, a.orden
    from public.articulos a
   where a.asignatura_id = p_asignatura and a.periodo_id = p_periodo_origen
  on conflict (asignatura_id, periodo_id, codigo) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ============================== Ficha del alumno ==============================
-- La misma función para el alumno y para el docente: la autorización se decide
-- adentro, así que cambiar el id en la URL no abre la ficha de nadie más.

create or replace function public.ficha_alumno(p_matricula uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_soy_docente boolean; v_perfil uuid; v_diag uuid; v_detalle jsonb; j jsonb;
begin
  v_soy_docente := public.docente_ve_matricula(p_matricula);
  if not (public.mi_matricula(p_matricula) or v_soy_docente) then
    raise exception 'No tienes acceso a esa ficha';
  end if;

  select mt.perfil_id into v_perfil from public.matriculas mt where mt.id = p_matricula;

  v_diag := public.actividad_diagnostico(p_matricula);
  select r.detalle into v_detalle from public.resultados_actividad r
   where r.actividad_id = v_diag and r.matricula_id = p_matricula;

  select jsonb_build_object(
    'perfil', (select jsonb_build_object('id', pf.id, 'nombre', pf.nombre,
                        'avatar', pf.avatar, 'creado_en', pf.creado_en)
                 from public.perfiles pf where pf.id = v_perfil),
    'ramo', (select jsonb_build_object('matricula_id', mr.matricula_id, 'sigla', mr.sigla,
               'asignatura', mr.asignatura, 'seccion', mr.seccion, 'periodo', mr.periodo,
               'periodo_nombre', mr.periodo_nombre, 'activa', mr.activa,
               'creado_en', mr.creado_en, 'puntos', mr.puntos)
               from public.mis_ramos mr where mr.matricula_id = p_matricula),
    'saldo',    (select coalesce(sum(m.puntos),0)::integer from public.movimientos_puntos m
                  where m.matricula_id = p_matricula),
    'ganados',  (select coalesce(sum(m.puntos),0)::integer from public.movimientos_puntos m
                  where m.matricula_id = p_matricula and m.puntos > 0),
    'gastados', (select coalesce(sum(m.puntos),0)::integer from public.movimientos_puntos m
                  where m.matricula_id = p_matricula and m.puntos < 0),
    'movimientos', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'puntos', m.puntos,
                      'motivo', m.motivo, 'creado_en', m.creado_en)
                      order by m.creado_en desc), '[]'::jsonb)
                      from public.movimientos_puntos m where m.matricula_id = p_matricula),
    'actividades', (select coalesce(jsonb_agg(x order by x->>'orden'), '[]'::jsonb) from (
                      select jsonb_build_object('id', a.id, 'codigo', a.codigo, 'titulo', a.titulo,
                               'tipo', a.tipo, 'puntos', a.puntos,
                               'orden', lpad(a.orden::text, 4, '0'),
                               'completada_en', r.completada_en) as x
                        from public.actividades a
                        join public.matriculas mt on mt.id = p_matricula
                        join public.secciones  s  on s.id = mt.seccion_id
                        left join public.resultados_actividad r
                               on r.actividad_id = a.id and r.matricula_id = p_matricula
                       where a.activa and a.asignatura_id = s.asignatura_id
                         and a.periodo_id = s.periodo_id) t),
    'diagnostico', case when v_diag is null then null else jsonb_build_object(
        'rendido', v_detalle is not null,
        'secciones', (select coalesce(jsonb_agg(y order by y->>'orden'), '[]'::jsonb) from (
            select jsonb_build_object('codigo', ds.codigo, 'titulo', ds.titulo,
                     'umbral', ds.umbral, 'critica', ds.critica,
                     'orden', lpad(ds.orden::text, 4, '0'),
                     'maximo', (select count(*) from public.diagnostico_preguntas dp
                                 where dp.seccion_id = ds.id and dp.correcta is not null),
                     'puntaje', coalesce((v_detalle -> 'puntajes' ->> ds.codigo)::integer, 0)) as y
              from public.diagnostico_secciones ds where ds.actividad_id = v_diag) t2)) end,
    'canjes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'articulo', ar.nombre,
                 'icono', ar.icono, 'categoria', ar.categoria, 'estado', c.estado,
                 'precio_pagado', c.precio_pagado, 'nota_alumno', c.nota_alumno,
                 'comentario_docente', c.comentario_docente,
                 'creado_en', c.creado_en, 'resuelto_en', c.resuelto_en)
                 order by c.creado_en desc), '[]'::jsonb)
                 from public.canjes c join public.articulos ar on ar.id = c.articulo_id
                where c.matricula_id = p_matricula),
    -- Los otros ramos, pero solo los que quien mira tiene derecho a ver.
    'otros_ramos', (select coalesce(jsonb_agg(jsonb_build_object(
                      'matricula_id', mr.matricula_id, 'sigla', mr.sigla, 'seccion', mr.seccion,
                      'periodo', mr.periodo, 'puntos', mr.puntos, 'activa', mr.activa)
                      order by mr.periodo desc, mr.sigla), '[]'::jsonb)
                      from public.mis_ramos mr
                     where mr.perfil_id = v_perfil and mr.matricula_id <> p_matricula
                       and (mr.perfil_id = public.usuario_actual()
                            or public.docente_ve_seccion(mr.seccion_id))),
    'soy_docente', v_soy_docente
  ) into j;
  return j;
end;
$$;

-- ============================== Permisos ==============================

grant execute on function
  public.actividad_diagnostico(uuid),
  public.diagnostico_cuestionario(uuid),
  public.rendir_diagnostico(uuid, jsonb),
  public.diagnostico_resumen(uuid),
  public.solicitar_canje(uuid, uuid, text),
  public.resolver_canje(bigint, text, text),
  public.cancelar_canje(bigint),
  public.clonar_catalogo(uuid, uuid, uuid),
  public.ficha_alumno(uuid)
  to pulso_app;

-- Mantención: se corre desde una semilla o desde el editor SQL, nunca desde la app.
revoke execute on function public.equilibrar_alternativas(uuid) from public;
