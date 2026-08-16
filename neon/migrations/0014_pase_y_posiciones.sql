-- El pase de batalla y la tabla de posiciones.
--
-- Tres pases por asignatura, uno por evaluación parcial, de 30 niveles cada uno.
-- La experiencia sale **solo de misiones** —las clases, actividades y laboratorios
-- pagan puntos y no dan XP— y se cuenta **dentro de la ventana del pase**: si no,
-- el pase 2 empezaría ya completo con el XP del pase 1.
--
-- Escalera: 40 XP por nivel del 1 al 10, 65 del 11 al 20, 90 del 21 al 30. Total
-- 1.950, que es exactamente lo que rinden 42 misiones diarias de 25 más 6
-- semanales de 150. Barato al principio para que enganche, caro al final para que
-- el último nivel se sienta.
--
-- Pasado el nivel 30 el XP sobrante se convierte en puntos a una tasa menor, para
-- que quien va adelante no deje de ganar nada. La tasa queda en una columna
-- porque depende de los precios de la tienda, que todavía no existen.

-- ============================== Los pases ==============================

create table if not exists public.pases (
  id            uuid primary key default gen_random_uuid(),
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  periodo_id    uuid not null references public.periodos(id)    on delete restrict,
  numero        integer not null check (numero between 1 and 9),
  nombre        text not null,
  desde         timestamptz not null,
  hasta         timestamptz not null,
  -- Cuántos puntos se llevan por cada XP sobrante después del nivel 30.
  xp_por_punto  integer not null default 5 check (xp_por_punto > 0),
  activo        boolean not null default true,
  unique (asignatura_id, periodo_id, numero),
  check (hasta > desde)
);

-- ============================== Cosméticos ==============================
-- En tablas y no en código: el docente va a ir subiendo títulos e íconos todo el
-- semestre, y eso no puede pedir un despliegue. `temporada` permite retirar los
-- de este año sin borrarle a nadie lo que ya se ganó.

create table if not exists public.cosmeticos (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,
  tipo        text not null check (tipo in ('titulo', 'avatar', 'marco', 'color', 'insignia')),
  nombre      text not null,
  descripcion text,
  -- Qué aplica: el texto del título, la clave del estilo de avatar, el color…
  valor       text not null,
  rareza      text not null default 'comun'
                check (rareza in ('comun', 'poco_comun', 'rara', 'epica', 'legendaria')),
  temporada   text,
  activo      boolean not null default true
);

create table if not exists public.pase_recompensas (
  id           bigint primary key generated always as identity,
  pase_id      uuid not null references public.pases(id) on delete cascade,
  nivel        integer not null check (nivel between 1 and 30),
  cosmetico_id uuid references public.cosmeticos(id) on delete cascade,
  tiradas      integer not null default 0 check (tiradas >= 0),
  unique (pase_id, nivel)
);

create table if not exists public.alumno_cosmeticos (
  matricula_id uuid not null references public.matriculas(id) on delete cascade,
  cosmetico_id uuid not null references public.cosmeticos(id) on delete cascade,
  obtenido_en  timestamptz not null default now(),
  origen       text not null default 'pase',
  primary key (matricula_id, cosmetico_id)
);

-- Las tiradas de gacha también en libro: solo crece, y gastar es un movimiento
-- negativo. Todavía no hay gacha, pero el pase ya las entrega.
create table if not exists public.movimientos_tiradas (
  id           bigint primary key generated always as identity,
  matricula_id uuid not null references public.matriculas(id) on delete cascade,
  cantidad     integer not null,
  motivo       text not null,
  creado_en    timestamptz not null default now()
);

-- Lo que el alumno lleva puesto. Va en la matrícula y no en el perfil porque la
-- experiencia y los puntos son por ramo, y la tabla de posiciones también.
alter table public.matriculas
  add column if not exists titulo_id uuid references public.cosmeticos(id) on delete set null,
  add column if not exists marco_id  uuid references public.cosmeticos(id) on delete set null;

-- ============================== La escalera ==============================

create or replace function public.xp_hasta_nivel(p_nivel integer)
returns integer language sql immutable as $$
  -- Acumulado para **llegar** a ese nivel. Nivel 1 = 0 XP: se parte en el 1.
  select case
    when p_nivel <= 1  then 0
    when p_nivel <= 10 then (p_nivel - 1) * 40
    when p_nivel <= 20 then 360 + (p_nivel - 10) * 65
    when p_nivel <= 30 then 1010 + (p_nivel - 20) * 90
    else 1910 + (p_nivel - 30) * 90
  end;
$$;

create or replace function public.nivel_de_xp(p_xp integer)
returns integer language sql immutable as $$
  select greatest(1, least(30, (
    select max(n) from generate_series(1, 30) n where public.xp_hasta_nivel(n) <= greatest(p_xp, 0))));
$$;

-- ============================== El pase del alumno ==============================

create or replace function public.mi_pase(p_matricula uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pase   public.pases;
  v_xp     integer;
  v_nivel  integer;
  v_desde  integer;
  v_hasta  integer;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  -- El pase vigente del ramo de esa matrícula.
  select p.* into v_pase
    from public.pases p
    join public.secciones  s  on s.asignatura_id = p.asignatura_id
                             and s.periodo_id    = p.periodo_id
    join public.matriculas mt on mt.seccion_id = s.id
   where mt.id = p_matricula and p.activo and now() between p.desde and p.hasta
   order by p.numero limit 1;

  if not found then
    -- Fuera de ventana: se muestra el último que hubo, para que el alumno no vea
    -- una pantalla en blanco entre una evaluación y la siguiente.
    select p.* into v_pase
      from public.pases p
      join public.secciones  s  on s.asignatura_id = p.asignatura_id
                               and s.periodo_id    = p.periodo_id
      join public.matriculas mt on mt.seccion_id = s.id
     where mt.id = p_matricula and p.activo and p.hasta < now()
     order by p.hasta desc limit 1;
  end if;

  if not found then return null; end if;

  -- Solo el XP ganado dentro de la ventana de este pase.
  select coalesce(sum(xp), 0)::integer into v_xp
    from public.movimientos_experiencia
   where matricula_id = p_matricula
     and creado_en >= v_pase.desde and creado_en < v_pase.hasta;

  v_nivel := public.nivel_de_xp(v_xp);
  v_desde := public.xp_hasta_nivel(v_nivel);
  v_hasta := public.xp_hasta_nivel(v_nivel + 1);

  return jsonb_build_object(
    'pase_id',   v_pase.id,
    'numero',    v_pase.numero,
    'nombre',    v_pase.nombre,
    'desde',     v_pase.desde,
    'hasta',     v_pase.hasta,
    'vigente',   now() between v_pase.desde and v_pase.hasta,
    'xp',        v_xp,
    'nivel',     v_nivel,
    'xp_nivel',      v_xp - v_desde,          -- lo avanzado dentro del nivel
    'xp_para_subir', greatest(0, v_hasta - v_desde),
    'xp_total_pase', public.xp_hasta_nivel(30),
    'completo',  v_nivel >= 30,
    -- El sobrante solo cuenta una vez llegado al 30.
    'xp_sobrante', greatest(0, v_xp - public.xp_hasta_nivel(30)),
    'puntos_por_sobrante', greatest(0, v_xp - public.xp_hasta_nivel(30)) / v_pase.xp_por_punto,
    'recompensas', coalesce((
       select jsonb_agg(jsonb_build_object(
                'nivel', r.nivel,
                'tiradas', r.tiradas,
                'cosmetico', case when c.id is null then null else jsonb_build_object(
                    'id', c.id, 'tipo', c.tipo, 'nombre', c.nombre,
                    'descripcion', c.descripcion, 'valor', c.valor, 'rareza', c.rareza) end,
                'desbloqueada', r.nivel <= v_nivel,
                'obtenida', ac.matricula_id is not null)
              order by r.nivel)
         from public.pase_recompensas r
         left join public.cosmeticos c on c.id = r.cosmetico_id
         left join public.alumno_cosmeticos ac on ac.cosmetico_id = r.cosmetico_id
                                              and ac.matricula_id = p_matricula
        where r.pase_id = v_pase.id), '[]'::jsonb));
end;
$$;

-- ============================== Entregar lo desbloqueado ==============================
-- Se llama al abrir la pantalla del pase. Es idempotente: entrega solo lo que
-- falta, y devuelve qué entregó para poder celebrarlo en la interfaz.

create or replace function public.sincronizar_pase(p_matricula uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_pase    jsonb := public.mi_pase(p_matricula);
  v_nivel   integer;
  v_pase_id uuid;
  v_nuevos  jsonb := '[]'::jsonb;
  v_tiradas integer := 0;
  r         record;
begin
  if v_pase is null then return null; end if;
  v_nivel   := (v_pase->>'nivel')::integer;
  v_pase_id := (v_pase->>'pase_id')::uuid;

  for r in
    select pr.nivel, pr.tiradas, pr.cosmetico_id, c.nombre, c.tipo, c.rareza
      from public.pase_recompensas pr
      left join public.cosmeticos c on c.id = pr.cosmetico_id
     where pr.pase_id = v_pase_id
       and pr.nivel <= v_nivel
       and (pr.cosmetico_id is null or not exists (
             select 1 from public.alumno_cosmeticos ac
              where ac.matricula_id = p_matricula and ac.cosmetico_id = pr.cosmetico_id))
     order by pr.nivel
  loop
    if r.cosmetico_id is not null then
      insert into public.alumno_cosmeticos (matricula_id, cosmetico_id, origen)
      values (p_matricula, r.cosmetico_id, 'pase')
      on conflict do nothing;
      v_nuevos := v_nuevos || jsonb_build_object(
        'nivel', r.nivel, 'nombre', r.nombre, 'tipo', r.tipo, 'rareza', r.rareza);
    end if;
  end loop;

  -- Las tiradas se entregan una sola vez por nivel: el motivo lleva el nivel y se
  -- comprueba contra el libro, que es la única fuente.
  for r in
    select pr.nivel, pr.tiradas from public.pase_recompensas pr
     where pr.pase_id = v_pase_id and pr.nivel <= v_nivel and pr.tiradas > 0
       and not exists (select 1 from public.movimientos_tiradas mt
                        where mt.matricula_id = p_matricula
                          and mt.motivo = 'Pase nivel ' || pr.nivel)
     order by pr.nivel
  loop
    insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
    values (p_matricula, r.tiradas, 'Pase nivel ' || r.nivel);
    v_tiradas := v_tiradas + r.tiradas;
  end loop;

  -- Si el alumno se puso un título y no tenía ninguno, se le equipa el primero
  -- que gane: un título que hay que ir a buscar al menú no lo luce nadie.
  update public.matriculas mt
     set titulo_id = (select ac.cosmetico_id from public.alumno_cosmeticos ac
                        join public.cosmeticos c on c.id = ac.cosmetico_id
                       where ac.matricula_id = p_matricula and c.tipo = 'titulo'
                       order by ac.obtenido_en limit 1)
   where mt.id = p_matricula and mt.titulo_id is null;

  return jsonb_build_object('nuevos', v_nuevos, 'tiradas', v_tiradas);
end;
$$;

-- ============================== Equipar ==============================

create or replace function public.equipar_cosmetico(p_matricula uuid, p_cosmetico uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_tipo text;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  if p_cosmetico is null then
    update public.matriculas set titulo_id = null where id = p_matricula;
    return;
  end if;

  if not exists (select 1 from public.alumno_cosmeticos
                  where matricula_id = p_matricula and cosmetico_id = p_cosmetico) then
    raise exception 'Todavía no has ganado eso';
  end if;

  select tipo into v_tipo from public.cosmeticos where id = p_cosmetico;
  if v_tipo = 'titulo' then
    update public.matriculas set titulo_id = p_cosmetico where id = p_matricula;
  elsif v_tipo = 'marco' then
    update public.matriculas set marco_id = p_cosmetico where id = p_matricula;
  else
    raise exception 'Ese cosmético no se equipa';
  end if;
end;
$$;

-- ============================== Tabla de posiciones ==============================
-- Los empatados **comparten lugar** —`rank()`, no `row_number()`— y entre ellos
-- va primero quien llegó antes a ese puntaje. Se excluyen las cuentas docentes y
-- la de prueba: mi cuenta de pruebas encabezando el curso sería un mal chiste.

drop view if exists public.posiciones;
create view public.posiciones with (security_invoker = true) as
  with xp as (
    select mt.id as matricula_id, s.asignatura_id, s.periodo_id, s.codigo as seccion,
           pf.nombre, pf.avatar, mt.titulo_id, mt.marco_id,
           coalesce(sum(me.xp), 0)::integer as xp,
           max(me.creado_en) as ultimo
      from public.matriculas mt
      join public.perfiles   pf on pf.id = mt.perfil_id
      join public.usuarios   u  on u.id  = pf.id
      join public.secciones  s  on s.id  = mt.seccion_id
      left join public.movimientos_experiencia me on me.matricula_id = mt.id
     where mt.activa
       and u.correo not ilike '%prueba%'
       and not exists (select 1 from public.docentes d where d.id = pf.id)
     group by mt.id, s.asignatura_id, s.periodo_id, s.codigo, pf.nombre, pf.avatar,
              mt.titulo_id, mt.marco_id)
  select xp.*,
         t.valor as titulo,
         rank() over (partition by xp.asignatura_id, xp.periodo_id order by xp.xp desc) as lugar,
         row_number() over (partition by xp.asignatura_id, xp.periodo_id
                            order by xp.xp desc, xp.ultimo asc nulls last) as orden
    from xp
    left join public.cosmeticos t on t.id = xp.titulo_id;

-- ============================== Permisos ==============================

alter table public.pases              enable row level security;
alter table public.cosmeticos         enable row level security;
alter table public.pase_recompensas   enable row level security;
alter table public.alumno_cosmeticos  enable row level security;
alter table public.movimientos_tiradas enable row level security;

drop policy if exists "pases: lectura" on public.pases;
create policy "pases: lectura" on public.pases for select to pulso_app using (activo);

drop policy if exists "cosmeticos: lectura" on public.cosmeticos;
create policy "cosmeticos: lectura" on public.cosmeticos for select to pulso_app using (activo);

drop policy if exists "recompensas: lectura" on public.pase_recompensas;
create policy "recompensas: lectura" on public.pase_recompensas for select to pulso_app using (true);

drop policy if exists "cosmeticos ganados: los mios" on public.alumno_cosmeticos;
create policy "cosmeticos ganados: los mios" on public.alumno_cosmeticos for select to pulso_app
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

drop policy if exists "tiradas: las mias" on public.movimientos_tiradas;
create policy "tiradas: las mias" on public.movimientos_tiradas for select to pulso_app
  using (public.mi_matricula(matricula_id) or public.docente_ve_matricula(matricula_id));

grant select on public.pases, public.cosmeticos, public.pase_recompensas,
                public.alumno_cosmeticos, public.movimientos_tiradas,
                public.posiciones
  to pulso_app;

grant execute on function
  public.xp_hasta_nivel(integer), public.nivel_de_xp(integer),
  public.mi_pase(uuid), public.sincronizar_pase(uuid),
  public.equipar_cosmetico(uuid, uuid)
  to pulso_app;
