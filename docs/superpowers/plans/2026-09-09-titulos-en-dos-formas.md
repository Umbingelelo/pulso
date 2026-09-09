# Los títulos en dos formas · plan de implementación

> **Para quien lo ejecute:** los pasos van con casilla (`- [ ]`) para ir marcando. Se
> ejecuta tarea por tarea, y cada tarea termina con algo probado y committeado.

**Meta:** que un título de perfil se muestre en masculino o femenino según la preferencia
de **quien lo lleva puesto**, y que el docente pueda escribir la forma femenina de cada
título en un archivo.

**Arquitectura:** una columna `cosmeticos.valor_femenino` (nula = el título ya sirve para
todos), una preferencia `perfiles.forma_titulo` con omisión `'masculino'`, y una función
`titulo_texto(valor, valor_femenino, forma)` que llaman los cinco lugares donde un título
se junta con una persona. La forma se resuelve en la base y no en el navegador, porque en
la tabla de posiciones cada fila lleva la forma de **otra** persona.

**Herramientas:** Postgres (Neon) con migraciones en `neon/migrations/`, Data API
(PostgREST) para el navegador, Angular con señales, pruebas en `node` contra la base y en
Puppeteer contra el sitio.

**Spec:** `docs/superpowers/specs/2026-09-09-titulos-en-dos-formas-design.md`

## Restricciones globales

- **Los cinco sitios** que resuelven un título son, verificados contra el catálogo:
  `mis_ramos` (vista), `tabla_posiciones(uuid,int)`, `mis_cosmeticos(uuid)`,
  `mi_pase(uuid)` y `gacha_tirar(uuid,text)`. Si uno queda sin resolver, el texto de esa
  pantalla queda en desacuerdo con el resto.
- **La forma sigue al portador, no al que mira.** En `tabla_posiciones` cada fila se
  resuelve con el `forma_titulo` del perfil **de esa fila**.
- **`valor_femenino` nulo cae en masculino**, nunca en nulo ni en vacío.
- **La omisión de `forma_titulo` es `'masculino'`**, que es exactamente lo que hay hoy: la
  migración no le cambia el texto a nadie.
- **`create or replace view` solo acepta columnas nuevas al final.** En medio falla con
  «cannot change name of view column».
- **Cambiar la forma que devuelve una función obliga a `drop function`, y eso se lleva sus
  grants.** Reponerlos no es opcional: sin eso la pantalla deja de cargar en cuanto se
  aplica la migración.
- **`pulso_app` no puede escribir `perfiles`** salvo por columna: la 0024 hizo `revoke
  update` y dejó solo `grant update (nombre)`. Hay que agregar `forma_titulo` **sin abrir
  `avatar`**.
- **La caché de esquema de la Data API no se refresca con `refrescar-api.mjs`.** Se rehace
  sola tras unos minutos con la base en silencio; sondearla mantiene el compute despierto y
  lo impide. Aplicar la migración **antes** de desplegar, y que ninguno de los dos pasos
  deje el sitio caído.
- **Migración única:** `neon/migrations/0037_titulos_en_dos_formas.sql`. Una sola ventana de
  caché en vez de dos.

---

### Tarea 1: El esquema, la función y los cinco sitios

**Archivos:**
- Crear: `neon/migrations/0037_titulos_en_dos_formas.sql`
- Modificar: `neon/probar-gacha.mjs` (agregar la sección de formas antes de «Dejarlo como estaba»)

**Interfaces:**
- Produce: `public.titulo_texto(text, text, text) → text`;
  `public.cosmeticos.valor_femenino text`; `public.perfiles.forma_titulo text not null`;
  `mis_ramos.titulo_id uuid`; `tabla_posiciones(...)` con `titulo_id uuid` como **novena**
  columna del `returns table`.

- [x] **Paso 1: Escribir la prueba que falla**

En `neon/probar-gacha.mjs`, justo antes del comentario `// ---------- Dejarlo como estaba ----------`:

```js
// ---------- Los títulos en dos formas ----------
//
// Lo que se vigila es la **coherencia entre los cinco sitios**. Cada uno por separado
// puede estar bien y el conjunto estar roto: eso es lo que rompía el pase, que averigua
// el título puesto comparando el texto de `tabla_posiciones` contra el de `mi_pase`.

console.log('\nLos títulos en dos formas');

const [conForma] = await d`
  select c.id, c.valor, c.valor_femenino from public.cosmeticos c
   where c.tipo = 'titulo' and c.activo and c.valor_femenino is not null limit 1`;
rev('hay al menos un título con forma femenina escrita', Boolean(conForma),
  'sin eso esta sección no prueba nada');

const [sinForma] = await d`
  select c.id, c.valor from public.cosmeticos c
   where c.tipo = 'titulo' and c.activo and c.valor_femenino is null limit 1`;

// `titulo_texto` es la regla, y tiene que ser total: nunca nulo, nunca vacío.
const [reglas] = await d`
  select public.titulo_texto('El Elegido', 'La Elegida', 'masculino') as m,
         public.titulo_texto('El Elegido', 'La Elegida', 'femenino')  as f,
         public.titulo_texto('Constante',  null,         'femenino')  as nula,
         public.titulo_texto('Constante',  null,         'otra')      as rara`;
rev('en masculino devuelve el valor', reglas.m === 'El Elegido', reglas.m);
rev('en femenino devuelve la forma femenina', reglas.f === 'La Elegida', reglas.f);
rev('sin forma femenina cae en masculino', reglas.nula === 'Constante', reglas.nula);
rev('una forma que no existe cae en masculino y no en nulo',
  reglas.rara === 'Constante', String(reglas.rara));

// El check no deja escribir cualquier cosa.
try {
  await d`update public.perfiles set forma_titulo = 'otra' where id = ${alumno.id}`;
  rev('el check rechaza una forma inválida', false, 'la base lo aceptó');
} catch (e) {
  rev('el check rechaza una forma inválida',
    (e.message ?? '').includes('perfiles_forma_titulo_check'), e.message);
}

// El grant por columna: se abre `forma_titulo` y **no** se reabre `avatar`.
const [permisos2] = await d`
  select bool_or(privilege_type = 'UPDATE' and column_name = 'forma_titulo') as puede_forma,
         bool_or(privilege_type = 'UPDATE' and column_name = 'avatar')       as puede_avatar
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'perfiles' and grantee = 'pulso_app'`;
rev('pulso_app puede escribir forma_titulo', permisos2.puede_forma === true);
rev('y sigue sin poder escribir avatar', permisos2.puede_avatar !== true);

// ── La coherencia entre los cinco sitios ──
//
// Se le pone un título con forma femenina, se cambia la preferencia, y los cinco tienen
// que decir lo mismo. La cuenta de prueba está oculta del ranking a propósito, así que
// para que salga en su propia tabla hay que mostrarla y volver a ocultarla.
const formaOriginal = (await d`select forma_titulo from public.perfiles where id = ${alumno.id}`)[0].forma_titulo;
const tituloOriginal = (await d`select titulo_id from public.matriculas where id = ${m.id}`)[0].titulo_id;
const [ocultoOriginal] = await d`select oculto_en_ranking from public.perfiles where id = ${alumno.id}`;

// `try/finally` y no restaurar al final del bloque: esta sección da vuelta dos flags del
// perfil —la forma y `oculto_en_ranking`— y si algo revienta en medio, la cuenta de prueba
// queda visible en el ranking y con los títulos en femenino. Eso el `barrer()` no lo
// recoge, porque no hay forma de saber después cuál era el valor original.
try {
if (conForma) {
  await d`update public.perfiles set oculto_en_ranking = false where id = ${alumno.id}`;
  // Se le regala el cosmético para poder equiparlo, y se anota para sacarlo después.
  await d`insert into public.alumno_cosmeticos (matricula_id, cosmetico_id, origen)
          values (${m.id}, ${conForma.id}, 'gacha')
          on conflict (matricula_id, cosmetico_id) do nothing`;
  await d`update public.matriculas set titulo_id = ${conForma.id} where id = ${m.id}`;

  for (const forma of ['masculino', 'femenino']) {
    await d`update public.perfiles set forma_titulo = ${forma} where id = ${alumno.id}`;
    const esperado = forma === 'femenino' ? conForma.valor_femenino : conForma.valor;

    const [ramo] = await como(alumno.id, (s) =>
      s`select titulo, titulo_id from public.mis_ramos where matricula_id = ${m.id}`);
    const [pos] = await como(alumno.id, (s) =>
      s`select titulo, titulo_id from public.tabla_posiciones(${m.id}::uuid, 200) where soy_yo`);
    const [cos] = await como(alumno.id, (s) =>
      s`select valor from public.mis_cosmeticos(${m.id}::uuid) where id = ${conForma.id}`);
    const [{ p: pase }] = await como(alumno.id, (s) =>
      s`select public.mi_pase(${m.id}::uuid) as p`);
    const delPase = (pase?.recompensas ?? [])
      .find((r) => r.cosmetico && r.cosmetico.id === conForma.id)?.cosmetico?.valor ?? null;

    rev(`${forma}: mis_ramos dice «${ramo?.titulo}»`, ramo?.titulo === esperado, `esperaba «${esperado}»`);
    rev(`${forma}: tabla_posiciones dice «${pos?.titulo}»`, pos?.titulo === esperado, `esperaba «${esperado}»`);
    rev(`${forma}: mis_cosmeticos dice «${cos?.valor}»`, cos?.valor === esperado, `esperaba «${esperado}»`);
    if (delPase !== null) {
      rev(`${forma}: mi_pase dice «${delPase}»`, delPase === esperado, `esperaba «${esperado}»`);
    }
    // El id es lo que el pase compara desde ahora, y no puede depender de la forma.
    rev(`${forma}: mis_ramos y tabla_posiciones traen el mismo titulo_id`,
      ramo?.titulo_id === conForma.id && pos?.titulo_id === conForma.id,
      `${ramo?.titulo_id} vs ${pos?.titulo_id}`);
  }

  // La forma sigue al portador: en la misma respuesta tienen que convivir las dos.
  await d`update public.perfiles set forma_titulo = 'femenino' where id = ${alumno.id}`;
  const filas = await como(alumno.id, (s) =>
    s`select soy_yo, titulo from public.tabla_posiciones(${m.id}::uuid, 200) where titulo is not null`);
  const mia = filas.find((f) => f.soy_yo);
  const ajenas = filas.filter((f) => !f.soy_yo);
  rev('mi fila sale en femenino', mia?.titulo === conForma.valor_femenino, `dice «${mia?.titulo}»`);
  if (ajenas.length) {
    const enFemenino = await d`
      select count(*)::int as n from public.cosmeticos
       where valor_femenino = any(${ajenas.map((a) => a.titulo)}::text[])`;
    rev('las filas de mis compañeros no salen en femenino', enFemenino[0].n === 0,
      `${enFemenino[0].n} de ${ajenas.length} filas ajenas salieron con forma femenina`);
  } else {
    console.log('  · su sección no tiene compañeros con título puesto: ese caso no se midió');
  }
}

// Un título sin forma femenina se ve igual con las dos.
if (sinForma) {
  const dice = {};
  for (const forma of ['masculino', 'femenino']) {
    await d`update public.perfiles set forma_titulo = ${forma} where id = ${alumno.id}`;
    const [cos] = await como(alumno.id, (s) =>
      s`select valor from public.mis_cosmeticos(${m.id}::uuid) where id = ${sinForma.id}`);
    dice[forma] = cos?.valor;
  }
  rev('un título sin forma femenina se ve igual con las dos',
    dice.masculino === sinForma.valor && dice.femenino === sinForma.valor,
    `masculino «${dice.masculino}», femenino «${dice.femenino}»`);
}

} finally {
  // Dejarlo como estaba, pase lo que pase.
  await d`update public.perfiles set forma_titulo = ${formaOriginal} where id = ${alumno.id}`;
  await d`update public.perfiles set oculto_en_ranking = ${ocultoOriginal.oculto_en_ranking}
           where id = ${alumno.id}`;
  await d`update public.matriculas set titulo_id = ${tituloOriginal} where id = ${m.id}`;
}
```

- [x] **Paso 2: Correrla y ver que falla**

```bash
set -a; . ./.env.local; set +a
node neon/probar-gacha.mjs --tiradas 60
```

Esperado: revienta con `column c.valor_femenino does not exist`.

- [x] **Paso 3: Escribir la migración**

Crear `neon/migrations/0037_titulos_en_dos_formas.sql` con, en este orden:

```sql
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
-- complemento** («La Compañera de Todos»). Así que la escribe una persona.
--
-- ── La forma sigue a quien lleva el título, no a quien mira ──
--
-- Es la restricción que ordena todo lo de abajo. En la tabla de posiciones veo el título
-- de una compañera y ahí tiene que leerse en **su** forma. Por eso no se puede resolver en
-- el navegador con una preferencia local, y por eso cada uno de los cinco sitios resuelve
-- con el perfil de **quien lleva el título** y no con el de quien consulta.
--
-- ── Nulo es «este título ya sirve para todos» ──
--
-- Cubre los 52 que ya son neutros, y es la degradación elegante: un título con género cuya
-- forma femenina todavía no está escrita se muestra en masculino. Eso es lo que permite
-- desplegar el mecanismo antes de tener el archivo completo, en vez de que sea todo o nada.

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
  'Cómo se escriben los títulos de esta persona. Es una preferencia de redacción, no su '
  'género: no se le pregunta quién es, se le pregunta cómo quiere que se lea su título.';

-- La 0024 revocó el `update` sobre `perfiles` y dejó solo `nombre`, para cerrar la
-- escritura directa de `avatar` donde no se puede rodear. Se abre una columna más, y
-- **solo una**: `avatar` sigue cerrado.
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

-- ============================== Sitio 1 de 5: mis_ramos ==============================
--
-- Se une `perfiles` —seguro: `matriculas.perfil_id` es `not null`— y se agrega `titulo_id`
-- **al final**, porque `create or replace view` solo acepta columnas nuevas ahí: en medio
-- falla con «cannot change name of view column».

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
```

Y en el mismo archivo, las cuatro funciones. `tabla_posiciones` cambia la forma que
devuelve, así que va con `drop` y **con su grant repuesto**:

```sql
-- ============================== Sitio 2 de 5: tabla_posiciones ==============================
--
-- Cada fila se resuelve con el `forma_titulo` de **su** perfil, que es lo que hace que en
-- una misma respuesta convivan las dos formas. Y devuelve `titulo_id`, que es lo que el
-- pase va a comparar en vez del texto.
--
-- Cambia la forma que devuelve, así que hay que borrarla y recrearla. Borrar una función
-- se lleva sus grants: reponerlo no es opcional, sin eso el ranking deja de cargar.

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
```

```sql
-- ============================== Sitio 3 de 5: mis_cosmeticos ==============================
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
         exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id),
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
```

```sql
-- ============================== Sitio 4 de 5: mi_pase ==============================
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
    'xp_nivel',      v_xp - v_desde,
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
```

```sql
-- ============================== Sitio 5 de 5: gacha_tirar ==============================
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

grant execute on function public.titulo_texto(text, text, text) to pulso_app;
```

Y al final, la comprobación en la misma transacción:

```sql
-- ============================== Comprobación, en la misma transacción ==============================

do $$
declare v_grants integer; v_cols integer;
begin
  -- El grant de `avatar` no puede haberse reabierto de rebote.
  select count(*) into v_grants
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'perfiles' and grantee = 'pulso_app'
     and privilege_type = 'UPDATE' and column_name = 'avatar';
  if v_grants > 0 then
    raise exception 'Se reabrió el update sobre perfiles.avatar, que la 0024 cerró';
  end if;

  -- Y `tabla_posiciones` tiene que haber quedado con su grant repuesto.
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
end $$;
```

- [x] **Paso 4: Aplicarla y avisar a la Data API**

```bash
set -a; . ./.env.local; set +a
psql "$DATABASE_URL_OWNER" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f neon/migrations/0037_titulos_en_dos_formas.sql
node neon/refrescar-api.mjs
```

Esperado: `ALTER TABLE`, `CREATE FUNCTION`, `CREATE VIEW`, `GRANT`, `DO`, sin errores.

- [x] **Paso 5: Escribir una forma femenina a mano y correr la prueba**

Sin al menos una escrita, la sección no mide nada (su primer `rev` lo dice). Se escribe una
sola, provisoria, para cerrar esta tarea; el archivo completo es la Tarea 2.

```bash
psql "$DATABASE_URL_OWNER" -X -c \
  "update public.cosmeticos set valor_femenino = 'La Elegida del Algoritmo' where codigo = 'titulo-012';"
node neon/probar-gacha.mjs --tiradas 60
```

Esperado: todo en verde, incluidas las comprobaciones nuevas de los cinco sitios.

- [x] **Paso 6: Commit**

```bash
git add neon/migrations/0037_titulos_en_dos_formas.sql neon/probar-gacha.mjs
git commit
```

Mensaje: `Los títulos se pueden leer en femenino`, con cuerpo explicando que la forma sigue
al portador, los cinco sitios, y que `tabla_posiciones` se recreó reponiendo el grant.

---

### Tarea 2: El archivo de formas femeninas y el subidor

**Archivos:**
- Crear: `neon/titulos-femenino.txt`
- Modificar: `neon/subir-cosmeticos.mjs`

**Interfaces:**
- Consume: `public.cosmeticos.valor_femenino` (Tarea 1).
- Produce: bandera `--titulos-f <archivo>` en `subir-cosmeticos.mjs`.

**Desviación del spec, a propósito:** el spec decía «referidas por el mismo número». No
sirve: ocho títulos tienen código de palabra (`titulo-madrugador`, `titulo-veterano`,
`titulo-recien-llegado`, `titulo-de-los-que-leen`…) y **cuatro de esos necesitan forma
femenina**. Un formato de solo números los habría dejado fuera en silencio. Se usa el
código.

**Formato del archivo:** una línea por título, `<codigo> — <forma femenina>`. El separador es
raya larga y no guion porque los códigos llevan guion (`titulo-001`). Las líneas vacías y
las que empiezan con `#` se ignoran. Solo van los títulos que **cambian**.

Se usa el código y no el número porque ocho títulos tienen código de palabra
(`titulo-madrugador`, `titulo-veterano`…) y cuatro de esos necesitan forma femenina: un
formato que solo aceptara números los dejaría fuera.

- [x] **Paso 1: Escribir el archivo**

Crear `neon/titulos-femenino.txt` con las 56 formas (contenido completo en el apéndice de
este plan).

- [x] **Paso 2: Escribir la prueba que falla**

Al final de la sección «Los títulos en dos formas» de `neon/probar-gacha.mjs`:

```js
// El archivo y la base tienen que decir lo mismo, y ningún código puede sobrar.
const conFemenino = await d`
  select count(*)::int as n from public.cosmeticos
   where tipo = 'titulo' and activo and valor_femenino is not null`;
rev('los títulos con forma femenina están cargados', conFemenino[0].n >= 50,
  `hay ${conFemenino[0].n}, esperaba al menos 50`);

// Aviso y no fallo: el mecanismo tiene que poder desplegarse con el archivo a medias.
const [pendientes] = await d`
  select count(*)::int as n from public.cosmeticos
   where tipo = 'titulo' and activo and valor_femenino is null
     and (valor ~ '^(El|Los) ' or valor ~* '(dor|ero|ista|ano|ino|oso)$')`;
if (pendientes.n > 0) {
  console.log(`  · ${pendientes.n} títulos con pinta de tener género siguen sin forma femenina`);
}
```

- [x] **Paso 3: Correrla y ver que falla**

```bash
node neon/probar-gacha.mjs --tiradas 60
```

Esperado: `✗ los títulos con forma femenina están cargados: hay 1, esperaba al menos 50`.

- [x] **Paso 4: Agregar la bandera al subidor**

En `neon/subir-cosmeticos.mjs`, después del bloque que parsea `--titulos` y antes del de
`--avatares`:

```js
// ============================== Las formas femeninas ==============================
//
// Archivo aparte y no una columna más en el archivo de títulos, por dos razones. La
// primera es que el docente no tiene que re-editar 108 líneas para agregar 56. La segunda
// es concreta: ya hay un título con barra —«Locked In 24/7»— y otros con comillas y con
// porcentajes, así que cualquier separador puesto en la misma línea es una trampa
// esperando a que alguien escriba el título que la pisa.
//
// Se refiere por **código** y no por número porque ocho títulos tienen código de palabra
// —`titulo-madrugador`, `titulo-veterano`— y cuatro de esos necesitan forma femenina.

const femeninos = new Map();
if (args['titulos-f']) {
  const texto = await readFile(args['titulos-f'], 'utf8');
  let n = 0;
  for (const linea of texto.split('\n')) {
    n++;
    const cruda = linea.trim();
    if (!cruda || cruda.startsWith('#')) continue;
    const mm = cruda.match(/^(\S+)\s*—\s*(.+?)\s*$/);
    if (!mm) {
      problemas.push(`formas femeninas, línea ${n}: no entendí «${cruda}»`);
      continue;
    }
    const [, codigo, femenino] = mm;
    if (femeninos.has(codigo)) {
      problemas.push(`formas femeninas, línea ${n}: «${codigo}» aparece dos veces`);
      continue;
    }
    femeninos.set(codigo, femenino);
  }
  console.log(`Formas fem. ${femeninos.size} leídas de ${args['titulos-f']}`);
}
```

Y donde se arma cada cosmético de título, se le cuelga la forma. Reemplazar el
`cosmeticos.push({...})` del bloque de títulos por:

```js
    cosmeticos.push({
      codigo: `titulo-${numero}`,
      tipo: 'titulo',
      nombre,
      descripcion: null,
      // El valor de un título **es** su texto: es lo que se dibuja bajo el nombre.
      valor: nombre,
      rareza,
    });
```

(sin cambios: la forma femenina se resuelve más abajo, contra la base, porque hay títulos
con código de palabra que no salen de este archivo.)

Y **antes** del bucle de escritura, la comprobación de que ningún código sobra:

```js
// Un código que no exista es un error y no un aviso: significa que el docente escribió una
// forma femenina para un título que no está, y dejarlo pasar la perdería en silencio. Es el
// mismo criterio que ya se usa con las rarezas desconocidas.
if (femeninos.size) {
  const existentes = new Set((await sql`
    select codigo from public.cosmeticos where tipo = 'titulo'`).map((r) => r.codigo));
  for (const codigo of femeninos.keys()) {
    if (!existentes.has(codigo)) {
      problemas.push(`formas femeninas: «${codigo}» no corresponde a ningún título`);
    }
  }
  if (problemas.length) {
    console.error('\nProblemas:');
    for (const p of problemas) console.error(`  ${p}`);
    process.exit(1);
  }
}
```

Y después del bucle de escritura de cosméticos, el `update` de las formas:

```js
// Se escriben por código y contra la base, no contra `cosmeticos`: así también alcanza a
// los ocho títulos con código de palabra, que no salen del archivo de títulos.
if (femeninos.size) {
  let escritas = 0;
  for (const [codigo, femenino] of femeninos) {
    const r = await sql`
      update public.cosmeticos set valor_femenino = ${femenino}
       where codigo = ${codigo} and coalesce(valor_femenino, '') <> ${femenino}
      returning codigo`;
    escritas += r.length;
  }
  console.log(`Formas fem. ${escritas} escritas · ${femeninos.size - escritas} ya estaban`);
}
```

- [x] **Paso 5: Correr el subidor en seco y después escribiendo**

```bash
node neon/subir-cosmeticos.mjs --titulos ~/Downloads/titulos_perfil_rareza.txt \
  --titulos-f neon/titulos-femenino.txt
node neon/subir-cosmeticos.mjs --titulos ~/Downloads/titulos_perfil_rareza.txt \
  --titulos-f neon/titulos-femenino.txt --escribir
```

Esperado: `Formas fem. 56 leídas`, y en la segunda corrida `56 escritas`. Correrlo una
tercera vez tiene que decir `0 escritas · 56 ya estaban`.

- [x] **Paso 6: Correr la prueba**

```bash
node neon/probar-gacha.mjs --tiradas 60
```

Esperado: todo en verde.

- [x] **Paso 7: Commit**

```bash
git add neon/titulos-femenino.txt neon/subir-cosmeticos.mjs neon/probar-gacha.mjs
git commit
```

---

### Tarea 3: El frontend

**Archivos:**
- Modificar: `src/app/datos.service.ts` (tipos `Ramo`, `Posicion`, `Perfil`; `miPerfil`; método nuevo)
- Modificar: `src/app/perfil.component.ts` (el control)
- Modificar: `src/app/pase.component.ts:289-291` (comparar por id)
- Modificar: `src/app/perfil.store.ts` si hace falta exponer la forma

**Interfaces:**
- Consume: `mis_ramos.titulo_id`, `tabla_posiciones(...).titulo_id`,
  `perfiles.forma_titulo` (Tarea 1).
- Produce: `DatosService.cambiarFormaTitulo(forma: FormaTitulo): Promise<void>`;
  `export type FormaTitulo = 'masculino' | 'femenino'`.

- [x] **Paso 1: Los tipos y el método**

En `src/app/datos.service.ts`, junto a `export interface Perfil`:

```ts
/**
 * Cómo se escriben los títulos de una persona.
 *
 * Es una preferencia de **redacción y no de identidad**: no se le pregunta quién es, se le
 * pregunta cómo quiere que se lea su título. Inferirlo del nombre sería misgendering
 * garantizado en un curso de cuarenta.
 */
export type FormaTitulo = 'masculino' | 'femenino';
```

Agregar `forma_titulo: FormaTitulo;` a `Perfil`, y a la consulta de `miPerfil`:

```ts
      .select('id, nombre, avatar, creado_en, forma_titulo')
```

Agregar a `Ramo`:

```ts
  /**
   * El id del título puesto. El texto de `titulo` cambia con la forma, así que comparar
   * por texto para saber cuál lleva puesto se rompe en cuanto alguien elige femenino.
   */
  titulo_id: string | null;
```

Y lo mismo a `Posicion`:

```ts
  titulo_id: string | null;
```

El método, junto a `equiparCosmetico`:

```ts
  /**
   * Cambia cómo se escriben sus títulos.
   *
   * Escribe la columna directo por la Data API y no por una función: `perfiles` tiene el
   * `update` cerrado y abierto **por columna** —`nombre` y `forma_titulo`—, así que el
   * permiso ya es el control. No hace falta un `security definer` para eso.
   */
  async cambiarFormaTitulo(forma: FormaTitulo): Promise<void> {
    const u = this.usuario();
    if (!u) throw new Error('No hay sesión');
    const { error } = await this.db
      .from('perfiles')
      .update({ forma_titulo: forma })
      .eq('id', u.id);
    if (error) throw error;
  }
```

- [x] **Paso 2: Arreglar el pase, que compara por texto**

`src/app/pase.component.ts`, reemplazar:

```ts
      const mio = this.tabla().find(x => x.soy_yo)?.titulo ?? null;
      this.tituloPuesto.set(
        mio ? (p?.recompensas.find(r => r.cosmetico?.valor === mio)?.cosmetico?.id ?? null) : null);
```

por:

```ts
      // Por id y no por texto. Comparar `tabla_posiciones().titulo` contra
      // `mi_pase().recompensas[].cosmetico.valor` calzaba por casualidad: son dos sitios
      // distintos que devolvían la misma cadena. Con los títulos en dos formas, cualquier
      // desacuerdo entre ellos dejaba al pase sin marcar «Puesto» —sin error en ninguna
      // parte, solo la escalera viéndose como si no llevara nada—.
      this.tituloPuesto.set(this.tabla().find(x => x.soy_yo)?.titulo_id ?? null);
```

- [x] **Paso 3: El control en «Mi perfil»**

En `src/app/perfil.component.ts`, dentro de la tarjeta «Cómo te ven», después del `<div>`
que cierra el bloque del nombre y antes de cerrar la tarjeta:

```html
        <!-- La pregunta es sobre **los títulos y no sobre la persona**: no se le pide su
             género ni se infiere del nombre, que en un curso es misgendering garantizado y
             además un dato que el sistema no necesita para nada más. El ejemplo en vivo es
             lo que hace la opción evidente sin tener que explicarla. -->
        <div class="forma-titulo">
          <p class="etiqueta">Cómo se escriben tus títulos</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            @for (f of formas; track f.id) {
              <button type="button" class="boton chico"
                      [class.contorno]="forma() !== f.id"
                      [disabled]="guardandoForma()"
                      (click)="cambiarForma(f.id)">{{ f.nombre }}</button>
            }
          </div>
          @if (ejemplo(); as e) {
            <p class="chico suave" style="margin-top:8px">Así se te vería: «{{ e }}»</p>
          }
          <p class="chico suave" style="margin-top:6px">
            Es solo cómo se escribe el texto. No cambia lo que ganaste ni lo que puedes ganar.
          </p>
        </div>
```

En la clase:

```ts
  protected readonly formas: { id: FormaTitulo; nombre: string }[] = [
    { id: 'masculino', nombre: 'En masculino' },
    { id: 'femenino', nombre: 'En femenino' },
  ];

  guardandoForma = signal(false);

  forma = computed<FormaTitulo>(() => this.perfil.perfil()?.forma_titulo ?? 'masculino');

  /**
   * El ejemplo sale del título que lleva puesto, y si no lleva ninguno, del primero que
   * tenga forma femenina escrita. Sin caso concreto la opción es abstracta y nadie sabe
   * qué está eligiendo.
   */
  ejemplo = computed(() => {
    const puesto = this.perfil.ramo()?.titulo;
    if (puesto) return puesto;
    return this.conFormaFemenina()?.valor ?? null;
  });

  private conFormaFemenina = signal<Cosmetico | null>(null);

  async cambiarForma(f: FormaTitulo): Promise<void> {
    if (this.guardandoForma() || this.forma() === f) return;
    this.guardandoForma.set(true);
    this.mensaje.set(''); this.error.set('');
    try {
      await this.datos.cambiarFormaTitulo(f);
      // El perfil y los ramos traen el texto ya resuelto por la base, así que hay que
      // recargarlos para que el encabezado y el ejemplo cambien.
      await this.perfil.cargar(true);
      await this.cargar();
      this.mensaje.set(f === 'femenino'
        ? 'Tus títulos se escribirán en femenino'
        : 'Tus títulos se escribirán en masculino');
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cambiar.');
    } finally {
      this.guardandoForma.set(false);
    }
  }
```

Y en `cargar()`, después de setear `mias`, guardar un título de ejemplo:

```ts
      this.conFormaFemenina.set(
        todos.find(c => c.tipo === 'titulo' && c.tengo)
        ?? todos.find(c => c.tipo === 'titulo')
        ?? null);
```

Importar `FormaTitulo` desde `./datos.service` y `computed` desde `@angular/core` si no
están.

- [x] **Paso 4: Compilar**

```bash
npx ng build
```

Esperado: `Application bundle generation complete`, sin errores de TypeScript.

- [x] **Paso 5: Verlo en el navegador local contra la base de producción**

```bash
cat > /tmp/pulso-proxy.json <<'EOF'
{ "/api": { "target": "https://pulso-rust.vercel.app", "changeOrigin": true, "secure": true },
  "/db":  { "target": "https://pulso-rust.vercel.app", "changeOrigin": true, "secure": true } }
EOF
npx ng serve --port 4321 --proxy-config /tmp/pulso-proxy.json
```

Entrar con `alumno.prueba@duocuc.cl` / `pulso-prueba-2026`, ir a «Mi perfil», apretar «En
femenino», y comprobar que el título del encabezado y el de la tarjeta cambian.

- [x] **Paso 6: Commit**

```bash
git add src/app/datos.service.ts src/app/perfil.component.ts src/app/pase.component.ts
git commit
```

---

### Tarea 4: La prueba de navegador

**Archivos:**
- Crear: `neon/probar-titulos-navegador.mjs`

**Interfaces:**
- Consume: todo lo anterior. Acepta `BASE` como las otras pruebas de navegador.

- [x] **Paso 1: Escribir la prueba**

Crear `neon/probar-titulos-navegador.mjs`, con la misma forma que
`neon/probar-pase-navegador.mjs`: busca Chrome, entra con la cuenta de prueba, y **deja el
estado como estaba** (la forma, el título puesto y `oculto_en_ranking`).

**El arnés se copia de `neon/probar-pase-navegador.mjs`**: busca Chrome en las tres rutas
habituales, `puppeteer-core` con `userDataDir` temporal, entra por `/ingresar` con
`input[type=email]` / `input[type=password]`, y acepta `BASE` del entorno.

**Selectores concretos**, verificados contra las plantillas:

| Qué | Selector |
|---|---|
| El título en «Mi perfil» | `.cara-con-titulo .titulo-cara` |
| Los botones de forma | `.forma-titulo .boton` (índice 0 masculino, 1 femenino) |
| El ejemplo en vivo | `.forma-titulo .chico.suave` |
| El título en el encabezado | el que `perfil.store` pinta desde `ramo().titulo` |
| «Puesto» en el pase | el botón de la recompensa del título, que dice `Puesto` |
| La colección del gacha | `.pieza .chapa` |

Lo que comprueba, en este orden:

1. En «Mi perfil», apretar «En femenino» cambia el título de la tarjeta al texto femenino.
2. El encabezado de la aplicación muestra el mismo texto.
3. En `/pase`, la recompensa del título puesto sigue marcada **«Puesto»** — que es la
   regresión que este cambio previene.
4. En `/gacha`, la colección muestra el título en femenino.
5. Volver a «En masculino» y comprobar que los cuatro lugares vuelven.

```js
/**
 * Los títulos en dos formas, en un navegador real.
 *
 * Lo que solo se ve ejecutando es que los cuatro lugares donde el alumno lee su título
 * —encabezado, perfil, pase y colección— digan **lo mismo** después de cambiar la
 * preferencia. Y sobre todo que el pase siga marcando «Puesto»: antes lo averiguaba
 * comparando texto entre dos funciones, así que la forma femenina lo habría dejado
 * viéndose como si no llevara nada, sin error en ninguna parte.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-titulos-navegador.mjs [BASE=http://localhost:4321]
 */
```

- [x] **Paso 2: Correrla contra el sitio local y ver que pasa**

```bash
BASE=http://localhost:4321 node neon/probar-titulos-navegador.mjs
```

- [x] **Paso 3: Commit**

```bash
git add neon/probar-titulos-navegador.mjs
git commit
```

---

### Tarea 5: A producción

- [x] **Paso 1: Correr todo lo que hay**

```bash
set -a; . ./.env.local; set +a
npx ng build
node neon/probar-gacha.mjs --tiradas 600
```

- [x] **Paso 2: Empujar**

```bash
git push origin main
```

La migración ya está aplicada desde la Tarea 1, y `titulo_id` entró **al final** tanto en
la vista como en el `returns table`, así que el sitio publicado —que no lee esas
columnas— siguió sirviendo durante toda la ventana.

- [x] **Paso 3: Comprobar en producción**

Esperar a que el despliegue quede `Ready` y correr la prueba de navegador contra
`https://pulso-rust.vercel.app`. Si el RPC responde `PGRST202`, es la caché de esquema:
**no** correr `refrescar-api.mjs` en bucle, dejar la base en silencio unos minutos.

---

## Apéndice: `neon/titulos-femenino.txt`

```
# Las formas femeninas de los títulos de perfil. Una línea por título:
#
#   <codigo> — <forma femenina>
#
# El separador es raya larga y no guion, porque los códigos llevan guion.
# Solo van los títulos que cambian: los que ya sirven para todos no se listan, y la base
# los deja en nulo, que significa «este título ya sirve para todos».
#
# Varias son decisión de voz y no de gramática —«La Dama de la Mesa» contra «La Reina de la
# Mesa»— y esas las decide el docente. Corrige acá y vuelve a correr:
#
#   node neon/subir-cosmeticos.mjs --titulos <archivo> --titulos-f neon/titulos-femenino.txt --escribir

titulo-001 — La Diosa del Six Seven
titulo-002 — Farmeadora de Aura
titulo-005 — La GOAT del Grupo
titulo-010 — Ministra del Aura
titulo-012 — La Elegida del Algoritmo
titulo-014 — NPC Legendaria
titulo-017 — Dueña del Lore
titulo-023 — La que está Locked In
titulo-025 — Déjenla Cocinar
titulo-026 — La que Siempre Está Cooking
titulo-036 — Basada de Nacimiento
titulo-038 — Lowkey Legendaria
titulo-041 — La Más Via del Server
titulo-042 — La Más Via del Carrete
titulo-043 — La Última en Irse
titulo-044 — La Primera en Apañar
titulo-045 — La que Apaña a Todos
titulo-046 — Reina del Carrete
titulo-047 — Patrona del After
titulo-048 — Ministra del Vacile
titulo-049 — Subsecretaria del Carrete
titulo-050 — Presidenta del Webeo
titulo-052 — Ingeniera en Sacar la Vuelta
titulo-057 — La Reina del Dato
titulo-058 — La que Siempre Tiene un Dato
titulo-060 — La que Conoce a un Weón
titulo-061 — La que Tiene un Amigo que Sabe
titulo-062 — La que Nunca Anda Pato
titulo-063 — La Última Romántica del Carrete
titulo-064 — La Dueña de la Previa
titulo-067 — La que Prende el Carrete
titulo-068 — La que Llegó por un Ratito
titulo-069 — La “Una y Me Voy”
titulo-070 — La “Ya, la Última”
titulo-073 — Directora de Asuntos Random
titulo-074 — Presidenta de Nada
titulo-075 — Ministra Sin Cartera
titulo-076 — Embajadora del Desorden
titulo-077 — Experta en Nada, Opinóloga en Todo
titulo-078 — La que Tiene Más Lore
titulo-080 — Generadora de Contenido Involuntario
titulo-083 — Villana de una Historia Mal Contada
titulo-084 — Heroína por Accidente
titulo-085 — Leyenda Según Ella
titulo-092 — La Incondicional
titulo-093 — La que Siempre Apaña
titulo-094 — La Buena Onda
titulo-095 — La Dama de la Mesa
titulo-096 — La Compañera de Todos
titulo-097 — La que Nunca Falla
titulo-098 — La Mujer del Momento
titulo-100 — La Favorita del Público
titulo-de-los-que-leen — De las que sí leen
titulo-madrugador — Madrugadora
titulo-recien-llegado — Recién llegada
titulo-veterano — Veterana del pase
```

**Los que quedan sin forma a propósito**, y por qué, para que nadie los «arregle» después:

- **El sustantivo prestado es masculino, no la persona:** «El Plot Twist», «El Arco de
  Redención», «El Facto del Día», «El Dato Calado», «El Contacto del Contacto», «El Lore
  Viviente», «Personaje Canónico», «Evento Canónico», «Rizz Infinito».
- **«El alma» lleva artículo masculino por fonética y el sustantivo ya es femenino:** «El
  Alma del Grupo», «El Alma del After».
- **Invariables:** «CEO del Aura», «Gerente de Malas Decisiones», «Protagonista sin
  Presupuesto», «Magíster en Cahuín», «Highkey GOAT», «Main Character», «No Cap».
- **Ya neutros o ya femeninos:** «Aura Infinita», «La Leyenda del Grupo», «Constante»,
  «Imparable», «Sin faltar una», «Leyenda del semestre», «Doctorado en Rizz», «Doctorado
  en Webeo».
