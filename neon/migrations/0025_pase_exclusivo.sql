-- Lo del pase no sale en el gacha, y ni el pase ni el gacha pagan puntos.
--
-- ── Exclusividad, derivada y no declarada ──
--
-- Un cosmético que es recompensa del pase **no entra al pozo del gacha**. Eso no
-- se marca con una columna `exclusivo` que alguien tenga que acordarse de poner:
-- se deriva de `pase_recompensas`. Si está en la escalera del pase, no está en el
-- gacha, y basta con asignarlo o quitarlo de un nivel para que cambie.
--
-- Una columna aparte habría podido quedar en desacuerdo con la realidad —marcada
-- exclusiva y sin nivel asignado, o al revés— y ese desacuerdo no falla en
-- ninguna parte: simplemente un premio del pase empieza a salir en el gacha y
-- deja de ser un premio.
--
-- ── Ni el pase ni el gacha reparten puntos ──
--
-- Los puntos son de las actividades y se gastan en la tienda. El pase reparte XP,
-- niveles, cosméticos y tiradas; el gacha reparte cosméticos. Son dos economías y
-- mezclarlas quita sentido a las dos.
--
-- Y había una mentira concreta que arreglar: `mi_pase` devolvía
-- `puntos_por_sobrante` —«el XP que sigas ganando se convierte en puntos»— y
-- **nadie los pagaba nunca**. No hay un solo `insert` sobre `movimientos_puntos`
-- en toda la lógica del pase. El alumno llegaba al nivel 30, la pantalla le
-- prometía puntos, y su saldo no se movía. Eso se va, y con él la columna
-- `xp_por_punto`, que era la tasa de una conversión que no existe: dejarla ahí es
-- dejar puesta la trampa para que alguien vuelva a creerle.

-- ============================== El pase deja de hablar de puntos ==============================

alter table public.pases drop column if exists xp_por_punto;

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
    -- El sobrante solo cuenta una vez llegado al 30. Se informa porque es
    -- cierto y se ve en la barra, pero **no se promete nada por él**: el
    -- pase no paga puntos.
    'xp_sobrante', greatest(0, v_xp - public.xp_hasta_nivel(30)),
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

-- ============================== El gacha respeta lo del pase ==============================
--
-- Dos cambios sobre la versión anterior, y nada más: el pozo excluye lo que es
-- recompensa del pase, y eso vale también para el sorteo de rareza —si una rareza
-- se quedó sin nada que no sea del pase, no puede salir, o se sortearía y no
-- habría qué entregar—.

create or replace function public.gacha_tirar(p_matricula uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_saldo integer; v_dado numeric; v_rareza text; v_c public.cosmeticos;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  v_saldo := public.mis_tiradas(p_matricula);
  if v_saldo < 1 then
    raise exception 'No te quedan tiradas';
  end if;

  v_dado := random();

  with faltan as (
    select c.rareza, count(*)::integer as n
      from public.cosmeticos c
     where c.activo
       and not exists (select 1 from public.alumno_cosmeticos ac
                        where ac.matricula_id = p_matricula and ac.cosmetico_id = c.id)
       -- Lo del pase se gana subiendo de nivel, no por suerte.
       and not exists (select 1 from public.pase_recompensas pr
                        where pr.cosmetico_id = c.id)
     group by c.rareza
  ),
  acum as (
    select f.rareza, g.orden,
           sum(g.peso) over (order by g.orden)::numeric as hasta,
           sum(g.peso) over ()::numeric                 as total
      from faltan f join public.gacha_rarezas g on g.rareza = f.rareza
  )
  select a.rareza into v_rareza
    from acum a
   where v_dado * a.total < a.hasta
   order by a.orden
   limit 1;

  if v_rareza is null then
    raise exception 'Ya tienes todo lo que se puede sacar acá: lo que falta es del pase';
  end if;

  select c.* into v_c
    from public.cosmeticos c
   where c.activo and c.rareza = v_rareza
     and not exists (select 1 from public.alumno_cosmeticos ac
                      where ac.matricula_id = p_matricula and ac.cosmetico_id = c.id)
     and not exists (select 1 from public.pase_recompensas pr
                      where pr.cosmetico_id = c.id)
   order by random()
   limit 1;

  insert into public.alumno_cosmeticos (matricula_id, cosmetico_id, origen)
  values (p_matricula, v_c.id, 'gacha');

  -- Acá se gasta una tirada y **nunca se toca `movimientos_puntos`**. El gacha no
  -- reparte puntos: los puntos vienen de las actividades y se gastan en la tienda.
  insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
  values (p_matricula, -1, 'Tirada: ' || v_c.nombre);

  return jsonb_build_object(
    'id', v_c.id, 'codigo', v_c.codigo, 'tipo', v_c.tipo, 'nombre', v_c.nombre,
    'descripcion', v_c.descripcion, 'valor', v_c.valor, 'rareza', v_c.rareza,
    'restantes', public.mis_tiradas(p_matricula));
end;
$$;

-- ============================== La colección lo dice ==============================
-- Los del pase siguen apareciendo —es la colección completa— pero marcados, para
-- que el alumno no se quede tirando esperando algo que por ahí no sale nunca.

-- Cambia la forma de la tabla que devuelve —se agregan `del_pase` y `nivel_pase`—
-- y Postgres no deja hacer eso con un `create or replace`, así que se borra antes.
drop function if exists public.mis_cosmeticos(uuid);

create or replace function public.mis_cosmeticos(p_matricula uuid)
returns table (
  id uuid, codigo text, tipo text, nombre text, descripcion text, valor text,
  rareza text, rareza_nombre text, rareza_orden integer,
  tengo boolean, equipado boolean, del_pase boolean, nivel_pase integer
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.codigo, c.tipo, c.nombre, c.descripcion, c.valor,
         c.rareza, g.nombre, g.orden,
         ac.matricula_id is not null,
         case c.tipo
           when 'titulo' then mt.titulo_id = c.id
           when 'marco'  then mt.marco_id  = c.id
           when 'avatar' then pf.avatar    = c.valor
           else false
         end,
         pr.cosmetico_id is not null,
         pr.nivel
    from public.cosmeticos c
    join public.gacha_rarezas g on g.rareza = c.rareza
    join public.matriculas mt on mt.id = p_matricula
    join public.perfiles   pf on pf.id = mt.perfil_id
    join public.secciones   s on s.id = mt.seccion_id
    left join public.alumno_cosmeticos ac
           on ac.cosmetico_id = c.id and ac.matricula_id = p_matricula
    -- El nivel es el del pase de **su** ramo: el mismo cosmético puede estar en
    -- otro nivel en otra asignatura.
    left join lateral (
      select pr.cosmetico_id, min(pr.nivel) as nivel
        from public.pase_recompensas pr
        join public.pases p on p.id = pr.pase_id
       where pr.cosmetico_id = c.id
         and p.asignatura_id = s.asignatura_id and p.periodo_id = s.periodo_id
       group by pr.cosmetico_id
    ) pr on true
   where c.activo
     and (public.mi_matricula(p_matricula) or public.docente_ve_matricula(p_matricula))
   order by g.orden desc, c.tipo, c.nombre;
$$;

-- `mis_cosmeticos` se borró más arriba para poder cambiarle la forma, y borrar una
-- función se lleva sus grants. Reponerlos acá no es opcional: sin esto la
-- colección deja de cargar para el alumno en cuanto se aplica la migración.
grant execute on function
  public.mi_pase(uuid),
  public.mis_cosmeticos(uuid)
  to pulso_app;
