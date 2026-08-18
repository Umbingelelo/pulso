-- El ranking es de la sección, no de la asignatura. Y el título viaja con el ramo.
--
-- ── Por qué por sección ──
--
-- `tabla_posiciones` comparaba a todos los de la asignatura. En DSY1107 eso pone
-- a las tres secciones en la misma tabla, y hoy 001D lleva 2.175 de XP contra 75
-- de 002D y 50 de 003D: los de las otras dos aparecían al fondo de una lista que
-- no era la suya, viendo puntajes de gente con la que nunca comparten sala.
--
-- Una sección es un curso: es la unidad con la que el alumno se compara. Y de paso
-- deja de exponer a compañeros de otra sección, que es información que el ranking
-- no necesitaba dar.
--
-- ── El título ──
--
-- `mis_ramos` gana `titulo`, que es lo que el alumno lleva puesto en **ese** ramo:
-- el título se equipa por matrícula, así que el mismo alumno puede llevar uno en
-- Cloud Native y otro en Arquitectura. Con eso la barra lateral puede mostrarlo
-- bajo su cara sin una consulta aparte.
--
-- La vista se lee con `select('*')`, así que la columna nueva llega sola. Si
-- PostgREST tarda en refrescar su caché, lo único que pasa es que el título no
-- aparece todavía — no se rompe nada.

create or replace view public.mis_ramos with (security_invoker = true) as
 SELECT mt.id AS matricula_id,
    mt.perfil_id,
    mt.activa,
    mt.creado_en,
    s.id AS seccion_id,
    s.codigo AS seccion,
    a.id AS asignatura_id,
    a.sigla,
    a.nombre AS asignatura,
    p.id AS periodo_id,
    p.codigo AS periodo,
    p.nombre AS periodo_nombre,
    p.activo AS periodo_activo,
    COALESCE(( SELECT sum(m.puntos) AS sum
           FROM movimientos_puntos m
          WHERE m.matricula_id = mt.id), 0::bigint)::integer AS puntos,
    c.valor AS titulo
   FROM matriculas mt
     JOIN secciones s ON s.id = mt.seccion_id
     JOIN asignaturas a ON a.id = s.asignatura_id
     JOIN periodos p ON p.id = s.periodo_id
     LEFT JOIN cosmeticos c ON c.id = mt.titulo_id;

-- ============================== La tabla de posiciones ==============================

create or replace function public.tabla_posiciones(p_matricula uuid, p_limite integer default 40)
returns table (
  matricula_id uuid,
  nombre       text,
  avatar       text,
  titulo       text,
  xp           integer,
  lugar        bigint,
  orden        bigint,
  soy_yo       boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_seccion uuid;
begin
  if not public.mi_matricula(p_matricula) and not public.docente_ve_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  -- La sección, y no la asignatura: es la unidad con la que el alumno se compara.
  select mt.seccion_id into v_seccion
    from public.matriculas mt where mt.id = p_matricula;

  return query
    with base as (
      select mt.id,
             pf.nombre,
             pf.avatar,
             c.valor as titulo,
             coalesce(sum(me.xp), 0)::integer as xp,
             max(me.creado_en) as ultimo
        from public.matriculas mt
        join public.perfiles  pf on pf.id = mt.perfil_id
        left join public.cosmeticos c on c.id = mt.titulo_id
        left join public.movimientos_experiencia me on me.matricula_id = mt.id
       where mt.activa
         and mt.seccion_id = v_seccion
         and not pf.oculto_en_ranking
       group by mt.id, pf.nombre, pf.avatar, c.valor)
    select b.id, b.nombre, b.avatar, b.titulo, b.xp,
           -- Los empatados comparten lugar…
           rank()       over (order by b.xp desc),
           -- …y entre ellos va primero quien llegó antes a ese puntaje.
           row_number() over (order by b.xp desc, b.ultimo asc nulls last),
           b.id = p_matricula
      from base b
     order by 7
     limit greatest(1, least(coalesce(p_limite, 40), 200));
end;
$$;

grant execute on function public.tabla_posiciones(uuid, integer) to pulso_app;
