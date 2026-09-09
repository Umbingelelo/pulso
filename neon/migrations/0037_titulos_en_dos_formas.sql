-- Los títulos en dos formas: masculina y femenina.
--
-- De los 108 títulos activos, 56 marcan género masculino, así que a más de la mitad del
-- curso el juego le ponía un texto que no la nombra: «El Elegido del Algoritmo», «Rey del
-- Carrete», «El Compañero de Todas».
--
-- ── La forma femenina es dato y no una regla ──
--
-- Derivarla —`el → la`, `-o → -a`— falla en silencio. «Rey» no da «Reya», «GOAT» daría
-- «GOATa», y hay dos casos que cierran la discusión: «El Caballero de la Mesa» hay que
-- reescribirlo («La Dama de la Mesa»), y «El Compañero de Todas» gira **también el
-- complemento** («La Compañera de Todos»). Así que la escribe una persona; acá solo se
-- guarda y se elige.
--
-- ── La forma sigue a quien lleva el título, no a quien mira ──
--
-- Es la restricción que ordena todo lo de abajo. En la tabla de posiciones veo el título
-- de una compañera y ahí tiene que leerse en **su** forma, no en la mía. Por eso no se
-- puede resolver en el navegador con una preferencia local, y por eso cada uno de los
-- cinco sitios resuelve con el perfil de **quien lleva el título** y no con el de quien
-- consulta.
--
-- ── Nulo es «este título ya sirve para todos» ──
--
-- Cubre los 52 que ya son neutros, y es además la degradación elegante: un título con
-- género cuya forma femenina todavía no está escrita se muestra en masculino. Eso es lo
-- que permite desplegar el mecanismo antes de tener el archivo completo, en vez de que
-- sea todo o nada.
--
-- ── Dos formas y no tres ──
--
-- No hay forma neutra. Varios títulos no la tienen natural —«El Dios del Six Seven»
-- habría que reescribirlo de cero, no declinarlo— así que serían otras cien decisiones
-- editoriales. Si algún día hace falta, entra como una columna más y un valor más en el
-- check: el `else` de `titulo_texto` ya la cubre sin devolver nulo.

-- ============================== El esquema ==============================

alter table public.cosmeticos add column if not exists valor_femenino text;

comment on column public.cosmeticos.valor_femenino is
  'El texto del título en femenino. Nulo = el título ya sirve para todos.';

alter table public.perfiles
  add column if not exists forma_titulo text not null default 'masculino';

alter table public.perfiles drop constraint if exists perfiles_forma_titulo_check;
alter table public.perfiles add constraint perfiles_forma_titulo_check
  check (forma_titulo in ('masculino', 'femenino'));

comment on column public.perfiles.forma_titulo is
  'Cómo se escriben los títulos de esta persona. Es una preferencia de redacción y no su '
  'género: no se le pregunta quién es, se le pregunta cómo quiere que se lea su título.';

-- La 0024 hizo `revoke update on public.perfiles` y dejó solo `grant update (nombre)`,
-- para cerrar la escritura directa de `avatar` donde no se puede rodear. Se abre una
-- columna más, y **solo una**: `avatar` sigue cerrado, y el bloque del final lo comprueba.
grant update (forma_titulo) on public.perfiles to pulso_app;

-- ============================== La regla, en un solo lugar ==============================
--
-- El `coalesce` es lo que hace que un título sin forma femenina no salga vacío, y el
-- `else` cubre tanto 'masculino' como cualquier valor que el check todavía no conozca:
-- agregar una tercera forma en el futuro no puede producir un título nulo por descuido.

create or replace function public.titulo_texto(
  p_valor text, p_valor_femenino text, p_forma text)
returns text
language sql
immutable
as $$
  select case when p_forma = 'femenino' then coalesce(p_valor_femenino, p_valor)
              else p_valor end;
$$;

comment on function public.titulo_texto(text, text, text) is
  'El texto de un título según la forma que prefiere quien lo lleva puesto. Sin forma '
  'femenina escrita, o con una forma desconocida, devuelve el masculino: nunca nulo.';

grant execute on function public.titulo_texto(text, text, text) to pulso_app;

-- ============================== Sitio 1 de 5: mis_ramos ==============================
--
-- Se une `perfiles`, que es seguro porque `matriculas.perfil_id` es `not null` —verificado
-- contra la base: cero matrículas sin perfil—, y se agrega `titulo_id` **al final**,
-- porque `create or replace view` solo acepta columnas nuevas ahí: en medio falla con
-- «cannot change name of view column».
--
-- `titulo_id` existe para que el pase deje de comparar por texto. Ver el bloque del final.

create or replace view public.mis_ramos as
  select mt.id as matricula_id,
         mt.perfil_id,
         mt.activa,
         mt.creado_en,
         s.id as seccion_id,
         s.codigo as seccion,
         a.id as asignatura_id,
         a.sigla,
         a.nombre as asignatura,
         p.id as periodo_id,
         p.codigo as periodo,
         p.nombre as periodo_nombre,
         p.activo as periodo_activo,
         coalesce((select sum(m.puntos) from public.movimientos_puntos m
                    where m.matricula_id = mt.id), 0::bigint)::integer as puntos,
         public.titulo_texto(c.valor, c.valor_femenino, pf.forma_titulo) as titulo,
         c.id as titulo_id
    from public.matriculas mt
    join public.secciones s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
    join public.periodos p on p.id = s.periodo_id
    join public.perfiles pf on pf.id = mt.perfil_id
    left join public.cosmeticos c on c.id = mt.titulo_id;

grant select on public.mis_ramos to pulso_app;

-- ============================== Sitio 2 de 5: tabla_posiciones ==============================
--
-- Cada fila se resuelve con el `forma_titulo` de **su** perfil, y eso es lo que hace que
-- en una misma respuesta convivan las dos formas: veo mi título en femenino y el de mi
-- compañero en masculino, cada uno como su dueño lo eligió.
--
-- Cambia la forma que devuelve —`titulo_id` al final—, así que hay que borrarla y
-- recrearla. Borrar una función se lleva sus grants, y reponerlo no es opcional: sin eso
-- el ranking deja de cargar en cuanto esto se aplica. Es la lección que la 0025 ya dejó
-- escrita, y el bloque del final la comprueba.

drop function if exists public.tabla_posiciones(uuid, integer);

create or replace function public.tabla_posiciones(p_matricula uuid, p_limite integer default 40)
returns table (matricula_id uuid, nombre text, avatar text, titulo text, xp integer,
               lugar bigint, orden bigint, soy_yo boolean, titulo_id uuid)
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
             c.id as titulo_id,
             public.titulo_texto(c.valor, c.valor_femenino, pf.forma_titulo) as titulo,
             coalesce(sum(me.xp), 0)::integer as xp,
             max(me.creado_en) as ultimo
        from public.matriculas mt
        join public.perfiles  pf on pf.id = mt.perfil_id
        left join public.cosmeticos c on c.id = mt.titulo_id
        left join public.movimientos_experiencia me on me.matricula_id = mt.id
       where mt.activa
         and mt.seccion_id = v_seccion
         and not pf.oculto_en_ranking
       group by mt.id, pf.nombre, pf.avatar, c.id, c.valor, c.valor_femenino, pf.forma_titulo)
    select b.id, b.nombre, b.avatar, b.titulo, b.xp,
           -- Los empatados comparten lugar…
           rank()       over (order by b.xp desc),
           -- …y entre ellos va primero quien llegó antes a ese puntaje.
           row_number() over (order by b.xp desc, b.ultimo asc nulls last),
           b.id = p_matricula,
           b.titulo_id
      from base b
     order by 7
     limit greatest(1, least(coalesce(p_limite, 40), 200));
end;
$$;

grant execute on function public.tabla_posiciones(uuid, integer) to pulso_app;

-- ============================== Sitio 3 de 5: mis_cosmeticos ==============================
--
-- Igual que la de la 0036, con `valor` resuelto. No cambia la forma que devuelve, así que
-- va con `create or replace` y conserva su grant.
--
-- Resolver `valor` también para los avatares es un no-op: `valor_femenino` solo se escribe
-- en títulos, así que en una imagen el `coalesce` devuelve la URL igual que antes.

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
  select c.id, c.codigo, c.tipo, c.nombre, c.descripcion,
         public.titulo_texto(c.valor, c.valor_femenino, pf.forma_titulo),
         c.rareza, g.nombre, g.orden,
         ac.matricula_id is not null,
         case c.tipo
           when 'titulo' then mt.titulo_id = c.id
           when 'marco'  then mt.marco_id  = c.id
           -- Contra `c.valor` crudo y no contra el resuelto: lo que está guardado en
           -- `perfiles.avatar` es la URL, y una imagen nunca tiene forma femenina.
           when 'avatar' then pf.avatar    = c.valor
           else false
         end,
         -- Global, igual que el filtro de `gacha_tirar`: si está en la escalera de
         -- cualquier pase, no sale tirando. Ver la 0036.
         exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id),
         -- El nivel sí es el del pase de **su** ramo.
         pr.nivel
    from public.cosmeticos c
    join public.gacha_rarezas g on g.rareza = c.rareza
    join public.matriculas mt on mt.id = p_matricula
    join public.perfiles   pf on pf.id = mt.perfil_id
    join public.secciones   s on s.id = mt.seccion_id
    left join public.alumno_cosmeticos ac
           on ac.cosmetico_id = c.id and ac.matricula_id = p_matricula
    left join lateral (
      select min(pr.nivel) as nivel
        from public.pase_recompensas pr
        join public.pases p on p.id = pr.pase_id
       where pr.cosmetico_id = c.id
         and p.asignatura_id = s.asignatura_id and p.periodo_id = s.periodo_id
    ) pr on true
   where c.activo
     and (public.mi_matricula(p_matricula) or public.docente_ve_matricula(p_matricula))
   order by g.orden desc, c.tipo, c.nombre;
$$;

-- ============================== Sitio 4 de 5: mi_pase ==============================
--
-- Igual que la de la 0025 más dos cosas: se busca la forma del perfil de la matrícula, y
-- el `valor` de la recompensa se resuelve con ella.

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
    -- El sobrante solo cuenta una vez llegado al 30. Se informa porque es cierto y se ve
    -- en la barra, pero **no se promete nada por él**: el pase no paga puntos.
    'xp_sobrante', greatest(0, v_xp - public.xp_hasta_nivel(30)),
    'recompensas', coalesce((
       select jsonb_agg(jsonb_build_object(
                'nivel', r.nivel,
                'tiradas', r.tiradas,
                'cosmetico', case when c.id is null then null else jsonb_build_object(
                    'id', c.id, 'tipo', c.tipo, 'nombre', c.nombre,
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

-- ============================== Sitio 5 de 5: gacha_tirar ==============================
--
-- Igual que la de la 0035 más la forma. El `motivo` del libro de tiradas sigue usando
-- `nombre` y no el texto resuelto: es un registro contable y tiene que decir siempre lo
-- mismo del mismo cosmético, sin importar quién lo saque.

create or replace function public.gacha_tirar(p_matricula uuid, p_pozo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_saldo integer; v_dado numeric; v_rareza text; v_c public.cosmeticos; v_forma text;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  if p_pozo is not null and p_pozo not in ('imagen', 'titulo') then
    raise exception 'Ese pozo no existe: %', p_pozo;
  end if;

  v_saldo := public.mis_tiradas(p_matricula);
  if v_saldo < 1 then
    raise exception 'No te quedan tiradas';
  end if;

  select pf.forma_titulo into v_forma
    from public.matriculas mt
    join public.perfiles pf on pf.id = mt.perfil_id
   where mt.id = p_matricula;

  -- Un solo `random()` para el sorteo de rareza: llamarlo dentro de la comparación lo
  -- evaluaría una vez por fila y el sorteo dejaría de respetar los pesos.
  v_dado := random();

  with faltan as (
    select c.rareza, count(*)::integer as n
      from public.cosmeticos c
     where c.activo
       and (p_pozo is null
            or (p_pozo = 'imagen' and c.tipo = 'avatar')
            or (p_pozo = 'titulo' and c.tipo = 'titulo'))
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

  -- Cada pozo se vacía por su cuenta, así que el aviso nombra el otro: si no, el alumno
  -- con veinte tiradas lee «ya tienes todo» y deja de tirar teniendo medio pozo delante.
  if v_rareza is null then
    raise exception '%', case p_pozo
      when 'imagen' then 'Ya tienes todas las imágenes que se pueden sacar: lo que '
                         'falta es del pase. Prueba en los títulos.'
      when 'titulo' then 'Ya tienes todos los títulos que se pueden sacar: lo que '
                         'falta es del pase. Prueba en las imágenes.'
      else 'Ya tienes todo lo que se puede sacar acá: lo que falta es del pase'
    end;
  end if;

  select c.* into v_c
    from public.cosmeticos c
   where c.activo and c.rareza = v_rareza
     and (p_pozo is null
          or (p_pozo = 'imagen' and c.tipo = 'avatar')
          or (p_pozo = 'titulo' and c.tipo = 'titulo'))
     and not exists (select 1 from public.alumno_cosmeticos ac
                      where ac.matricula_id = p_matricula and ac.cosmetico_id = c.id)
     and not exists (select 1 from public.pase_recompensas pr
                      where pr.cosmetico_id = c.id)
   order by random()
   limit 1;

  insert into public.alumno_cosmeticos (matricula_id, cosmetico_id, origen)
  values (p_matricula, v_c.id, 'gacha');

  -- La tirada se gasta **después** de que hay algo que entregar, y acá **nunca se toca
  -- `movimientos_puntos`**: el gacha no reparte puntos.
  insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
  values (p_matricula, -1, 'Tirada: ' || v_c.nombre);

  return jsonb_build_object(
    'id', v_c.id, 'codigo', v_c.codigo, 'tipo', v_c.tipo, 'nombre', v_c.nombre,
    'descripcion', v_c.descripcion,
    'valor', public.titulo_texto(v_c.valor, v_c.valor_femenino, v_forma),
    'rareza', v_c.rareza,
    'restantes', public.mis_tiradas(p_matricula));
end;
$$;

-- ============================== Comprobación, en la misma transacción ==============================
-- Si algo de arriba no calzó, esto revienta y no queda a medias.

do $$
declare v_avatar integer; v_cols integer;
begin
  -- El grant de `avatar` no puede haberse reabierto de rebote.
  select count(*) into v_avatar
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'perfiles' and grantee = 'pulso_app'
     and privilege_type = 'UPDATE' and column_name = 'avatar';
  if v_avatar > 0 then
    raise exception 'Se reabrió el update sobre perfiles.avatar, que la 0024 cerró';
  end if;

  if not has_function_privilege('pulso_app',
        'public.tabla_posiciones(uuid,integer)', 'EXECUTE') then
    raise exception 'tabla_posiciones quedó sin grant: el ranking no cargaría';
  end if;

  select count(*) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'mis_ramos' and column_name = 'titulo_id';
  if v_cols <> 1 then
    raise exception 'mis_ramos quedó sin titulo_id';
  end if;

  -- Y la regla tiene que ser total: ninguna combinación puede devolver nulo.
  if public.titulo_texto('X', null, 'femenino') is distinct from 'X'
     or public.titulo_texto('X', 'Y', 'femenino') is distinct from 'Y'
     or public.titulo_texto('X', 'Y', 'masculino') is distinct from 'X'
     or public.titulo_texto('X', null, 'lo-que-sea') is distinct from 'X' then
    raise exception 'titulo_texto no está devolviendo lo que debe';
  end if;
end $$;
