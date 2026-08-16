-- La tabla de posiciones, por una puerta estrecha.
--
-- El RLS de Pulso dice, desde el primer día, que un alumno ve **su** matrícula y
-- **su** perfil. Por eso la vista `posiciones` devolvía una sola fila: no estaba
-- rota, estaba haciendo su trabajo.
--
-- Una tabla de posiciones necesita atravesar esa regla, y hay dos formas. Una es
-- relajar las políticas de `perfiles` y `matriculas` para que los compañeros se
-- vean entre sí; eso abre esas tablas enteras para todas las consultas de la app,
-- para siempre. La otra —esta— es una función `security definer` que devuelve
-- **exactamente** las cinco columnas del ranking, solo del ramo de quien pregunta.
--
-- Lo que se expone es lo que un ranking expone por definición: nombre, avatar,
-- título y experiencia de los compañeros de asignatura. Nada más: ni correo, ni
-- puntos, ni diagnóstico, ni sección de otro. Y queda en un solo lugar auditable
-- en vez de repartido en dos políticas.

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
declare v_asig uuid; v_per uuid;
begin
  if not public.mi_matricula(p_matricula) and not public.docente_ve_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select s.asignatura_id, s.periodo_id into v_asig, v_per
    from public.matriculas mt join public.secciones s on s.id = mt.seccion_id
   where mt.id = p_matricula;

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
        join public.secciones s  on s.id  = mt.seccion_id
        left join public.cosmeticos c on c.id = mt.titulo_id
        left join public.movimientos_experiencia me on me.matricula_id = mt.id
       where mt.activa
         and s.asignatura_id = v_asig and s.periodo_id = v_per
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

-- La vista ya no hace falta y dejarla invita a que alguien la use creyendo que
-- funciona, cuando devuelve una sola fila por el RLS.
drop view if exists public.posiciones;
