-- Subir lo que paga una clase, y compensar a quien ya la hizo.
--
-- La escala anterior —abrir 5, actividad 10, terminar 20— daba entre 25 y 55
-- puntos por clase según cuántos quiz trajera el deck, y eso tenía dos problemas.
-- El primero es que una clase sin quiz valía menos de la mitad que una con tres,
-- sin que el alumno tuviera nada que ver. El segundo es que el total del semestre
-- quedaba en 750 puntos, y con eso ningún premio podía costar de verdad.
--
-- La escala nueva —abrir 25, actividad 10, terminar 55— deja cada clase entre 80
-- y 110 según sus quiz: el grueso lo paga recorrerla, y los quiz son un extra.
--
-- ── El ajuste retroactivo ──
--
-- Dos clases ya están dictadas y 63 alumnos las hicieron con la escala vieja.
-- Cambiar los precios sin compensarlos los dejaría comprando más caro con lo que
-- ganaron más barato. Se recalcula lo que habrían ganado y se abona la
-- diferencia, tramo por tramo y respetando la ventana: quien abrió fuera de plazo
-- recibe su ajuste con el mismo factor con que se le pagó.

update public.clases
   set puntos_abrir = 25, puntos_actividad = 10, puntos_terminar = 55,
       actualizada_en = now();

-- El abono, calculado sobre lo que cada alumno efectivamente hizo.
with pagado as (
  select pc.matricula_id, pc.clase_id, c.codigo,
         -- Lo que corresponde con la escala nueva, con el mismo factor que se le
         -- aplicó en su momento.
         public.puntos_con_factor(c.id, 25, pc.abierta_en)
           + coalesce(array_length(pc.aciertos, 1), 0)
             * public.puntos_con_factor(c.id, 10, pc.abierta_en)
           + case when pc.terminada_en is null then 0
                  else public.puntos_con_factor(c.id, 55,
                         coalesce(pc.alcanzo_final_en, pc.terminada_en)) end as nuevo,
         -- Lo que ya se le pagó por esa clase, leído del libro.
         coalesce((select sum(m.puntos) from public.movimientos_puntos m
                    where m.matricula_id = pc.matricula_id
                      and m.motivo like '%' || c.codigo || '%'), 0) as viejo
    from public.progreso_clase pc
    join public.clases c on c.id = pc.clase_id
)
insert into public.movimientos_puntos (matricula_id, puntos, motivo)
select matricula_id, nuevo - viejo,
       'Ajuste de ' || codigo || ' por la nueva escala de puntos'
  from pagado
 where nuevo - viejo > 0;
