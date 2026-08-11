-- Los canjes con todo lo que hace falta para mostrarlos, en una sola fila.
--
-- La usan los dos lados: el alumno para ver los suyos y el docente para su
-- bandeja de pendientes. Quién ve qué lo sigue decidiendo el RLS de `canjes`
-- —por eso `security_invoker`—, así que la misma consulta devuelve cosas
-- distintas según quién pregunte, sin un solo `if` en el cliente.

drop view if exists public.canjes_detalle;
create view public.canjes_detalle
with (security_invoker = true) as
  select c.id,
         c.estado,
         c.precio_pagado,
         c.nota_alumno,
         c.comentario_docente,
         c.creado_en,
         c.resuelto_en,
         c.matricula_id,
         c.articulo_id,
         ar.codigo    as articulo_codigo,
         ar.nombre    as articulo,
         ar.icono,
         ar.categoria,
         ar.requiere_aprobacion,
         mt.perfil_id,
         pf.nombre    as alumno,
         pf.avatar,
         s.codigo     as seccion,
         a.id         as asignatura_id,
         a.sigla,
         p.id         as periodo_id,
         p.codigo     as periodo
    from public.canjes      c
    join public.articulos   ar on ar.id = c.articulo_id
    join public.matriculas  mt on mt.id = c.matricula_id
    join public.perfiles    pf on pf.id = mt.perfil_id
    join public.secciones   s  on s.id  = mt.seccion_id
    join public.asignaturas a  on a.id  = s.asignatura_id
    join public.periodos    p  on p.id  = s.periodo_id;
