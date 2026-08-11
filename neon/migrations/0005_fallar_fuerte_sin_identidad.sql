-- Que la falta de identidad no se disfrace de «no tienes nada».
--
-- La versión anterior de `usuario_actual()` atrapaba cualquier error de
-- `auth.uid()` y devolvía null. Eso parecía prudente y era peligroso: si la
-- validación del token falla —por ejemplo la primera vez, cuando Neon todavía no
-- ha traído el JWKS—, la función decía «anónimo» y el RLS respondía con cero
-- filas. El alumno veía «no tienes ramos» en una pantalla perfectamente normal,
-- sin ningún error, y con todos sus datos intactos al otro lado.
--
-- Lo vi dos veces en pruebas y las dos lo atribuí al pool antes de mirarlo bien.
--
-- Ahora distingue quién pregunta:
--
--   * `pulso_app` es la aplicación, y **siempre** llega con un token —la Data API
--     lo exige incluso para el catálogo—. Si no se puede leer, algo está roto y
--     corresponde reventar: un error que se puede reintentar es mucho mejor que
--     una pantalla vacía que miente.
--   * cualquier otro rol es mantención por psql, donde la identidad se pone a
--     mano con `pulso.usuario_id`. Ahí no hay token y devolver null es correcto.

create or replace function public.usuario_actual()
returns uuid
language plpgsql
stable
as $$
declare
  v         uuid;
  v_fallo   text;
  v_de_mano uuid := nullif(current_setting('pulso.usuario_id', true), '')::uuid;
begin
  begin
    v := auth.uid();
  exception when others then
    v_fallo := sqlerrm;
  end;

  if v is not null then
    return v;
  end if;

  -- La vía de mantención: identidad puesta a mano, sin token.
  if v_de_mano is not null then
    return v_de_mano;
  end if;

  -- La aplicación sin token legible es una falla, no un visitante anónimo.
  if current_user = 'pulso_app' then
    raise exception 'No se pudo leer tu sesión: %', coalesce(v_fallo, 'el token no trae identidad')
      using hint = 'Vuelve a cargar la página. Si sigue pasando, escríbele al docente.';
  end if;

  return null;
end;
$$;

grant execute on function public.usuario_actual() to pulso_app;
