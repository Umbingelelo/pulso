-- Cierra el `execute` de las funciones.
--
-- Postgres otorga `execute` a `public` por defecto, y `anon` hereda de `public`.
-- Por eso el `revoke ... from anon` de las migraciones anteriores no hacía nada:
-- había que quitarle el permiso a `public`, que es de donde venía.
--
-- Todo lo que queda con permiso lo tiene por una razón concreta:
--
--   * Las funciones que usan las políticas de RLS (`mi_matricula`,
--     `cursa_actividad`, `docente_ve_*`) las evalúa **el usuario que consulta**,
--     no el dueño de la política. Si `authenticated` no pudiera ejecutarlas, toda
--     consulta con RLS fallaría por permisos. Todas devuelven un booleano sobre
--     el propio usuario, así que exponerlas no dice nada que él no sepa ya.
--   * `diagnostico_cuestionario` y `rendir_diagnostico` son la puerta del alumno
--     al diagnóstico, y validan la matrícula antes de responder nada.
--
-- Las funciones de trigger no se le otorgan a nadie: el trigger las ejecuta igual
-- —el permiso se comprueba al crearlo, no al dispararse— y así dejan de estar
-- publicadas como endpoints en `/rest/v1/rpc/`.

revoke execute on function public.es_docente()                            from public, anon;
revoke execute on function public.mi_matricula(uuid)                      from public, anon;
revoke execute on function public.cursa_actividad(uuid)                   from public, anon;
revoke execute on function public.docente_ve_seccion(uuid)                from public, anon;
revoke execute on function public.docente_ve_matricula(uuid)              from public, anon;
revoke execute on function public.docente_ve_actividad(uuid)              from public, anon;
revoke execute on function public.docente_ve_perfil(uuid)                 from public, anon;
revoke execute on function public.actividad_diagnostico(uuid)             from public, anon;
revoke execute on function public.diagnostico_cuestionario(uuid)          from public, anon;
revoke execute on function public.rendir_diagnostico(uuid, jsonb)         from public, anon;
revoke execute on function public.diagnostico_resumen(uuid)               from public, anon;

grant execute on function public.es_docente()                    to authenticated;
grant execute on function public.mi_matricula(uuid)              to authenticated;
grant execute on function public.cursa_actividad(uuid)           to authenticated;
grant execute on function public.docente_ve_seccion(uuid)        to authenticated;
grant execute on function public.docente_ve_matricula(uuid)      to authenticated;
grant execute on function public.docente_ve_actividad(uuid)      to authenticated;
grant execute on function public.docente_ve_perfil(uuid)         to authenticated;
grant execute on function public.actividad_diagnostico(uuid)     to authenticated;
grant execute on function public.diagnostico_cuestionario(uuid)  to authenticated;
grant execute on function public.rendir_diagnostico(uuid, jsonb) to authenticated;
grant execute on function public.diagnostico_resumen(uuid)       to authenticated;

-- Funciones de trigger: nadie las llama a mano.
revoke execute on function public.validar_resultado_calza()      from public, anon, authenticated;
revoke execute on function public.otorgar_puntos_actividad()     from public, anon, authenticated;
revoke execute on function public.otorgar_puntos_bienvenida()    from public, anon, authenticated;
revoke execute on function public.crear_perfil_al_registrarse()  from public, anon, authenticated;
