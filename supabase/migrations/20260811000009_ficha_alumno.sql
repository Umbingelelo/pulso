-- La ficha del alumno: todo lo suyo en un ramo, en una consulta.
--
-- Es la misma función para los dos, y la autorización se decide adentro: el
-- alumno pasa por `mi_matricula`, el docente por `docente_ve_matricula`. Así no
-- hay dos caminos que mantener sincronizados —que es de donde salen las fugas—
-- y el alumno no puede pedir la ficha de otro cambiando el id en la URL.

create or replace function public.ficha_alumno(p_matricula uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_soy_docente boolean;
  v_perfil uuid;
  v_diag   uuid;
  v_detalle jsonb;
  j jsonb;
begin
  v_soy_docente := public.docente_ve_matricula(p_matricula);

  if not (public.mi_matricula(p_matricula) or v_soy_docente) then
    raise exception 'No tienes acceso a esa ficha';
  end if;

  select mt.perfil_id into v_perfil from public.matriculas mt where mt.id = p_matricula;

  v_diag := public.actividad_diagnostico(p_matricula);
  select r.detalle into v_detalle
    from public.resultados_actividad r
   where r.actividad_id = v_diag and r.matricula_id = p_matricula;

  select jsonb_build_object(

    'perfil', (select jsonb_build_object(
                 'id', pf.id, 'nombre', pf.nombre, 'avatar', pf.avatar,
                 'creado_en', pf.creado_en)
                 from public.perfiles pf where pf.id = v_perfil),

    'ramo', (select jsonb_build_object(
               'matricula_id', mr.matricula_id, 'sigla', mr.sigla,
               'asignatura', mr.asignatura, 'seccion', mr.seccion,
               'periodo', mr.periodo, 'periodo_nombre', mr.periodo_nombre,
               'activa', mr.activa, 'creado_en', mr.creado_en, 'puntos', mr.puntos)
               from public.mis_ramos mr where mr.matricula_id = p_matricula),

    'saldo', (select coalesce(sum(m.puntos), 0)::integer
                from public.movimientos_puntos m where m.matricula_id = p_matricula),

    'ganados', (select coalesce(sum(m.puntos), 0)::integer
                  from public.movimientos_puntos m
                 where m.matricula_id = p_matricula and m.puntos > 0),

    'gastados', (select coalesce(sum(m.puntos), 0)::integer
                   from public.movimientos_puntos m
                  where m.matricula_id = p_matricula and m.puntos < 0),

    'movimientos', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', m.id, 'puntos', m.puntos, 'motivo', m.motivo,
                      'creado_en', m.creado_en) order by m.creado_en desc), '[]'::jsonb)
                      from public.movimientos_puntos m where m.matricula_id = p_matricula),

    -- Las actividades del ramo, con la fecha en que la completó (o null).
    'actividades', (select coalesce(jsonb_agg(x order by x->>'orden'), '[]'::jsonb) from (
                      select jsonb_build_object(
                               'id', a.id, 'codigo', a.codigo, 'titulo', a.titulo,
                               'tipo', a.tipo, 'puntos', a.puntos,
                               'orden', lpad(a.orden::text, 4, '0'),
                               'completada_en', r.completada_en) as x
                        from public.actividades a
                        join public.matriculas mt on mt.id = p_matricula
                        join public.secciones  s  on s.id = mt.seccion_id
                        left join public.resultados_actividad r
                               on r.actividad_id = a.id and r.matricula_id = p_matricula
                       where a.activa
                         and a.asignatura_id = s.asignatura_id
                         and a.periodo_id    = s.periodo_id) t),

    -- El diagnóstico por sección, con su puntaje y el umbral que no alcanzó.
    'diagnostico', case when v_diag is null then null else jsonb_build_object(
        'rendido', v_detalle is not null,
        'secciones', (select coalesce(jsonb_agg(y order by y->>'orden'), '[]'::jsonb) from (
            select jsonb_build_object(
                     'codigo', ds.codigo, 'titulo', ds.titulo, 'umbral', ds.umbral,
                     'critica', ds.critica,
                     'orden', lpad(ds.orden::text, 4, '0'),
                     'maximo', (select count(*) from public.diagnostico_preguntas dp
                                 where dp.seccion_id = ds.id and dp.correcta is not null),
                     'puntaje', coalesce((v_detalle -> 'puntajes' ->> ds.codigo)::integer, 0)) as y
              from public.diagnostico_secciones ds
             where ds.actividad_id = v_diag) t2)) end,

    'canjes', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', c.id, 'articulo', ar.nombre, 'icono', ar.icono,
                 'categoria', ar.categoria, 'estado', c.estado,
                 'precio_pagado', c.precio_pagado, 'nota_alumno', c.nota_alumno,
                 'comentario_docente', c.comentario_docente,
                 'creado_en', c.creado_en, 'resuelto_en', c.resuelto_en)
                 order by c.creado_en desc), '[]'::jsonb)
                 from public.canjes c
                 join public.articulos ar on ar.id = c.articulo_id
                where c.matricula_id = p_matricula),

    -- Los otros ramos del alumno, pero solo los que quien mira tiene derecho a
    -- ver: el propio alumno los ve todos; un docente, solo los de sus secciones.
    'otros_ramos', (select coalesce(jsonb_agg(jsonb_build_object(
                      'matricula_id', mr.matricula_id, 'sigla', mr.sigla,
                      'seccion', mr.seccion, 'periodo', mr.periodo,
                      'puntos', mr.puntos, 'activa', mr.activa)
                      order by mr.periodo desc, mr.sigla), '[]'::jsonb)
                      from public.mis_ramos mr
                     where mr.perfil_id = v_perfil
                       and mr.matricula_id <> p_matricula
                       and (mr.perfil_id = auth.uid()
                            or public.docente_ve_seccion(mr.seccion_id))),

    'soy_docente', v_soy_docente
  ) into j;

  return j;
end;
$$;

revoke execute on function public.ficha_alumno(uuid) from public, anon;
grant  execute on function public.ficha_alumno(uuid) to authenticated;
