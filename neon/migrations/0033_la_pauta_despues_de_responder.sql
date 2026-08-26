-- La pauta vuelve a la pantalla cuando el alumno ya respondió.
--
-- `mi_mision()` nunca bajó la solución, y con razón: es la que corrige. Pero eso
-- vale **antes** de responder. Después, la pantalla de misiones se recargaba y el
-- alumno perdía lo único que quedaba de la corrección: cuál era la correcta y por
-- qué. Le quedaba la insignia y un recuadro de color en blanco.
--
-- No es que se le esté regalando nada. `mision_responder()` ya le devuelve la
-- solución completa en el momento de contestar —«ya respondió: ahora sí puede ver
-- la pauta»— y se niega a corregir dos veces la misma misión. Que al recargar la
-- página se le vuelva a mostrar lo que ya vio es lo mismo que ya tenía; que no se
-- le mostrara era la falla.
--
-- ── El filtro es `resuelta_en`, no el tipo ni la fecha ──
--
-- Mientras la misión esté pendiente la clave viaja en nulo, que es lo mismo que
-- había antes: no hay nada que filtrar en el navegador ni nada que se pueda leer
-- de más en una respuesta HTTP. Una misión de ayer ni siquiera la devuelve esta
-- función, así que el borde del día no entra en esto.
--
-- ── Compatible con el frontend que está publicado ──
--
-- Se agrega una clave al jsonb y no se cambia la firma. El frontend viejo la
-- ignora, tal como ignoraba su ausencia. La regla del README —la base migra antes
-- que el frontend— se cumple sin ventana rara en medio.

create or replace function public.mi_mision(p_matricula uuid, p_tipo text default 'diaria')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_m record;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select m.id, m.fecha, m.tipo, m.enunciado, m.xp, m.resuelta_en, m.acertada,
         m.intentos, p.codigo as plantilla, p.nombre, p.mecanica, p.banda,
         -- Solo la de una misión ya respondida; la pendiente viaja en nulo.
         case when m.resuelta_en is not null then m.solucion end as solucion
    into v_m
    from public.misiones m
    join public.mision_plantillas p on p.id = m.plantilla_id
   where m.matricula_id = p_matricula
     and m.tipo = p_tipo
     and m.fecha = public.dia_mision();

  if not found then return null; end if;
  return to_jsonb(v_m);
end;
$$;

comment on function public.mi_mision(uuid, text) is
  'La misión de hoy del alumno. Trae la pauta solo si ya la respondió.';

grant execute on function public.mi_mision(uuid, text) to pulso_app;
