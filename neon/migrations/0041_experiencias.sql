-- Las clases y los laboratorios se agrupan por experiencia de aprendizaje.
--
-- Con dieciséis semanas de material la lista plana se volvió un muro: para llegar
-- al laboratorio de esta semana había que pasar por encima de todo lo de la EP1.
-- Cada asignatura se dicta en tres experiencias —EA1, EA2, EA3, las del programa
-- oficial— y es así como el alumno piensa el semestre, así que es así como se
-- muestra.
--
-- ── Por qué una columna y no las fechas del pase ──
--
-- Los pases ya parten el semestre por parcial, y habría sido tentador deducir la
-- experiencia de ahí. No calza: en ITY1102 la EA2 empieza el 15 de septiembre y el
-- pase 2 el 28, y los laboratorios de ITY1102 no tienen plazo, así que no hay
-- fecha de dónde colgarlos. La experiencia es un dato del programa, no del
-- calendario: se escribe al subir —`--experiencia N` en `subir-clase.mjs`,
-- `experiencia: N` en el encabezado del laboratorio— y acá se rellena lo que ya
-- estaba arriba.
--
-- Nula = no pertenece a ninguna. Es el caso del diagnóstico de entrada, que se
-- muestra aparte y antes que todo.

alter table public.clases
  add column if not exists experiencia smallint check (experiencia between 1 and 9);
alter table public.actividades
  add column if not exists experiencia smallint check (experiencia between 1 and 9);

-- ============================== Los nombres ==============================
-- Son del programa de la asignatura, no de un periodo: van en `asignaturas`, que
-- ya tiene lectura pública para la app. La posición es el número: el primero es
-- la EA1.
--
-- Columna y no tabla aparte a propósito. La Data API de Neon recoge una columna
-- nueva con `notify pgrst` (`refrescar-api.mjs`), pero una **tabla** nueva no
-- aparece hasta apretar «Refresh schema cache» en la consola de Neon: la primera
-- versión de esta migración creaba `experiencias` y la API respondía PGRST205
-- después de dos avisos. Con eso las pantallas de Clases y Actividades habrían
-- quedado vacías al desplegar.

drop table if exists public.experiencias;

alter table public.asignaturas
  add column if not exists experiencias text[] not null default '{}';

update public.asignaturas set experiencias = array[
  'Configurando API Manager y soluciones Identity as a Service',
  'Desarrollando colas de mensajes',
  'Desarrollando colas de stream de datos'
] where sigla = 'DSY1107';

update public.asignaturas set experiencias = array[
  'Visión general de la Arquitectura de Sistemas IA',
  'Diseño de una arquitectura IA',
  'Despliegue de una arquitectura IA'
] where sigla = 'ITY1102';

-- ============================== Lo que ya estaba arriba ==============================
-- DSY1107: unidad 1 semanas 1–7 (hasta el 27 de septiembre), unidad 2 semanas
-- 8–11, unidad 3 semanas 12–16. ITY1102: la tabla de PLANIFICACION_SEMANAL.md.

update public.clases c
   set experiencia = e.numero
  from (values
    ('DSY1107', 'S01', 1), ('DSY1107', 'D1', 1), ('DSY1107', 'D2', 1), ('DSY1107', 'D3', 1),
    ('DSY1107', 'D4', 1),  ('DSY1107', 'L3A', 1), ('DSY1107', 'L4A', 1), ('DSY1107', 'D5', 1),
    ('DSY1107', 'D6', 1),
    ('DSY1107', 'D7', 2),  ('DSY1107', 'L6A', 2), ('DSY1107', 'L7A', 2), ('DSY1107', 'D8', 2),
    ('DSY1107', 'D9', 2),  ('DSY1107', 'D10', 2),
    ('DSY1107', 'D11', 3), ('DSY1107', 'D12', 3), ('DSY1107', 'D13', 3), ('DSY1107', 'D14', 3),
    ('DSY1107', 'D15', 3),
    ('ITY1102', 'S01', 1), ('ITY1102', 'D1', 1), ('ITY1102', 'D2', 1), ('ITY1102', 'D3', 1),
    ('ITY1102', 'L3A', 1), ('ITY1102', 'D4', 1), ('ITY1102', 'L4A', 1),
    ('ITY1102', 'D5', 2),  ('ITY1102', 'L5A', 2), ('ITY1102', 'D6', 2), ('ITY1102', 'L6A', 2),
    ('ITY1102', 'D7', 2),  ('ITY1102', 'D8', 2),
    ('ITY1102', 'D9', 3),  ('ITY1102', 'D10', 3), ('ITY1102', 'D11', 3), ('ITY1102', 'D12', 3)
  ) as e(sigla, codigo, numero)
  join public.asignaturas a on a.sigla = e.sigla
  join public.periodos    p on p.codigo = '2026-2'
 where c.asignatura_id = a.id and c.periodo_id = p.id and c.codigo = e.codigo;

update public.actividades x
   set experiencia = e.numero
  from (values
    ('DSY1107', 'L0', 1), ('DSY1107', 'L1', 1), ('DSY1107', 'X1', 1), ('DSY1107', 'L2', 1),
    ('DSY1107', 'T3', 1), ('DSY1107', 'X2', 1), ('DSY1107', 'L3', 1), ('DSY1107', 'X4', 1),
    ('DSY1107', 'L4', 1),
    ('DSY1107', 'L6', 2), ('DSY1107', 'L7', 2), ('DSY1107', 'L8', 2),
    ('ITY1102', 'L0', 1), ('ITY1102', 'L1', 1), ('ITY1102', 'L2', 1), ('ITY1102', 'L2B', 1),
    ('ITY1102', 'L3', 1), ('ITY1102', 'L4', 1),
    ('ITY1102', 'L5', 2), ('ITY1102', 'L6', 2), ('ITY1102', 'L7', 2), ('ITY1102', 'L8', 2)
  ) as e(sigla, codigo, numero)
  join public.asignaturas a on a.sigla = e.sigla
  join public.periodos    p on p.codigo = '2026-2'
 where x.asignatura_id = a.id and x.periodo_id = p.id and x.codigo = e.codigo;

-- ============================== Las vistas ==============================
-- Las mismas de la 0009, con `experiencia` agregada al final del select de
-- `clases`. Nada más cambia.

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
         (pr.matricula_id is not null) as abierta,
         c.experiencia
    from public.clases     c
    join public.secciones  s  on s.asignatura_id = c.asignatura_id
                             and s.periodo_id    = c.periodo_id
    join public.matriculas mt on mt.seccion_id = s.id
    left join public.progreso_clase pr on pr.clase_id = c.id
                                      and pr.matricula_id = mt.id
   where mt.activa
     and c.publicada_desde is not null
     and c.publicada_desde <= now();

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
           as a_tiempo,
         c.experiencia
    from public.clases      c
    join public.asignaturas a on a.id = c.asignatura_id
    join public.periodos    p on p.id = c.periodo_id
   where public.docente_ve_clase(c.id);

-- `clases` tiene el select por columna (la ruta y la pauta no se leen). La nueva
-- hay que nombrarla; `actividades` tiene el select de tabla entera y no lo necesita.
grant select (experiencia) on public.clases to pulso_app;
grant select on public.mis_clases       to pulso_app;
grant select on public.clases_que_dicto to pulso_app;
