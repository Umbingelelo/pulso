-- Reparte las alternativas correctas entre las posiciones.
--
-- El problema que resuelve: al escribir un cuestionario a mano uno tiende a
-- poner la respuesta correcta siempre en el mismo lugar. Medido sobre los dos
-- diagnósticos, el 72% de las correctas de DSY1107 estaba en la segunda opción y
-- el 71% de las de ITY1102 en la primera. Con eso, un alumno que responde todo
-- «A» —o todo «B»— saca más del 70% sin saber nada, y el diagnóstico deja de
-- servir para lo único que tiene que hacer: decidir cuánta nivelación necesita
-- cada tema.
--
-- Es determinista: mismo contenido, mismo resultado. Por eso puede vivir al final
-- de una semilla y volver a correrse sin sorpresas.
--
-- Dos cuidados:
--
--   * Se niega a correr si alguien ya rindió, porque cambiar la pauta dejaría los
--     puntajes guardados midiendo contra otra cosa.
--   * No mueve de la última posición a las alternativas «comodín» (ninguna, son
--     lo mismo, es al revés…). Leerlas en el medio de la lista suena raro y
--     además delata cuál es la respuesta de relleno.
--
-- Lo que **no** sabe hacer: respetar alternativas que se leen en un orden propio,
-- como una lista de códigos HTTP. Esas hay que reordenarlas después de llamarla,
-- y la semilla de DSY1107 lo hace para su pregunta A1. Si algún día ejecutas esta
-- función a mano sobre un diagnóstico ya cargado, vuelve a aplicar esos ajustes
-- posteriores: la función los deshace, porque solo mira la posición.
-- Lo natural es no llamarla sola, sino recargar la semilla completa, que ya trae
-- el orden correcto de principio a fin.

create or replace function public.equilibrar_alternativas(p_actividad uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  q         record;
  n         integer;
  comodin   boolean;
  tope      integer;   -- último índice al que se puede mover la correcta
  destino   integer;
  i         integer := 0;
  cambiadas integer := 0;
  ops       jsonb;
  tmp       jsonb;
begin
  if exists (select 1 from public.resultados_actividad
              where actividad_id = p_actividad) then
    raise exception 'Ya hay resultados de esta actividad: cambiar la pauta invalidaría los puntajes guardados';
  end if;

  for q in
    select dp.id, dp.opciones, dp.correcta
      from public.diagnostico_preguntas dp
      join public.diagnostico_secciones ds on ds.id = dp.seccion_id
     where ds.actividad_id = p_actividad
       and dp.correcta is not null        -- las de encuesta no tienen pauta
     order by ds.orden, dp.orden          -- orden estable ⇒ resultado reproducible
  loop
    n := jsonb_array_length(q.opciones);

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

      update public.diagnostico_preguntas
         set opciones = ops, correcta = destino
       where id = q.id;

      cambiadas := cambiadas + 1;
    end if;
  end loop;

  return cambiadas;
end;
$$;

-- Es una función de mantención: se llama desde una semilla o desde el editor SQL,
-- nunca desde la aplicación.
revoke execute on function public.equilibrar_alternativas(uuid) from public, anon, authenticated;
