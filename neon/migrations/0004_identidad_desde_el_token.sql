-- Conecta el RLS con el token de la Data API.
--
-- Al habilitar la Data API, Neon instala `pg_session_jwt` y crea el esquema
-- `auth`. De ahí sale `auth.uid()`, que devuelve el `sub` del JWT como uuid — la
-- misma firma que tenía en Supabase.
--
-- Así que `usuario_actual()` pasa a leer de dos fuentes, en este orden:
--
--   1. el token, cuando la petición entra por la Data API (el caso normal);
--   2. la variable de sesión `pulso.usuario_id`, que es como se prueba desde
--      psql y como podría entrar una función de servidor si algún día hace falta.
--
-- Las 19 políticas no se tocan: siguen preguntándole a `usuario_actual()`.
--
-- El `begin/exception` no es adorno: `auth.uid()` revienta si la sesión de JWT no
-- está inicializada, y eso pasa en toda consulta sin token —el desplegable del
-- registro, por ejemplo—. Sin atraparlo, una petición anónima daría error en vez
-- de simplemente no ver nada.

create or replace function public.usuario_actual()
returns uuid
language plpgsql
stable
as $$
declare
  v uuid;
begin
  begin
    v := auth.uid();
  exception when others then
    v := null;
  end;

  if v is null then
    v := nullif(current_setting('pulso.usuario_id', true), '')::uuid;
  end if;

  return v;
end;
$$;

grant usage  on schema auth to pulso_app;
grant execute on function auth.uid()      to pulso_app;
grant execute on function auth.user_id()  to pulso_app;
grant execute on function auth.jwt()      to pulso_app;
grant execute on function public.usuario_actual() to pulso_app;
