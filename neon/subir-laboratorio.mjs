/**
 * Sube un laboratorio escrito en Markdown a Pulso.
 *
 * Reemplaza a `publicar_laboratorio.py`, que generaba SQL para Supabase y
 * esperaba tablas que ya no existen. Este escribe directo en Neon.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/subir-laboratorio.mjs --archivo ../Desarrollo_Cloud_Native/Laboratorios/L1-*.md \
 *     --sigla DSY1107 --periodo 2026-2 [--escribir]
 *
 * Sin `--escribir` valida e informa, sin tocar nada.
 *
 * ── El formato ──
 *
 * Encabezado YAML sencillo y después el enunciado, con bloques propios:
 *
 *     :::caja{1.2 corta}   donde el alumno escribe. El identificador es la llave
 *     :::control{1}        punto de control que valida el docente en sala
 *     :::alerta            aviso
 *     :::pista             ayuda
 *     :::ojo               algo que mirar
 *
 * ── Por qué se parte acá y no en el navegador ──
 *
 * El enunciado se convierte a una lista ordenada de bloques y así se guarda. Si
 * el navegador recibiera Markdown tendría que traer un intérprete y, peor, ubicar
 * dónde va cada caja dentro del texto ya convertido. Partirlo al subir deja el
 * trabajo hecho una vez y del lado donde se puede revisar.
 *
 * ── Lo que se verifica antes de subir ──
 *
 * Que cada caja tenga identificador y que no se repita: es la llave con la que se
 * guarda la respuesta, y si cambia después de publicar, lo que el alumno escribió
 * queda huérfano —la caja aparece vacía y su texto sigue en la base sin que nadie
 * lo lea—. Eso no da error en ninguna parte, así que se caza acá.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { marked } from 'marked';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] ?? true]);
    return a;
  }, []),
);
if (!args.archivo) {
  console.error('Falta --archivo. Lee la cabecera de este archivo para el uso.');
  process.exit(1);
}
const SIGLA = args.sigla ?? 'DSY1107';
const PERIODO = args.periodo ?? '2026-2';

marked.setOptions({ gfm: true, breaks: false });

const ABRE = /^:::(caja|control|alerta|pista|ojo)(?:\{([^}]*)\})?\s*$/;
const CIERRA = /^:::\s*$/;

// ============================== Leer ==============================

const texto = await readFile(args.archivo, 'utf8');
if (!texto.startsWith('---\n')) {
  console.error(`${basename(args.archivo)}: falta el encabezado YAML entre --- y ---`);
  process.exit(1);
}
// Ojo: `split('---\n', 3)` **trunca** el arreglo en JavaScript, no deja el resto
// en el último elemento como en Python. Y estos laboratorios usan `---` como
// separador horizontal cada pocas secciones, así que eso se comía el 95% del
// enunciado sin decir nada: quedaban 6 bloques de 40 y una caja de diecisiete.
const cierre = texto.indexOf('\n---\n', 4);
if (cierre === -1) {
  console.error(`${basename(args.archivo)}: el encabezado YAML no se cierra`);
  process.exit(1);
}
const cabeza = texto.slice(4, cierre);
const cuerpo = texto.slice(cierre + 5);
const meta = {};
for (const linea of cabeza.trim().split('\n')) {
  const i = linea.indexOf(':');
  if (i > 0) meta[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
}
for (const k of ['codigo', 'titulo']) {
  if (!meta[k]) { console.error(`Falta «${k}» en el encabezado`); process.exit(1); }
}

// ============================== Partir en bloques ==============================

const bloques = [];
const problemas = [];
const ids = [];
let prosa = [];
let dentro = null;
let contenido = [];
let numLinea = 0;

const volcarProsa = () => {
  const t = prosa.join('\n').trim();
  if (t) bloques.push({ tipo: 'html', html: marked.parse(t) });
  prosa = [];
};

for (const linea of cuerpo.trim().split('\n')) {
  numLinea++;
  const abre = linea.match(ABRE);

  if (abre && !dentro) {
    volcarProsa();
    dentro = { clase: abre[1], arg: (abre[2] ?? '').trim(), linea: numLinea };
    contenido = [];
    continue;
  }
  if (dentro && CIERRA.test(linea)) {
    const html = marked.parse(contenido.join('\n').trim());
    if (dentro.clase === 'caja') {
      const [id, formato] = dentro.arg.split(/\s+/);
      if (!id) problemas.push(`línea ${dentro.linea}: :::caja sin identificador`);
      else if (ids.includes(id)) problemas.push(`línea ${dentro.linea}: el identificador «${id}» está repetido`);
      else ids.push(id);
      bloques.push({ tipo: 'caja', id, formato: formato ?? 'corta', enunciado: html });
    } else if (dentro.clase === 'control') {
      if (!/^\d+$/.test(dentro.arg)) {
        problemas.push(`línea ${dentro.linea}: :::control necesita un número, p.ej. :::control{1}`);
      }
      bloques.push({ tipo: 'control', numero: Number(dentro.arg) || 0, html });
    } else {
      bloques.push({ tipo: 'aviso', clase: dentro.clase, html });
    }
    dentro = null;
    continue;
  }
  if (dentro) contenido.push(linea);
  else prosa.push(linea);
}
volcarProsa();

if (dentro) problemas.push(`el bloque :::${dentro.clase} de la línea ${dentro.linea} no se cierra`);
if (!ids.length) problemas.push('el laboratorio no tiene ninguna caja de respuesta');

if (problemas.length) {
  console.error(`${basename(args.archivo)}:`);
  for (const p of problemas) console.error(`  ${p}`);
  process.exit(1);
}

const controles = bloques.filter((b) => b.tipo === 'control').length;
const avisos = bloques.filter((b) => b.tipo === 'aviso').length;

console.log(`Archivo    ${basename(args.archivo)}`);
console.log(`Laboratorio ${meta.codigo} · ${meta.titulo}`);
console.log(`Bloques    ${bloques.length} · ${ids.length} cajas · ${controles} controles · ${avisos} avisos`);
console.log(`Cajas      ${ids.join(', ')}`);
console.log(`Puntos     ${meta.puntos ?? 0} · ${meta.minutos ?? '?'} minutos · orden ${meta.orden ?? 0}`);

if (!args.escribir) {
  console.log('\nSin --escribir: no toqué la base.');
  process.exit(0);
}

// ============================== Escribir ==============================

const sql = neon(process.env.DATABASE_URL_OWNER);
const [ambito] = await sql`
  select a.id as asignatura_id, p.id as periodo_id
    from public.asignaturas a, public.periodos p
   where a.sigla = ${SIGLA} and p.codigo = ${PERIODO}`;
if (!ambito) { console.error(`No existe ${SIGLA} en ${PERIODO}`); process.exit(1); }

const [act] = await sql`
  insert into public.actividades (asignatura_id, periodo_id, codigo, titulo, descripcion,
                                  tipo, puntos, orden, activa)
  values (${ambito.asignatura_id}, ${ambito.periodo_id}, ${meta.codigo}, ${meta.titulo},
          ${meta.descripcion ?? null}, 'laboratorio',
          ${Number(meta.puntos) || 0}, ${Number(meta.orden) || 0}, true)
  on conflict (asignatura_id, periodo_id, codigo) do update
    set titulo = excluded.titulo, descripcion = excluded.descripcion,
        puntos = excluded.puntos, orden = excluded.orden, activa = true
  returning id`;

await sql`
  insert into public.laboratorios (actividad_id, bloques, minutos, cajas, controles)
  values (${act.id}, ${JSON.stringify(bloques)}::jsonb,
          ${meta.minutos ? Number(meta.minutos) : null}, ${ids.length}, ${controles})
  on conflict (actividad_id) do update
    set bloques = excluded.bloques, minutos = excluded.minutos,
        cajas = excluded.cajas, controles = excluded.controles,
        actualizado_en = now()`;

// Si el enunciado cambió, avisar de las cajas que desaparecieron: las respuestas
// que los alumnos ya escribieron ahí quedan sin dónde mostrarse.
const [huerfanas] = await sql`
  select coalesce(array_agg(distinct llave), '{}') as llaves
    from public.laboratorio_avance av,
         lateral jsonb_object_keys(av.respuestas) as llave
   where av.actividad_id = ${act.id}
     and not (llave = any(${ids}))`;
if (huerfanas.llaves.length) {
  console.log(`\n⚠ Hay respuestas guardadas en cajas que ya no existen: ${huerfanas.llaves.join(', ')}`);
  console.log('  Los alumnos que las escribieron no las van a ver. Revisa si cambiaste un identificador.');
}

console.log(`\nSubido: ${meta.codigo} · actividad ${act.id}`);
