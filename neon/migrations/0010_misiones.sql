-- Misiones diarias y semanales, y el libro de experiencia.
--
-- La experiencia es una moneda **aparte** de los puntos, y sale de un solo grifo:
-- las misiones. Las clases, las actividades y los laboratorios pagan puntos
-- directamente y no dan experiencia. Eso es lo que hace que la regla del pase se
-- sostenga —«se completa haciendo todas las misiones y de ninguna otra forma»—
-- sin colchones que la contradigan por detrás.
--
-- Sobre la pauta: `misiones.solucion` no tiene grant para `pulso_app`, igual que
-- `clases.pauta`. El alumno recibe el enunciado y manda su respuesta; quién
-- acertó lo decide Postgres. Es el mismo patrón del diagnóstico.
--
-- Sobre quién puede crear una misión: `mision_registrar()` recibe el enunciado y
-- **la solución** desde afuera, así que si `pulso_app` pudiera ejecutarla, un
-- alumno con su propio token podría inscribirse una misión con una solución que
-- él mismo eligió y cobrarla. Por eso existe `pulso_misiones`, un rol que solo
-- puede hacer eso y nada más, y que usa únicamente la función de generación.

-- ============================== Rol de generación ==============================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pulso_misiones') then
    create role pulso_misiones login;
  end if;
end
$$;

-- ============================== Plantillas ==============================

create table if not exists public.mision_plantillas (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,          -- 'quiz', 'wordle', 'crucigrama'…
  nombre      text not null,
  mecanica    text not null,                 -- cómo se juega y cómo se corrige
  banda       text not null check (banda in ('ingenio', 'contenido', 'codigo')),
  instruccion text not null,                 -- lo que se le pide al modelo
  esquema     jsonb not null,                -- JSON Schema exigido en la respuesta
  xp          integer not null default 25,
  activa      boolean not null default true,
  orden       integer not null default 0
);

-- ============================== Banco curado ==============================
-- De acá sale el contenido. El modelo **compone** con estas piezas; no inventa
-- hechos sobre OAuth ni sobre arc42, que es donde un modelo suelto se equivoca
-- con toda seguridad y delante de un alumno.

create table if not exists public.mision_banco (
  id            uuid primary key default gen_random_uuid(),
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  periodo_id    uuid not null references public.periodos(id)    on delete restrict,
  termino       text not null,
  definicion    text not null,
  fuente        text,                        -- de qué clase salió
  activo        boolean not null default true,
  unique (asignatura_id, periodo_id, termino)
);

create index if not exists ix_banco_ambito on public.mision_banco (asignatura_id, periodo_id);

-- ============================== Misiones asignadas ==============================

create table if not exists public.misiones (
  id           uuid primary key default gen_random_uuid(),
  matricula_id uuid not null references public.matriculas(id)       on delete cascade,
  plantilla_id uuid not null references public.mision_plantillas(id) on delete restrict,
  fecha        date not null,                -- el día, en horario de Chile
  tipo         text not null check (tipo in ('diaria', 'semanal')),

  enunciado    jsonb not null,               -- lo que ve el alumno
  solucion     jsonb not null,               -- la pauta. Sin grant para pulso_app.

  xp           integer not null,
  origen       text not null default 'modelo' check (origen in ('modelo', 'pozo')),

  creada_en    timestamptz not null default now(),
  resuelta_en  timestamptz,
  acertada     boolean,
  intentos     integer not null default 0,

  -- Una por alumno, día y tipo. Es lo que impide que alguien se genere diez
  -- misiones diarias pidiéndolas en paralelo desde varias pestañas.
  unique (matricula_id, fecha, tipo)
);

create index if not exists ix_misiones_matricula on public.misiones (matricula_id, fecha desc);

-- ============================== Libro de experiencia ==============================
-- Aparte del de puntos, y por la misma razón: solo crece, nunca se edita, y el
-- total es la suma. Pero este además nunca baja, porque la experiencia no se
-- gasta en nada.

create table if not exists public.movimientos_experiencia (
  id           bigint primary key generated always as identity,
  matricula_id uuid not null references public.matriculas(id) on delete cascade,
  xp           integer not null check (xp > 0),
  motivo       text not null,
  creado_en    timestamptz not null default now()
);

create index if not exists ix_exp_matricula on public.movimientos_experiencia (matricula_id);

-- ============================== El día, en Chile ==============================
-- El servidor corre en UTC y el curso vive en Santiago. Sin esto, la misión del
-- día cambiaría a las 20:00 o a las 21:00 según la época del año.

create or replace function public.hoy_en_chile()
returns date language sql stable as $$
  select (now() at time zone 'America/Santiago')::date;
$$;

-- ============================== Registrar una misión ==============================
-- La llama el servidor después de generar y **validar** el puzzle. No se otorga
-- a `pulso_app`: recibe la solución desde afuera, y en manos del alumno eso sería
-- inscribirse una misión con la respuesta ya sabida.

create or replace function public.mision_registrar(
  p_matricula uuid,
  p_plantilla text,
  p_tipo      text,
  p_enunciado jsonb,
  p_solucion  jsonb,
  p_origen    text default 'modelo'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_pl    public.mision_plantillas;
  v_id    uuid;
  v_fecha date := public.hoy_en_chile();
begin
  select * into v_pl from public.mision_plantillas where codigo = p_plantilla and activa;
  if not found then
    raise exception 'No existe la plantilla % o está desactivada', p_plantilla;
  end if;
  if not exists (select 1 from public.matriculas where id = p_matricula and activa) then
    raise exception 'Esa matrícula no existe o está dada de baja';
  end if;

  insert into public.misiones (matricula_id, plantilla_id, fecha, tipo,
                               enunciado, solucion, xp, origen)
  values (p_matricula, v_pl.id, v_fecha, p_tipo, p_enunciado, p_solucion, v_pl.xp, p_origen)
  -- Si dos pestañas piden la misión a la vez, gana la primera y la segunda
  -- recibe la que ya existe. Nadie termina con dos misiones del mismo día.
  on conflict (matricula_id, fecha, tipo) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.misiones
     where matricula_id = p_matricula and fecha = v_fecha and tipo = p_tipo;
  end if;

  return jsonb_build_object('id', v_id, 'fecha', v_fecha, 'xp', v_pl.xp);
end;
$$;

-- ============================== La misión del alumno ==============================
-- Devuelve el enunciado, nunca la solución. Si todavía no tiene una para hoy,
-- devuelve null y el servidor se encarga de generarla.

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
         m.intentos, p.codigo as plantilla, p.nombre, p.mecanica, p.banda
    into v_m
    from public.misiones m
    join public.mision_plantillas p on p.id = m.plantilla_id
   where m.matricula_id = p_matricula
     and m.tipo = p_tipo
     and m.fecha = public.hoy_en_chile();

  if not found then return null; end if;
  return to_jsonb(v_m);
end;
$$;

-- ============================== Responder ==============================
-- Corrige contra `solucion` y paga la experiencia una sola vez. El despacho es
-- por mecánica: cada una sabe comparar lo suyo. Una mecánica desconocida
-- **revienta** en vez de dar por buena la respuesta, que sería regalar XP.

create or replace function public.mision_responder(p_mision uuid, p_respuesta jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_m        public.misiones;
  v_mecanica text;
  v_acerto   boolean;
  v_xp       integer := 0;
begin
  select * into v_m from public.misiones where id = p_mision;
  if not found then raise exception 'Esa misión no existe'; end if;
  if not public.mi_matricula(v_m.matricula_id) then
    raise exception 'Esa misión no es tuya';
  end if;
  if v_m.resuelta_en is not null then
    raise exception 'Esa misión ya está resuelta';
  end if;
  if v_m.fecha <> public.hoy_en_chile() then
    raise exception 'Esa misión ya venció';
  end if;

  select mecanica into v_mecanica
    from public.mision_plantillas where id = v_m.plantilla_id;

  case v_mecanica
    when 'quiz' then
      v_acerto := (p_respuesta ->> 'elegida') is not null
              and (p_respuesta ->> 'elegida') = (v_m.solucion ->> 'correcta');
    else
      raise exception 'La mecánica % todavía no sabe corregirse', v_mecanica;
  end case;

  update public.misiones
     set resuelta_en = now(),
         acertada    = v_acerto,
         intentos    = intentos + 1
   where id = p_mision;

  if v_acerto then
    v_xp := v_m.xp;
    insert into public.movimientos_experiencia (matricula_id, xp, motivo)
    values (v_m.matricula_id, v_xp,
            case v_m.tipo when 'semanal' then 'Misión semanal' else 'Misión diaria' end
              || ' · ' || to_char(v_m.fecha, 'DD/MM'));
  end if;

  return jsonb_build_object(
    'acertada', v_acerto,
    'xp_ganada', v_xp,
    'solucion', v_m.solucion);   -- ya respondió: ahora sí puede ver la pauta
end;
$$;

-- ============================== Vistas ==============================

drop view if exists public.mi_experiencia;
create view public.mi_experiencia with (security_invoker = true) as
  select matricula_id, coalesce(sum(xp), 0)::integer as xp
    from public.movimientos_experiencia
   group by matricula_id;

drop view if exists public.mis_misiones;
create view public.mis_misiones with (security_invoker = true) as
  select m.id, m.matricula_id, m.fecha, m.tipo, m.xp, m.resuelta_en, m.acertada,
         p.codigo as plantilla, p.nombre, p.mecanica, p.banda
    from public.misiones m
    join public.mision_plantillas p on p.id = m.plantilla_id;

-- ============================== Row Level Security ==============================

alter table public.mision_plantillas       enable row level security;
alter table public.mision_banco            enable row level security;
alter table public.misiones                enable row level security;
alter table public.movimientos_experiencia enable row level security;

drop policy if exists "plantillas: lectura" on public.mision_plantillas;
create policy "plantillas: lectura" on public.mision_plantillas for select to pulso_app
  using (activa);

-- El banco es materia de las clases del alumno; no hay secreto, pero tampoco
-- razón para exponer el de otra asignatura.
drop policy if exists "banco: el de mis ramos" on public.mision_banco;
create policy "banco: el de mis ramos" on public.mision_banco for select to pulso_app
  using (exists (select 1 from public.matriculas mt
                   join public.secciones s on s.id = mt.seccion_id
                  where mt.perfil_id = public.usuario_actual() and mt.activa
                    and s.asignatura_id = mision_banco.asignatura_id
                    and s.periodo_id    = mision_banco.periodo_id));

-- Sin insert ni update para nadie: se entra por `mision_registrar()` y
-- `mision_responder()`, que son las que corrigen y pagan.
drop policy if exists "misiones: las mias" on public.misiones;
create policy "misiones: las mias" on public.misiones for select to pulso_app
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

drop policy if exists "experiencia: la mia" on public.movimientos_experiencia;
create policy "experiencia: la mia" on public.movimientos_experiencia for select to pulso_app
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

-- ============================== Permisos ==============================
-- Grant por columna sobre `misiones`: `solucion` queda fuera del alcance del rol
-- de la aplicación. La tabla se lee, esa columna no.

grant select (id, matricula_id, plantilla_id, fecha, tipo, enunciado, xp, origen,
              creada_en, resuelta_en, acertada, intentos)
  on public.misiones to pulso_app;

grant select on public.mision_plantillas       to pulso_app;
grant select on public.mision_banco            to pulso_app;
grant select on public.movimientos_experiencia to pulso_app;
grant select on public.mi_experiencia          to pulso_app;
grant select on public.mis_misiones            to pulso_app;

grant execute on function
  public.hoy_en_chile(),
  public.mi_mision(uuid, text),
  public.mision_responder(uuid, jsonb)
  to pulso_app;

-- `mision_registrar` **no** va a pulso_app: ver la nota de la cabecera.
revoke execute on function
  public.mision_registrar(uuid, text, text, jsonb, jsonb, text) from public;

grant usage on schema public to pulso_misiones;
grant execute on function
  public.mision_registrar(uuid, text, text, jsonb, jsonb, text),
  public.hoy_en_chile()
  to pulso_misiones;
-- Y para elegir plantilla y banco al generar, solo lectura:
grant select on public.mision_plantillas, public.mision_banco to pulso_misiones;
