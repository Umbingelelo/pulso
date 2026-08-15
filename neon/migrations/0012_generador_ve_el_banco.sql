-- El rol generador tenía el grant pero no la política, y el RLS deniega por
-- omisión: leía cero términos y la misión no se habría creado nunca. Es el modo
-- de falla más incómodo del RLS —permiso concedido, resultado vacío, sin error—
-- y por eso conviene probar cada rol nuevo contra datos de verdad.
drop policy if exists "banco: el generador lee lo activo" on public.mision_banco;
create policy "banco: el generador lee lo activo" on public.mision_banco
  for select to pulso_misiones using (activo);

drop policy if exists "plantillas: el generador lee lo activo" on public.mision_plantillas;
create policy "plantillas: el generador lee lo activo" on public.mision_plantillas
  for select to pulso_misiones using (activa);
