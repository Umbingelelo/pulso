-- Arranca la EP2: el pase y el ranking parten de cero, las misiones pagan más, el
-- gacha puede entregar puntos y el docente recibe un correo con lo que lo espera.
--
-- ── Las ventanas ──
--
-- El Segundo parcial empieza el lunes 28 de septiembre a las 00:00 de Santiago en
-- las dos asignaturas. En DSY1107 era casi eso (00:00 UTC, tres horas antes). En
-- ITY1102 la planificación lo ponía el 14, pero la EP1 se rindió después: la
-- escalera del Segundo parcial llevaba dos semanas corriendo sobre semanas que
-- eran de la EP1. Se corre el borde y el Primer parcial de ITY1102 se estira hasta
-- el 28, así que esas dos semanas de misiones **no se pierden**: vuelven a contar
-- donde se ganaron, en el pase de la EP1.
--
-- ── Una tirada del pase es de un pase ──
--
-- `sincronizar_pase` comprobaba si ya había pagado la tirada de un nivel buscando
-- el motivo `'Pase nivel 5'` en el libro, **sin mirar de qué pase**. Así que quien
-- llegó al nivel 5 en la EP1 nunca iba a cobrar la tirada del nivel 5 de la EP2, ni
-- la del 10, ni ninguna que ya hubiera cobrado antes: medido contra la base, el
-- que más avanzó en el Segundo parcial de ITY1102 iba en nivel 9 con cero tiradas
-- nuevas. Sin un error en ninguna parte: el pase decía «+1 tirada» y el contador
-- no se movía. Desde acá la tirada lleva `pase_id` y `nivel`, con un índice único
-- que es el que decide, no un texto.
--
-- ── Lo desbloqueado en un pase cerrado se entrega igual ──
--
-- La sincronización se hacía **solo sobre el pase vigente**, y solo al abrir la
-- pantalla del pase. Quien subió de nivel el último día de la EP1 y no abrió el
-- pase antes del cierre perdía esos premios para siempre: al día siguiente el
-- vigente era otro. Ahora recorre todos los pases del ramo que ya empezaron.
--
-- ── El ranking es del parcial ──
--
-- `tabla_posiciones` sumaba todo el XP del semestre, así que el ranking nunca se
-- reiniciaba y la EP2 empezaba con los mismos cinco arriba por lo que hicieron en
-- agosto. Ahora cuenta el XP dentro de la ventana del pase —la misma cuenta que
-- decide el nivel— y se reinicia solo con cada parcial. Además deja fuera a quien
-- lleva cero: el primer día de un parcial la tabla eran cuarenta nombres
-- empatados en el primer lugar con 0.

-- ============================== Ventanas de la EP2 ==============================

update public.pases p
   set hasta = timestamptz '2026-09-28 00:00:00 America/Santiago'
  from public.periodos pe
 where pe.id = p.periodo_id and pe.codigo = '2026-2' and p.numero = 1;

update public.pases p
   set desde = timestamptz '2026-09-28 00:00:00 America/Santiago'
  from public.periodos pe
 where pe.id = p.periodo_id and pe.codigo = '2026-2' and p.numero = 2;

-- Los demás bordes estaban a las 00:00 **UTC**, que en Santiago es las 21:00 del día
-- anterior: la pantalla decía «Cierra el 25/10» de un pase que cierra el 26. Todavía
-- no empiezan, así que se alinean sin tocar a nadie: cada borde, a medianoche de
-- Santiago del mismo día que decía.
update public.pases p
   set desde = case when p.numero = 3
                    then ((p.desde at time zone 'UTC')::date::timestamp at time zone 'America/Santiago')
                    else p.desde end,
       hasta = ((p.hasta at time zone 'UTC')::date::timestamp at time zone 'America/Santiago')
  from public.periodos pe
 where pe.id = p.periodo_id and pe.codigo = '2026-2' and p.numero in (2, 3)
   and p.hasta > now();

-- ============================== El pase de una matrícula ==============================
--
-- El vigente, y si no hay, el último que cerró. Es la misma elección que hacía
-- `mi_pase` por dentro; sale a una función porque ahora la necesita también el
-- ranking, y dos copias de «¿cuál es el pase de este ramo?» terminan contestando
-- distinto.

create or replace function public.pase_de_matricula(p_matricula uuid)
returns public.pases
language sql
stable
set search_path = public
as $$
  select p.*
    from public.pases p
    join public.secciones  s  on s.asignatura_id = p.asignatura_id
                             and s.periodo_id    = p.periodo_id
    join public.matriculas mt on mt.seccion_id = s.id
   where mt.id = p_matricula and p.activo and p.desde <= now()
   order by (now() < p.hasta) desc, p.hasta desc
   limit 1;
$$;

-- No la llama nadie de afuera: solo las funciones `security definer` de acá abajo.
revoke all on function public.pase_de_matricula(uuid) from public;

create or replace function public.xp_en_pase(p_matricula uuid, p_desde timestamptz, p_hasta timestamptz)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(sum(xp), 0)::integer
    from public.movimientos_experiencia
   where matricula_id = p_matricula and creado_en >= p_desde and creado_en < p_hasta;
$$;

revoke all on function public.xp_en_pase(uuid, timestamptz, timestamptz) from public;

-- ============================== mi_pase ==============================
--
-- Igual que la de la 0037, con la elección del pase en `pase_de_matricula`.

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
  v_forma  text;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select pf.forma_titulo into v_forma
    from public.matriculas mt
    join public.perfiles pf on pf.id = mt.perfil_id
   where mt.id = p_matricula;

  v_pase := public.pase_de_matricula(p_matricula);
  if v_pase.id is null then return null; end if;

  v_xp    := public.xp_en_pase(p_matricula, v_pase.desde, v_pase.hasta);
  v_nivel := public.nivel_de_xp(v_xp);
  v_desde := public.xp_hasta_nivel(v_nivel);
  v_hasta := public.xp_hasta_nivel(v_nivel + 1);

  return jsonb_build_object(
    'pase_id',   v_pase.id,
    'numero',    v_pase.numero,
    'nombre',    v_pase.nombre,
    'desde',     v_pase.desde,
    'hasta',     v_pase.hasta,
    'vigente',   now() >= v_pase.desde and now() < v_pase.hasta,
    'xp',        v_xp,
    'nivel',     v_nivel,
    'xp_nivel',      v_xp - v_desde,
    'xp_para_subir', greatest(0, v_hasta - v_desde),
    'xp_total_pase', public.xp_hasta_nivel(30),
    'completo',  v_nivel >= 30,
    'xp_sobrante', greatest(0, v_xp - public.xp_hasta_nivel(30)),
    'recompensas', coalesce((
       select jsonb_agg(jsonb_build_object(
                'nivel', r.nivel,
                'tiradas', r.tiradas,
                'cosmetico', case when c.id is null then null else jsonb_build_object(
                    'id', c.id, 'tipo', c.tipo,
                    'nombre', public.titulo_texto(c.nombre, c.valor_femenino, v_forma),
                    'descripcion', c.descripcion,
                    'valor', public.titulo_texto(c.valor, c.valor_femenino, v_forma),
                    'rareza', c.rareza) end,
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

-- ============================== La tirada sabe de qué pase es ==============================

alter table public.movimientos_tiradas
  add column if not exists pase_id uuid references public.pases(id) on delete restrict,
  add column if not exists nivel   integer;

-- Las que ya se pagaron: todas dicen «Pase nivel N» y todas son del pase cuya
-- ventana contiene el momento en que se pagaron. Con las ventanas de arriba ya
-- corridas, eso es el Primer parcial en los dos ramos.
update public.movimientos_tiradas t
   set pase_id = p.id,
       nivel   = substring(t.motivo from '^Pase nivel (\d+)$')::integer
  from public.matriculas mt
  join public.secciones  s on s.id = mt.seccion_id
  join public.pases      p on p.asignatura_id = s.asignatura_id and p.periodo_id = s.periodo_id
 where t.matricula_id = mt.id
   and t.pase_id is null
   and t.motivo ~ '^Pase nivel \d+$'
   and t.creado_en >= p.desde and t.creado_en < p.hasta;

do $$
declare v_sueltas integer;
begin
  select count(*) into v_sueltas from public.movimientos_tiradas
   where motivo ~ '^Pase nivel \d+$' and pase_id is null;
  if v_sueltas > 0 then
    raise exception 'Quedaron % tiradas del pase sin saber de qué pase son', v_sueltas;
  end if;
end $$;

alter table public.movimientos_tiradas
  drop constraint if exists movimientos_tiradas_pase_nivel_juntos,
  add constraint movimientos_tiradas_pase_nivel_juntos
    check ((pase_id is null) = (nivel is null));

create unique index if not exists ux_tiradas_pase_nivel
  on public.movimientos_tiradas (matricula_id, pase_id, nivel)
  where pase_id is not null;

-- ============================== Entregar lo desbloqueado, en todos los pases ==============================
--
-- Idempotente como antes: entrega solo lo que falta y devuelve qué entregó. Las
-- tiradas se cuelgan de `(pase_id, nivel)` y el índice único es el que impide
-- cobrar dos veces, también si dos pestañas sincronizan a la vez.

create or replace function public.sincronizar_pase(p_matricula uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_forma   text;
  v_nivel   integer;
  v_nuevos  jsonb := '[]'::jsonb;
  v_tiradas integer := 0;
  v_hubo    boolean := false;
  v_n       integer;
  p         public.pases;
  r         record;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select pf.forma_titulo into v_forma
    from public.matriculas mt
    join public.perfiles pf on pf.id = mt.perfil_id
   where mt.id = p_matricula;

  for p in
    select pa.*
      from public.pases pa
      join public.secciones  s  on s.asignatura_id = pa.asignatura_id
                               and s.periodo_id    = pa.periodo_id
      join public.matriculas mt on mt.seccion_id = s.id
     where mt.id = p_matricula and pa.activo and pa.desde <= now()
     order by pa.desde
  loop
    v_hubo  := true;
    v_nivel := public.nivel_de_xp(public.xp_en_pase(p_matricula, p.desde, p.hasta));

    for r in
      select pr.nivel, pr.cosmetico_id, c.nombre, c.valor_femenino, c.tipo, c.rareza
        from public.pase_recompensas pr
        join public.cosmeticos c on c.id = pr.cosmetico_id
       where pr.pase_id = p.id and pr.nivel <= v_nivel
         and not exists (select 1 from public.alumno_cosmeticos ac
                          where ac.matricula_id = p_matricula and ac.cosmetico_id = pr.cosmetico_id)
       order by pr.nivel
    loop
      insert into public.alumno_cosmeticos (matricula_id, cosmetico_id, origen)
      values (p_matricula, r.cosmetico_id, 'pase')
      on conflict do nothing;
      v_nuevos := v_nuevos || jsonb_build_object(
        'nivel', r.nivel, 'pase', p.nombre,
        'nombre', public.titulo_texto(r.nombre, r.valor_femenino, v_forma),
        'tipo', r.tipo, 'rareza', r.rareza);
    end loop;

    with pagadas as (
      insert into public.movimientos_tiradas (matricula_id, cantidad, motivo, pase_id, nivel)
      select p_matricula, pr.tiradas, p.nombre || ' · nivel ' || pr.nivel, p.id, pr.nivel
        from public.pase_recompensas pr
       where pr.pase_id = p.id and pr.nivel <= v_nivel and pr.tiradas > 0
      on conflict (matricula_id, pase_id, nivel) where pase_id is not null do nothing
      returning cantidad)
    select coalesce(sum(cantidad), 0)::integer into v_n from pagadas;
    v_tiradas := v_tiradas + v_n;
  end loop;

  if not v_hubo then return null; end if;

  -- Si no llevaba título, se le equipa el primero que ganó: un título que hay que
  -- ir a buscar al menú no lo luce nadie.
  update public.matriculas mt
     set titulo_id = (select ac.cosmetico_id from public.alumno_cosmeticos ac
                        join public.cosmeticos c on c.id = ac.cosmetico_id
                       where ac.matricula_id = p_matricula and c.tipo = 'titulo'
                       order by ac.obtenido_en limit 1)
   where mt.id = p_matricula and mt.titulo_id is null;

  return jsonb_build_object('nuevos', v_nuevos, 'tiradas', v_tiradas);
end;
$$;

-- ============================== El ranking del parcial ==============================
--
-- Misma forma que la de la 0037, así que `create or replace` conserva el grant. Lo
-- que cambia es de dónde sale el XP: la ventana del pase del ramo. Sin pase que
-- haya empezado, cuenta todo, que es lo que hacía antes.

create or replace function public.tabla_posiciones(p_matricula uuid, p_limite integer default 40)
returns table (matricula_id uuid, nombre text, avatar text, titulo text, xp integer,
               lugar bigint, orden bigint, soy_yo boolean, titulo_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_seccion uuid;
  v_pase    public.pases;
  v_desde   timestamptz;
  v_hasta   timestamptz;
begin
  if not public.mi_matricula(p_matricula) and not public.docente_ve_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select mt.seccion_id into v_seccion
    from public.matriculas mt where mt.id = p_matricula;

  v_pase  := public.pase_de_matricula(p_matricula);
  v_desde := coalesce(v_pase.desde, '-infinity'::timestamptz);
  v_hasta := coalesce(v_pase.hasta, 'infinity'::timestamptz);

  return query
    with base as (
      select mt.id,
             pf.nombre,
             pf.avatar,
             c.id as titulo_id,
             public.titulo_texto(c.valor, c.valor_femenino, pf.forma_titulo) as titulo,
             coalesce(sum(me.xp), 0)::integer as xp,
             max(me.creado_en) as ultimo
        from public.matriculas mt
        join public.perfiles  pf on pf.id = mt.perfil_id
        left join public.cosmeticos c on c.id = mt.titulo_id
        left join public.movimientos_experiencia me
               on me.matricula_id = mt.id
              and me.creado_en >= v_desde and me.creado_en < v_hasta
       where mt.activa
         and mt.seccion_id = v_seccion
         and not pf.oculto_en_ranking
       group by mt.id, pf.nombre, pf.avatar, c.id, c.valor, c.valor_femenino, pf.forma_titulo),
    -- Los que llevan cero no compiten: el primer día de un parcial serían todos
    -- empatados en el primer lugar. Quien pregunta sí se queda, para verse.
    en_carrera as (
      select * from base b where b.xp > 0 or b.id = p_matricula)
    select b.id, b.nombre, b.avatar, b.titulo, b.xp,
           rank()       over (order by b.xp desc),
           row_number() over (order by b.xp desc, b.ultimo asc nulls last),
           b.id = p_matricula,
           b.titulo_id
      from en_carrera b
     order by 7
     limit greatest(1, least(coalesce(p_limite, 40), 200));
end;
$$;

-- ============================== Misiones: 75 XP ==============================
--
-- La escalera pide 1.910 XP para el nivel 30 y el Segundo parcial dura 28 días.
-- Con 25 por misión el techo real era el nivel 15 **acertando todas**: nadie
-- podía terminar un pase, y así fue en la EP1 (el que más llegó, nivel 20 en siete
-- semanas, con 1.025 XP). Con 75 se llega al 30 en 26 misiones acertadas: hay que ir todos los
-- días, pero se puede fallar dos. En la EP3, que es más larga, sobra holgura.
--
-- `misiones.xp` se fija al registrar la misión, así que las de hoy que siguen sin
-- responder se suben acá. Las que ya se acertaron hoy, con 25, reciben la
-- diferencia como un movimiento aparte: el libro no se edita, se le suma.

update public.mision_plantillas set xp = 75 where codigo = 'quiz';

insert into public.movimientos_experiencia (matricula_id, xp, motivo)
select m.matricula_id, 75 - m.xp,
       'Misión diaria · ' || to_char(m.fecha, 'DD/MM') || ' · ajuste a 75 XP'
  from public.misiones m
 where m.fecha = public.dia_mision() and m.acertada and m.xp < 75;

update public.misiones
   set xp = 75
 where fecha = public.dia_mision() and xp < 75 and (resuelta_en is null or acertada);

-- La pantalla anunciaba «suma 25 de experiencia» antes de generar la misión, con
-- un 25 escrito en el navegador: `estado_mision` no decía cuánto. Ahora lo dice.
create or replace function public.estado_mision(p_matricula uuid, p_tipo text default 'diaria')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tiene    boolean;
  v_proximo  timestamptz;
  v_xp       integer;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select exists (select 1 from public.misiones
                  where matricula_id = p_matricula and tipo = p_tipo
                    and fecha = public.dia_mision())
    into v_tiene;

  select xp into v_xp from public.mision_plantillas where activa order by orden, codigo limit 1;

  v_proximo := ((public.dia_mision()::timestamp - interval '1 day' + time '23:59')
                  at time zone 'America/Santiago');
  if v_proximo <= now() then
    v_proximo := ((public.dia_mision()::timestamp + time '23:59') at time zone 'America/Santiago');
  end if;

  return jsonb_build_object(
    'dia', public.dia_mision(),
    'ya_tiene', v_tiene,
    'puede_generar', not v_tiene,
    'xp', v_xp,
    'proxima_en', v_proximo,
    'faltan_segundos', greatest(0, ceil(extract(epoch from (v_proximo - now())))::bigint));
end;
$$;

-- ============================== El gacha puede entregar puntos ==============================
--
-- Se revierte a propósito lo que la 0024 dejó escrito —«el gacha no reparte
-- puntos»—. Esa regla existía por una mentira concreta: el pase **prometía**
-- puntos y nadie los pagaba. Acá se pagan de verdad, en la misma transacción que
-- gasta la tirada, y con un techo que impide farmear la tienda:
--
--   una de cada cuatro tiradas es una bolsa de puntos, y la bolsa sigue la rareza:
--
--     común 20 · poco común 40 · rara 75 · épica 150 · legendaria 300 · mítica 750
--
--   Lo esperado de una bolsa son 73 puntos, y de una tirada, ~18. La tirada cuesta
--   150 en la tienda: comprar tiradas para sacar puntos pierde 132 cada vez. Épica
--   devuelve lo que costó; legendaria y mítica son la suerte.
--
-- Los números viven en `gacha_rarezas`, al lado del peso, y no en el código.
--
-- ── El orden del sorteo ──
--
--   1. Se sortea la rareza entre las seis, con los pesos de siempre.
--   2. Con `prob_puntos` de esa rareza, el premio es la bolsa de esa rareza.
--   3. Si no, cosmético: de esa rareza si al alumno le falta alguno en el pozo; si
--      no, se sortea de nuevo entre las rarezas que sí tienen algo. Es exactamente
--      el reparto de antes —se puede sacar la cuenta: cada rareza agotada reparte
--      su peso entre las demás en proporción a los suyos—.
--   4. Si al alumno ya no le falta nada en ese pozo, la tirada es una bolsa. Antes
--      era un error y el botón quedaba apagado con tiradas en la mano.

alter table public.gacha_rarezas
  add column if not exists puntos      integer not null default 0 check (puntos >= 0),
  add column if not exists prob_puntos numeric not null default 0
    check (prob_puntos >= 0 and prob_puntos <= 1);

update public.gacha_rarezas g
   set puntos = v.puntos, prob_puntos = 0.25
  from (values ('comun', 20), ('poco_comun', 40), ('rara', 75),
               ('epica', 150), ('legendaria', 300), ('mitica', 750)) v(rareza, puntos)
 where g.rareza = v.rareza;

create or replace function public.gacha_tirar(p_matricula uuid, p_pozo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_saldo  integer;
  v_forma  text;
  v_g      public.gacha_rarezas;
  v_rareza text;
  v_c      public.cosmeticos;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  if p_pozo is not null and p_pozo not in ('imagen', 'titulo') then
    raise exception 'Ese pozo no existe: %', p_pozo;
  end if;

  -- Bloquear la matrícula serializa dos tiradas simultáneas: sin esto, dos pestañas
  -- con una sola tirada en el saldo podían gastar dos.
  perform 1 from public.matriculas where id = p_matricula for update;

  v_saldo := public.mis_tiradas(p_matricula);
  if v_saldo < 1 then
    raise exception 'No te quedan tiradas';
  end if;

  select pf.forma_titulo into v_forma
    from public.matriculas mt
    join public.perfiles pf on pf.id = mt.perfil_id
   where mt.id = p_matricula;

  -- Paso 1: la rareza, entre las seis. Un solo `random()` fuera de la consulta: dentro
  -- de la comparación se evaluaría una vez por fila y dejaría de respetar los pesos.
  select g.* into v_g
    from (select g.*, sum(g.peso) over (order by g.orden) as hasta,
                 sum(g.peso) over () as total
            from public.gacha_rarezas g) g,
         (select random() as dado) d
   where d.dado * g.total < g.hasta
   order by g.orden
   limit 1;

  -- Paso 2: ¿bolsa de puntos?
  if random() >= v_g.prob_puntos or v_g.puntos = 0 then
    -- Paso 3: cosmético. Primero de la rareza que salió, si le falta alguno.
    v_rareza := v_g.rareza;
    if not exists (
      select 1 from public.cosmeticos c
       where c.activo and c.rareza = v_rareza
         and (p_pozo is null
              or (p_pozo = 'imagen' and c.tipo = 'avatar')
              or (p_pozo = 'titulo' and c.tipo = 'titulo'))
         and not exists (select 1 from public.alumno_cosmeticos ac
                          where ac.matricula_id = p_matricula and ac.cosmetico_id = c.id)
         and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id))
    then
      -- Agotada: se reparte su peso entre las que todavía tienen algo.
      with faltan as (
        select distinct c.rareza
          from public.cosmeticos c
         where c.activo
           and (p_pozo is null
                or (p_pozo = 'imagen' and c.tipo = 'avatar')
                or (p_pozo = 'titulo' and c.tipo = 'titulo'))
           and not exists (select 1 from public.alumno_cosmeticos ac
                            where ac.matricula_id = p_matricula and ac.cosmetico_id = c.id)
           and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id)
      ),
      acum as (
        select g.rareza, g.orden,
               sum(g.peso) over (order by g.orden)::numeric as hasta,
               sum(g.peso) over ()::numeric                 as total
          from faltan f join public.gacha_rarezas g on g.rareza = f.rareza
      )
      select a.rareza into v_rareza
        from acum a, (select random() as dado) d
       where d.dado * a.total < a.hasta
       order by a.orden
       limit 1;
    end if;

    if v_rareza is not null then
      select c.* into v_c
        from public.cosmeticos c
       where c.activo and c.rareza = v_rareza
         and (p_pozo is null
              or (p_pozo = 'imagen' and c.tipo = 'avatar')
              or (p_pozo = 'titulo' and c.tipo = 'titulo'))
         and not exists (select 1 from public.alumno_cosmeticos ac
                          where ac.matricula_id = p_matricula and ac.cosmetico_id = c.id)
         and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id)
       order by random()
       limit 1;

      insert into public.alumno_cosmeticos (matricula_id, cosmetico_id, origen)
      values (p_matricula, v_c.id, 'gacha');

      insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
      values (p_matricula, -1, 'Tirada: ' || v_c.nombre);

      return jsonb_build_object(
        'id', v_c.id, 'codigo', v_c.codigo, 'tipo', v_c.tipo,
        'nombre', public.titulo_texto(v_c.nombre, v_c.valor_femenino, v_forma),
        'descripcion', v_c.descripcion,
        'valor', public.titulo_texto(v_c.valor, v_c.valor_femenino, v_forma),
        'rareza', v_c.rareza,
        'puntos', null,
        'restantes', public.mis_tiradas(p_matricula));
    end if;
    -- Paso 4: no le falta nada en este pozo. Cae a la bolsa de la rareza del paso 1.
  end if;

  if v_g.puntos = 0 then
    raise exception 'Ya tienes todo lo que se puede sacar en este pozo';
  end if;

  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (p_matricula, v_g.puntos, 'Gacha: bolsa ' || lower(v_g.nombre) || ' de ' || v_g.puntos || ' puntos');

  insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
  values (p_matricula, -1, 'Tirada: ' || v_g.puntos || ' puntos');

  return jsonb_build_object(
    'id', null, 'codigo', null, 'tipo', 'puntos',
    'nombre', v_g.puntos || ' puntos',
    'descripcion', 'Se sumaron a tu saldo del ramo.',
    'valor', v_g.puntos::text,
    'rareza', v_g.rareza,
    'puntos', v_g.puntos,
    'restantes', public.mis_tiradas(p_matricula));
end;
$$;

-- ============================== Avisos por correo al docente ==============================
--
-- Una vez al día, un cron de Vercel llama a `/api/docente?avisos=1`, que lee esto y
-- manda un correo con lo que está esperando al docente: canjes por aprobar, puntos
-- para evaluaciones por aplicar y reuniones que quedaron encendidas. Sin nada
-- pendiente, no hay correo.
--
-- La puerta **no** es la de `laboratorio_pauta` (0030), aunque se probó primero. Esa
-- se niega a contestarle a quien trae token de navegador preguntando por
-- `uid_del_token()`, y `uid_del_token()` devuelve nulo cuando `auth.uid()` revienta:
-- falla **abierta**. Medido contra producción, la primera llamada por la Data API
-- con un token válido de alumno —conexión recién abierta tras recargar el esquema—
-- devolvió la lista completa con correos; las siguientes sí la rechazaron.
--
-- Así que el permiso va por rol, que falla cerrado: `execute` solo para
-- `pulso_misiones`, el rol del servidor que ya usa `/api/mision` y que la Data API no
-- puede adoptar —el token que firma el servidor dice siempre `pulso_app`—. La
-- comprobación de `uid_del_token()` se deja igual, como segunda capa.

create table if not exists public.avisos_enviados (
  docente_id uuid not null references public.docentes(id) on delete cascade,
  dia        date not null,
  enviado_en timestamptz not null default now(),
  pendientes integer not null,
  primary key (docente_id, dia)
);

alter table public.avisos_enviados enable row level security;
-- Sin políticas ni grants: se escribe por `aviso_enviado()` y nada más.

create or replace function public.avisos_docentes()
returns table (docente_id uuid, nombre text, correo text, ya_enviado boolean, avisos jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.uid_del_token() is not null then
    raise exception 'Los avisos no se leen por la Data API';
  end if;

  return query
  select d.id, d.nombre, u.correo,
         exists (select 1 from public.avisos_enviados ae
                  where ae.docente_id = d.id and ae.dia = public.hoy_en_chile()),
         jsonb_build_object(
           'canjes', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', c.id, 'sigla', a.sigla, 'seccion', s.codigo,
                      'alumno', pf.nombre, 'articulo', ar.nombre,
                      'nota', c.nota_alumno, 'precio', c.precio_pagado,
                      'desde', c.creado_en) order by c.creado_en)
               from public.canjes c
               join public.articulos  ar on ar.id = c.articulo_id
               join public.matriculas mt on mt.id = c.matricula_id
               join public.perfiles   pf on pf.id = mt.perfil_id
               join public.secciones  s  on s.id = mt.seccion_id
               join public.asignaturas a on a.id = s.asignatura_id
               join public.docente_asignaturas da
                    on da.docente_id = d.id and da.asignatura_id = s.asignatura_id
                   and da.periodo_id = s.periodo_id
              where c.estado = 'solicitado'), '[]'::jsonb),
           'decimas', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', ud.id, 'sigla', a.sigla, 'seccion', s.codigo,
                      'alumno', pf.nombre, 'decimas', ud.decimas,
                      'evaluacion', ud.evaluacion, 'desde', ud.creado_en) order by ud.creado_en)
               from public.usos_decimas ud
               join public.matriculas mt on mt.id = ud.matricula_id
               join public.perfiles   pf on pf.id = mt.perfil_id
               join public.secciones  s  on s.id = mt.seccion_id
               join public.asignaturas a on a.id = s.asignatura_id
               join public.docente_asignaturas da
                    on da.docente_id = d.id and da.asignatura_id = s.asignatura_id
                   and da.periodo_id = s.periodo_id
              where ud.estado = 'solicitado'), '[]'::jsonb),
           -- Nada cierra una reunión sola (ver «Lo que falta» en el README). Dos horas
           -- es más que cualquier bloque: pasado eso, lo más probable es el olvido.
           'reuniones', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'sigla', a.sigla, 'seccion', s.codigo,
                      'descuento', r.descuento, 'desde', r.inicio) order by r.inicio)
               from public.reuniones r
               join public.secciones  s on s.id = r.seccion_id
               join public.asignaturas a on a.id = s.asignatura_id
               join public.docente_asignaturas da
                    on da.docente_id = d.id and da.asignatura_id = s.asignatura_id
                   and da.periodo_id = s.periodo_id
              where r.fin is null and r.inicio < now() - interval '2 hours'), '[]'::jsonb))
    from public.docentes d
    join public.usuarios u on u.id = d.id;
end;
$$;

create or replace function public.aviso_enviado(p_docente uuid, p_pendientes integer)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if public.uid_del_token() is not null then
    raise exception 'Los avisos no se registran por la Data API';
  end if;
  insert into public.avisos_enviados (docente_id, dia, pendientes)
  values (p_docente, public.hoy_en_chile(), p_pendientes)
  on conflict (docente_id, dia) do update
    set enviado_en = now(), pendientes = excluded.pendientes;
end;
$$;

alter function public.avisos_docentes() owner to neondb_owner;
alter function public.aviso_enviado(uuid, integer) owner to neondb_owner;
revoke all on function public.avisos_docentes() from public;
revoke all on function public.aviso_enviado(uuid, integer) from public;
grant execute on function public.avisos_docentes(), public.aviso_enviado(uuid, integer) to pulso_misiones;

-- ============================== Comprobación, en la misma transacción ==============================

do $$
declare v_mal integer;
begin
  -- Cada pase de la EP2 empieza donde termina el de la EP1.
  select count(*) into v_mal
    from public.pases p1
    join public.pases p2 on p2.asignatura_id = p1.asignatura_id
                        and p2.periodo_id = p1.periodo_id and p2.numero = 2
   where p1.numero = 1 and p1.hasta <> p2.desde;
  if v_mal > 0 then
    raise exception 'Hay % pases de la EP2 que no empiezan donde cierra la EP1', v_mal;
  end if;

  if not has_function_privilege('pulso_app', 'public.tabla_posiciones(uuid,integer)', 'EXECUTE')
     or not has_function_privilege('pulso_app', 'public.sincronizar_pase(uuid)', 'EXECUTE')
     or not has_function_privilege('pulso_app', 'public.mi_pase(uuid)', 'EXECUTE')
     or not has_function_privilege('pulso_app', 'public.gacha_tirar(uuid,text)', 'EXECUTE')
     or not has_function_privilege('pulso_app', 'public.estado_mision(uuid,text)', 'EXECUTE') then
    raise exception 'Una función del pase, el ranking, el gacha o las misiones quedó sin grant';
  end if;

  -- Lo esperado de una tirada tiene que quedar muy por debajo de lo que cuesta.
  select count(*) into v_mal from public.articulos a
   where a.activo and a.tiradas > 0
     and a.precio / a.tiradas <= (select sum(g.peso * g.prob_puntos * g.puntos) / sum(g.peso)
                                    from public.gacha_rarezas g) * 2;
  if v_mal > 0 then
    raise exception 'Una tirada de la tienda cuesta menos del doble de lo que devuelve en puntos';
  end if;
end $$;
