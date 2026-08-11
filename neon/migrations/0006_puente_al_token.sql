-- Un puente al esquema `auth`, que no nos pertenece.
--
-- El esquema `auth` lo crea Neon y su dueño es `cloud_admin`: su ACL es
-- `{cloud_admin=UC/cloud_admin}` y no se le puede otorgar USAGE a nadie más —los
-- `grant` de la migración 0004 fallaron con un warning que dejé pasar—. Así que
-- `pulso_app` **no puede** llamar a `auth.uid()` directamente.
--
-- `neondb_owner` sí puede, por ser miembro de `neon_superuser`. Entonces la
-- identidad se lee a través de esta función `security definer`, que corre como su
-- dueño y es lo único que cruza hacia `auth`.
--
-- Sin esto, `usuario_actual()` recibía «permission denied for schema auth» en cada
-- consulta. Con el `exception` de antes eso se traducía a null, el RLS respondía
-- cero filas, y el alumno veía una pantalla vacía sin ningún error.

create or replace function public.uid_del_token()
returns uuid
language plpgsql
stable
security definer
as $$
begin
  return auth.uid();
exception when others then
  -- Sin sesión de JWT inicializada: es el caso de psql y de la mantención.
  return null;
end;
$$;

alter function public.uid_del_token() owner to neondb_owner;
grant execute on function public.uid_del_token() to pulso_app;

create or replace function public.usuario_actual()
returns uuid
language plpgsql
stable
as $$
declare
  v         uuid := public.uid_del_token();
  v_de_mano uuid := nullif(current_setting('pulso.usuario_id', true), '')::uuid;
begin
  if v is not null then return v; end if;
  if v_de_mano is not null then return v_de_mano; end if;

  -- La aplicación siempre llega con token: la Data API lo exige incluso para el
  -- catálogo. Si no hay identidad, algo está roto y corresponde reventar — un
  -- error que se puede reintentar es mejor que una pantalla vacía que miente.
  if current_user = 'pulso_app' then
    raise exception 'No se pudo leer tu sesión'
      using hint = 'Vuelve a cargar la página. Si sigue pasando, escríbele al docente.';
  end if;

  return null;
end;
$$;

grant execute on function public.usuario_actual() to pulso_app;
