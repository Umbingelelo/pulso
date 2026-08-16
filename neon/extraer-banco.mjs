/**
 * Saca el banco de términos de los decks, sin inventar nada.
 *
 * Los decks ya marcan qué palabras importan:
 *
 *     <b class="termino" data-termino="código de estado">cómo salió</b>:
 *       un número de tres dígitos y su nombre.
 *
 * El atributo dice el término y **la definición viene en la propia prosa del
 * docente, justo después**. Este script toma las dos cosas: el término tal como
 * está marcado y la frase que lo sigue dentro del mismo párrafo.
 *
 * No pasa por ningún modelo, y esa es la gracia. Lo que quede en el banco son
 * palabras del docente, con su clase de origen anotada, y de ahí el generador de
 * misiones compone sin poder afirmar nada que no esté escrito acá.
 *
 * Todo entra con `activo = false`: son **candidatos**. Nada llega a un alumno
 * hasta que el docente los revise. Al final imprime un archivo para esa revisión.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/extraer-banco.mjs --sigla DSY1107 --periodo 2026-2 \
 *     --carpeta ../Desarrollo_Cloud_Native/Clases/decks [--escribir]
 *
 * Sin `--escribir` solo informa lo que haría.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename, relative } from 'node:path';
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] ?? true]);
    return a;
  }, []),
);
const SIGLA = args.sigla ?? 'DSY1107';
const PERIODO = args.periodo ?? '2026-2';
const CARPETA = args.carpeta ?? '../Desarrollo_Cloud_Native/Clases/decks';

// ============================== Limpieza ==============================

const ENTIDADES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
};

function aTexto(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTIDADES[e] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La definición: lo que sigue al término hasta el final de la frase.
 *
 * Se corta en el primer punto seguido de espacio y mayúscula —o en el fin del
 * párrafo— porque la frase siguiente casi nunca sigue hablando del término. Se
 * prefiere quedarse corto: una definición recortada se arregla en la revisión,
 * una que arrastra tres frases ajenas no se nota y ensucia el banco.
 */
function definicionDesde(resto) {
  const texto = aTexto(resto);
  const limpio = texto.replace(/^[\s:—–-]+/, '');
  const corte = limpio.search(/\.\s+[A-ZÁÉÍÓÚÑ¿«]/);
  const frase = (corte > 0 ? limpio.slice(0, corte + 1) : limpio).trim();
  return frase.replace(/\s+/g, ' ');
}

// ============================== Extracción ==============================

const RE_TERMINO = /<b class="termino"[^>]*\bdata-termino="([^"]+)"[^>]*>([\s\S]*?)<\/b>/g;

function extraerDeDeck(html, codigo) {
  const salida = [];
  let m;
  while ((m = RE_TERMINO.exec(html)) !== null) {
    const termino = m[1].trim();
    // El resto del párrafo que contiene al término. Si no hay </p> cerca, se
    // toma una ventana corta: mejor poco contexto que arrastrar media slide.
    const desde = m.index + m[0].length;
    const finP = html.indexOf('</p>', desde);
    const resto = html.slice(desde, finP === -1 || finP - desde > 700 ? desde + 700 : finP);
    const definicion = definicionDesde(resto);
    salida.push({ termino, visible: aTexto(m[2]), definicion, fuente: codigo });
  }
  return salida;
}

// ============================== Programa ==============================

/**
 * Recorre la carpeta, entrando en subcarpetas: los decks de Arquitectura viven
 * en una carpeta por sesión, no en un directorio plano como los de Cloud Native.
 *
 * Se saltan dos cosas a propósito: los **apuntes docentes**, que no son material
 * del alumno, y todo lo que cuelgue de `fuentes/`, que son las versiones de
 * trabajo del mismo deck y duplicarían cada término.
 */
async function decks(dir) {
  const salida = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const ruta = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.toLowerCase() === 'fuentes') continue;
      salida.push(...await decks(ruta));
    } else if (e.name.endsWith('.html') && !/apunte/i.test(e.name)) {
      salida.push(ruta);
    }
  }
  return salida;
}

const archivos = (await decks(CARPETA))
  .filter((f) => f.endsWith('.html'))
  .sort((a, b) => {
    const n = (x) => { const b2 = basename(x);
      return b2.startsWith('S') ? 0 : parseInt(b2.match(/^D(\d+)/)?.[1] ?? '999', 10); };
    return n(a) - n(b);
  });

const todos = [];
for (const f of archivos) {
  const codigo = basename(f).match(/^(S\d+|D\d+)/)?.[1] ?? basename(f, '.html');
  const html = await readFile(f, 'utf8');
  const hallados = extraerDeDeck(html, codigo);
  todos.push(...hallados);
  console.log(`${codigo.padEnd(4)} ${String(hallados.length).padStart(3)} términos  ${relative(CARPETA, f)}`);
}

// Un término puede repetirse entre decks. Se queda la primera aparición —la
// clase donde se enseñó— y se anotan las demás como apariciones posteriores.
const porTermino = new Map();
for (const t of todos) {
  const llave = t.termino.toLowerCase();
  if (!porTermino.has(llave)) porTermino.set(llave, { ...t, tambien: [] });
  else porTermino.get(llave).tambien.push(t.fuente);
}
const banco = [...porTermino.values()];

// Los que quedaron sin definición utilizable necesitan que el docente la escriba.
const CORTA = 25;
const flojos = banco.filter((t) => t.definicion.length < CORTA);
const buenos = banco.filter((t) => t.definicion.length >= CORTA);

console.log(`\n${todos.length} marcas → ${banco.length} términos distintos`);
console.log(`  con definición aprovechable: ${buenos.length}`);
console.log(`  sin definición clara:        ${flojos.length}  (hay que escribirlas a mano)`);

// ---------- Archivo de revisión ----------

const lineas = [
  `# Banco de términos · ${SIGLA} ${PERIODO}`,
  '',
  'Extraído de los decks. Cada término trae la definición que aparece en tu propia',
  'prosa justo después de marcarlo. Revisa, corrige lo que haga falta y borra lo que',
  'no sirva: nada de esto llega a un alumno hasta que lo actives.',
  '',
  `Total: ${banco.length} términos · ${buenos.length} con definición · ${flojos.length} por escribir`,
  '',
  '---',
  '',
];
for (const t of banco.sort((a, b) => a.fuente.localeCompare(b.fuente, 'es', { numeric: true })
                                   || a.termino.localeCompare(b.termino, 'es'))) {
  const marca = t.definicion.length < CORTA ? ' ← FALTA DEFINICIÓN' : '';
  lineas.push(`## ${t.termino}${marca}`);
  lineas.push(`- clase: ${t.fuente}${t.tambien.length ? ` (también en ${[...new Set(t.tambien)].join(', ')})` : ''}`);
  lineas.push(`- definición: ${t.definicion || '—'}`);
  lineas.push('');
}
const ruta = `neon/banco-${SIGLA}-${PERIODO}.md`;
await writeFile(ruta, lineas.join('\n'));
console.log(`\nRevisión escrita en ${ruta}`);

// ---------- Escribir en la base ----------

if (!args.escribir) {
  console.log('\nSin --escribir: no toqué la base.');
  process.exit(0);
}

const sql = neon(process.env.DATABASE_URL_OWNER);
const [ambito] = await sql`
  select a.id as asignatura_id, p.id as periodo_id
    from public.asignaturas a, public.periodos p
   where a.sigla = ${SIGLA} and p.codigo = ${PERIODO}`;
if (!ambito) throw new Error(`No existe ${SIGLA} en ${PERIODO}.`);

let nuevos = 0, actualizados = 0;
for (const t of banco) {
  const fuente = t.fuente + (t.tambien.length ? ` (+${new Set(t.tambien).size})` : '');
  const filas = await sql`
    insert into public.mision_banco (asignatura_id, periodo_id, termino, definicion, fuente, activo)
    values (${ambito.asignatura_id}, ${ambito.periodo_id}, ${t.termino},
            ${t.definicion || '(por escribir)'}, ${fuente}, false)
    on conflict (asignatura_id, periodo_id, termino) do update
      set definicion = excluded.definicion, fuente = excluded.fuente
    returning (xmax = 0) as insertado`;
  filas[0].insertado ? nuevos++ : actualizados++;
}
console.log(`\nEn la base: ${nuevos} nuevos, ${actualizados} actualizados. Todos con activo = false.`);
console.log('Ninguno se usa hasta que los actives.');
