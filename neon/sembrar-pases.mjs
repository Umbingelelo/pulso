/**
 * Siembra los tres pases y un catálogo inicial de cosméticos.
 *
 * Las fechas salen de las evaluaciones de cada asignatura, que están en la
 * planificación del semestre. Se pueden mover después: son columnas, no código.
 *
 * ── Sobre los títulos ──
 *
 * Los de acá son **de relleno**, escritos para que el sistema tenga algo que
 * entregar el primer día. Los buenos los escribe el docente: la temática es
 * cultura pop juvenil chilena y ahí una máquina solo produce títulos de robot.
 * Cambiarlos es un `update` sobre `cosmeticos.nombre` y `.valor`, sin despliegue.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/sembrar-pases.mjs
 */
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_OWNER);

// ============================== Los pases ==============================
// Semana 1 = 10 de agosto. Las fechas de corte son el fin de la semana de cada
// evaluación parcial, según la planificación de cada asignatura.

const PASES = {
  DSY1107: [
    ['Primer parcial',  '2026-08-10', '2026-09-28'],  // EP1 semanas 6-7
    ['Segundo parcial', '2026-09-28', '2026-10-26'],  // EP2 semana 11
    ['Tercer parcial',  '2026-10-26', '2026-11-30'],  // EP3 semana 16
  ],
  ITY1102: [
    ['Primer parcial',  '2026-08-10', '2026-09-14'],  // EP1 semana 5
    ['Segundo parcial', '2026-09-14', '2026-10-26'],  // EP2 semana 11
    ['Tercer parcial',  '2026-10-26', '2026-12-07'],  // EP3 semana 17
  ],
};

// ============================== Cosméticos ==============================
// Doce estilos de avatar de los 26 que la librería trae sin usar, repartidos por
// rareza, más títulos de relleno. La rareza acá solo ordena el catálogo: la que
// manda en el gacha es la tabla de tasas.

const AVATARES = [
  ['lorelei',      'Lorelei',       'poco_comun'],
  ['micah',        'Micah',         'poco_comun'],
  ['openPeeps',    'Open Peeps',    'poco_comun'],
  ['personas',     'Personas',      'poco_comun'],
  ['bigSmile',     'Big Smile',     'rara'],
  ['croodles',     'Croodles',      'rara'],
  ['miniavs',      'Miniavs',       'rara'],
  ['pixelArt',     'Pixel Art',     'rara'],
  ['avataaars',    'Avataaars',     'epica'],
  ['toonHead',     'Toon Head',     'epica'],
  ['shapes',       'Formas',        'epica'],
  ['glass',        'Vidrio',        'legendaria'],
];

// Placeholders. Reemplazar por los de verdad.
const TITULOS = [
  ['recien-llegado',  'Recién llegado',      'comun'],
  ['constante',       'Constante',           'comun'],
  ['madrugador',      'Madrugador',          'poco_comun'],
  ['sin-faltar',      'Sin faltar una',      'poco_comun'],
  ['de-los-que-leen', 'De los que sí leen',  'rara'],
  ['imparable',       'Imparable',           'rara'],
  ['veterano',        'Veterano del pase',   'epica'],
  ['leyenda',         'Leyenda del semestre','legendaria'],
];

const MARCOS = [
  ['marco-celeste',   'Marco celeste',   'poco_comun', '#0EBAFD'],
  ['marco-turquesa',  'Marco turquesa',  'rara',       '#2DF8D4'],
  ['marco-dorado',    'Marco dorado',    'epica',      '#F0B429'],
];

async function cosmetico(codigo, tipo, nombre, valor, rareza, descripcion = null) {
  const [c] = await sql`
    insert into public.cosmeticos (codigo, tipo, nombre, descripcion, valor, rareza, temporada)
    values (${codigo}, ${tipo}, ${nombre}, ${descripcion}, ${valor}, ${rareza}, ${'2026-2'})
    on conflict (codigo) do update
      set nombre = excluded.nombre, valor = excluded.valor, rareza = excluded.rareza
    returning id`;
  return c.id;
}

// ============================== Programa ==============================

const ids = {};
for (const [clave, nombre, rareza] of AVATARES) {
  ids[`avatar:${clave}`] = await cosmetico(`avatar-${clave}`, 'avatar', nombre, clave, rareza,
    'Un estilo de avatar nuevo para tu foto de perfil.');
}
for (const [clave, texto, rareza] of TITULOS) {
  ids[`titulo:${clave}`] = await cosmetico(`titulo-${clave}`, 'titulo', texto, texto, rareza,
    'Aparece bajo tu nombre en la tabla de posiciones.');
}
for (const [clave, nombre, rareza, color] of MARCOS) {
  ids[`marco:${clave}`] = await cosmetico(clave, 'marco', nombre, color, rareza,
    'Un borde para tu avatar.');
}
console.log(`cosméticos: ${Object.keys(ids).length}`);

/**
 * Las recompensas de los 30 niveles.
 *
 * Una tirada cada 5 niveles —seis por pase, como se acordó— y un cosmético en
 * los niveles marcados. Los niveles sin nada tampoco están vacíos: son el tramo
 * que hay que recorrer para llegar al siguiente, y verlos en la escalera es lo
 * que hace que el siguiente premio se sienta cerca.
 */
function recompensas(orden) {
  const av = AVATARES.map((a) => `avatar:${a[0]}`);
  const ti = TITULOS.map((t) => `titulo:${t[0]}`);
  const ma = MARCOS.map((m) => `marco:${m[0]}`);
  // Se reparte distinto en cada pase para que no se repitan los premios.
  const rota = (xs, n) => xs.slice(n % xs.length).concat(xs.slice(0, n % xs.length));
  const pool = {
    2: rota(ti, orden)[0], 4: rota(av, orden * 4)[0], 7: rota(ti, orden + 1)[0],
    9: rota(av, orden * 4 + 1)[0], 12: rota(ma, orden)[0], 14: rota(av, orden * 4 + 2)[0],
    17: rota(ti, orden + 2)[0], 19: rota(av, orden * 4 + 3)[0], 22: rota(ti, orden + 3)[0],
    24: rota(ma, orden + 1)[0], 27: rota(av, orden * 4 + 4)[0], 30: rota(ti, orden + 5)[0],
  };
  const filas = [];
  for (let n = 1; n <= 30; n++) {
    const cos = pool[n] ?? null;
    const tir = n % 5 === 0 ? 1 : 0;
    if (cos || tir) filas.push({ nivel: n, cosmetico: cos, tiradas: tir });
  }
  return filas;
}

let orden = 0;
for (const [sigla, pases] of Object.entries(PASES)) {
  for (let i = 0; i < pases.length; i++) {
    const [nombre, desde, hasta] = pases[i];
    const [p] = await sql`
      insert into public.pases (asignatura_id, periodo_id, numero, nombre, desde, hasta)
      select a.id, pe.id, ${i + 1}, ${nombre}, ${desde}::timestamptz, ${hasta}::timestamptz
        from public.asignaturas a, public.periodos pe
       where a.sigla = ${sigla} and pe.codigo = ${'2026-2'}
      on conflict (asignatura_id, periodo_id, numero) do update
        set nombre = excluded.nombre, desde = excluded.desde, hasta = excluded.hasta
      returning id, numero, nombre, desde::date, hasta::date`;
    if (!p) { console.error(`no existe ${sigla}`); continue; }

    await sql`delete from public.pase_recompensas where pase_id = ${p.id}`;
    for (const r of recompensas(orden)) {
      await sql`
        insert into public.pase_recompensas (pase_id, nivel, cosmetico_id, tiradas)
        values (${p.id}, ${r.nivel}, ${r.cosmetico ? ids[r.cosmetico] : null}, ${r.tiradas})`;
    }
    orden++;
    console.log(`${sigla} pase ${p.numero}: ${p.nombre} · ${p.desde} → ${p.hasta}`);
  }
}
