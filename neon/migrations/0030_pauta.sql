-- La pauta: la respuesta correcta de cada caja, para el modelo y para nadie más.
--
-- Hasta ahora el modelo juzgaba con el enunciado completo y nada más. Alcanza
-- para las cajas que piden pegar una salida, pero en las conceptuales —«¿por qué
-- esa firma no sirve de nada?»— tiene que reconstruir el criterio cada vez, y dos
-- alumnos que escribieron lo mismo pueden salir con veredictos distintos. La
-- pauta es el criterio escrito una vez, por quien hizo la guía.
--
-- ── Por qué una columna aparte y no un bloque más ──
--
-- Los bloques del enunciado los manda `mi_laboratorio()` al navegador enteros,
-- porque el navegador los dibuja. Una pauta guardada ahí viajaría con ellos:
-- estaría en la respuesta HTTP que el alumno puede leer en la pestaña de red,
-- aunque la pantalla no la pinte. Y no habría error en ninguna parte — sería
-- exactamente el laboratorio con las respuestas adentro.
--
-- Por eso vive en su propia columna, `mi_laboratorio()` no la selecciona, y la
-- tabla `laboratorios` no tiene política de lectura para `pulso_app`.
--
-- ── Cómo la alcanza el servidor, entonces ──
--
-- Por `laboratorio_pauta()`, que es `security definer` y **se niega a contestarle
-- a quien llega con token de navegador**. Esa es la parte que hay que entender:
--
--   * El navegador habla con la Data API llevando su JWT, así que
--     `uid_del_token()` devuelve su uid.
--   * `/api/laboratorio` no lleva token: pone la identidad a mano con el ajuste
--     `pulso.usuario_id` (ver `lib/identidad.mjs`), y ahí `uid_del_token()` es
--     null.
--
-- La función exige la segunda vía. Un alumno que descubra el nombre de la función
-- y la llame por `/rest/v1/rpc/laboratorio_pauta` con su propio token —que es
-- exactamente lo que la Data API le permite hacer con cualquier función que tenga
-- `execute`— se lleva un error, no la pauta.
--
-- La alternativa era un rol nuevo con su propia contraseña, como `pulso_misiones`
-- para el banco de las misiones. Se descartó porque el secreto acá no es un dato
-- de negocio que haya que aislar por rol: es el mismo laboratorio del mismo
-- alumno, leído desde el otro lado de la misma petición. Un rol más habría que
-- rotarlo, guardarlo en Vercel y explicarlo, para proteger algo que esta condición
-- de dos líneas ya protege.

alter table public.laboratorios
  add column if not exists pautas jsonb not null default '{}'::jsonb;

comment on column public.laboratorios.pautas is
  'id de caja → respuesta correcta en Markdown. Sólo la lee el revisor del '
  'servidor por public.laboratorio_pauta(); nunca sale por mi_laboratorio().';

-- ============================== Leerla ==============================

create or replace function public.laboratorio_pauta(
  p_matricula uuid, p_codigo text, p_caja text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_pauta text;
begin
  -- La puerta. Con token de navegador no se contesta, aunque el token sea
  -- perfectamente válido y la matrícula sea de quien pregunta: por esa vía nadie
  -- tiene nada que hacer acá.
  if public.uid_del_token() is not null then
    raise exception 'La pauta no se entrega por la Data API';
  end if;

  -- Y la de siempre: que el laboratorio sea de un ramo que cursa. Va después de
  -- la puerta pero no sobra — sin ella, un descuido en el servidor podría pedir
  -- la pauta de una asignatura ajena.
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select l.pautas->>p_caja into v_pauta
    from public.actividades a
    join public.laboratorios l on l.actividad_id = a.id
    join public.secciones    s on s.asignatura_id = a.asignatura_id
                              and s.periodo_id    = a.periodo_id
    join public.matriculas  mt on mt.seccion_id = s.id
   where mt.id = p_matricula and a.codigo = p_codigo and a.activa;

  -- null es una respuesta legítima: hay laboratorios sin pauta escrita todavía, y
  -- el revisor sabe juzgar sin ella. Lo que no puede es confundirse con un fallo.
  return v_pauta;
end;
$$;

alter function public.laboratorio_pauta(uuid, text, text) owner to neondb_owner;
grant execute on function public.laboratorio_pauta(uuid, text, text) to pulso_app;
