-- Llevarse el deck: el mismo archivo, para estudiarlo sin conexión.
--
-- El alumno ya podía guardar la página con Ctrl+S —el deck es un solo HTML
-- autocontenido— así que esto no abre ninguna puerta nueva. Lo que hace es
-- convertir un truco de navegador en un botón, que es distinto para quien
-- estudia en el metro.
--
-- ── Descargar no es abrir ──
--
-- Podría haberse reusado `abrir_clase()`, que ya autoriza y ya devuelve la ruta
-- del blob. No se hizo, y la razón es lo que esa función escribe además de leer:
-- inserta la fila de `progreso_clase` y paga `puntos_abrir`.
--
-- Con eso, bajar los 18 decks de un ramo de una sentada pagaría los puntos de
-- haberlos abierto los 18 sin haber leído ninguno, y —peor— cada tarjeta quedaría
-- para siempre en «En curso · vas en la diapositiva 1 de 38» sin que nadie haya
-- pasado de la primera. `progreso_clase` dejaría de significar «lo que pasó
-- dentro de Pulso», que es justo lo que el docente mira.
--
-- Así que la descarga solo **autoriza y lee**: es `stable`, no escribe una línea,
-- y los puntos se siguen ganando donde se ganaban, estudiando el deck servido.
--
-- Las cuatro comprobaciones son las mismas de `abrir_clase()` y se apoyan en los
-- mismos helpers de la 0007 —`docente_ve_clase`, `mi_matricula_de_clase`—, así que
-- no hay dos definiciones de «quién puede ver esto» que se puedan ir separando:
-- hay una, en esos helpers, y las dos funciones preguntan.

create or replace function public.descargar_clase(p_clase uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usuario uuid := public.usuario_actual();
  v_clase   public.clases;
begin
  if v_usuario is null then
    raise exception 'Sin sesión';
  end if;

  select * into v_clase from public.clases where id = p_clase;
  if not found then
    raise exception 'Esa clase no existe';
  end if;

  -- El docente se lleva su material esté publicado o no, igual que lo abre.
  if public.docente_ve_clase(p_clase) then
    return jsonb_build_object(
      'archivo', v_clase.archivo, 'titulo', v_clase.titulo,
      'codigo', v_clase.codigo, 'docente', true);
  end if;

  if v_clase.publicada_desde is null or v_clase.publicada_desde > now() then
    raise exception 'Esa clase todavía no está publicada';
  end if;

  if public.mi_matricula_de_clase(p_clase) is null then
    raise exception 'Esa clase no es de un ramo que estés cursando';
  end if;

  return jsonb_build_object(
    'archivo', v_clase.archivo, 'titulo', v_clase.titulo,
    'codigo', v_clase.codigo, 'docente', false);
end;
$$;

grant execute on function public.descargar_clase(uuid) to pulso_app;
