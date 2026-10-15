-- Los minijuegos son clases, y ahora se sabe cuáles son.
--
-- Los treinta minijuegos de repaso de la EP2 —quince por ramo— se escribieron
-- con el contrato de un deck: `<section class="slide">` por etapa, el avance en
-- `localStorage` con la forma `{ modo, slide, respuestas }` y las preguntas de
-- control como quiz con `data-correcta`. Así `/api/clase` los sirve, el rastreo
-- los instrumenta y `abrir_clase` / `clase_registrar_avance` los pagan sin una
-- línea nueva: abrir, cada pregunta de control acertada y llegar al cierre, una
-- vez cada cosa y por juego.
--
-- Lo único que faltaba es distinguirlos. Quince juegos mezclados con las clases
-- de la EA2 entierran lo de esta semana, y el alumno los busca como otra cosa:
-- el repaso jugable de la evaluación. `tipo` los separa y la app les da su
-- propia pantalla, `/minijuegos`.
--
-- ── Por qué una columna y no una tabla ──
--
-- Pagar, corregir, servir y programar ya funcionan sobre `clases`; una tabla
-- aparte obligaría a duplicar las cuatro cosas. Y como en la 0041: la Data API
-- recoge una columna nueva con `notify pgrst` (`refrescar-api.mjs`), pero una
-- tabla nueva no aparece hasta refrescar a mano en la consola de Neon.
--
-- ── Compatible con el frontend publicado ──
--
-- Aditiva: el frontend de antes no pide `tipo` y sigue leyendo las vistas igual.
-- Hasta desplegar, un minijuego publicado aparecería en «Clases»; por eso se
-- suben después del despliegue.

alter table public.clases
  add column if not exists tipo text not null default 'clase'
    check (tipo in ('clase', 'minijuego'));

-- ============================== Las vistas ==============================
-- Las mismas de la 0041, con `tipo` agregado al final. Nada más cambia.

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
         c.experiencia,
         c.tipo
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
         c.experiencia,
         c.tipo
    from public.clases      c
    join public.asignaturas a on a.id = c.asignatura_id
    join public.periodos    p on p.id = c.periodo_id
   where public.docente_ve_clase(c.id);

-- `clases` tiene el select por columna (la ruta y la pauta no se leen): la
-- columna nueva hay que nombrarla. Las vistas se recrearon con `drop view`, que
-- descarta sus permisos, así que se vuelven a dar.
grant select (tipo) on public.clases to pulso_app;
grant select on public.mis_clases       to pulso_app;
grant select on public.clases_que_dicto to pulso_app;
