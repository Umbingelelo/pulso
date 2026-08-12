/**
 * Sube un deck de clase a Vercel Blob y lo registra en Pulso.
 *
 * El deck no se toca: se sube byte a byte tal como está en la carpeta de la
 * asignatura. Lo que este script hace además es leerlo para sacar dos cosas que
 * la base necesita y el navegador no debe decidir:
 *
 *   * cuántas diapositivas tiene, para saber cuándo se dio por terminada;
 *   * la pauta de los quiz, para corregir del lado del servidor.
 *
 * La llave de la pauta es el **índice de la diapositiva** que contiene el quiz,
 * no el número de quiz. Así lo hace el deck:
 *
 *     const idx = slides.indexOf(el.closest('.slide'));
 *     estado.respuestas[idx] = op.dataset.op;
 *
 * Si eso cambiara en la plantilla, hay que cambiarlo acá el mismo día: una pauta
 * con las llaves corridas no da error, simplemente deja de pagar puntos.
 *
 * Uso:
 *   node neon/subir-clase.mjs \
 *     --archivo "../Desarrollo_Cloud_Native/Clases/decks/S01-….html" \
 *     --sigla DSY1107 --periodo 2026-2 \
 *     --codigo S01 --titulo "Presentación de la asignatura" \
 *     --dictada 2026-08-10 --publicar
 *
 * Opcionales: --orden N  --descripcion "…"  --abrir N  --actividad N
 *             --terminar N  --publicar-en "2026-08-17T08:30:00-04:00"
 *             --seco (no sube ni escribe: solo informa lo que haría)
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { put } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';

// ============================== Argumentos ==============================

function argumentos(argv) {
  const salida = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const llave = a.slice(2);
    const siguiente = argv[i + 1];
    if (siguiente && !siguiente.startsWith('--')) {
      salida[llave] = siguiente;
      i++;
    } else {
      salida[llave] = true;
    }
  }
  return salida;
}

// ============================== Lectura del deck ==============================

/**
 * Posiciones de cada `<section class="slide…">` en orden de documento.
 *
 * Va por posición de byte y no con un parser de HTML porque los decks son un
 * solo archivo de 400 KB donde las diapositivas son hermanas y nunca se anidan:
 * un parser sería más peso que beneficio. Si algún día se anidan, esto se cae
 * de forma visible —el conteo dejaría de calzar con el del deck— y no en
 * silencio.
 */
function posicionesDeSlides(html) {
  const re = /<section[^>]*\bclass="slide(?:\s[^"]*)?"/g;
  const pos = [];
  let m;
  while ((m = re.exec(html)) !== null) pos.push(m.index);
  return pos;
}

/** Pauta de los quiz: { "<índice de slide>": "<alternativa correcta>" }. */
function leerPauta(html, slides) {
  const re = /data-widget="quiz"[^>]*\bdata-correcta="([^"]+)"/g;
  const pauta = {};
  const choques = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    // La diapositiva que lo contiene es la última que empezó antes que él.
    let idx = -1;
    for (let i = 0; i < slides.length; i++) {
      if (slides[i] < m.index) idx = i;
      else break;
    }
    if (idx < 0) continue; // un quiz antes de la primera slide: no debería pasar
    const llave = String(idx);
    if (llave in pauta) choques.push(llave);
    pauta[llave] = m[1].trim().toLowerCase();
  }
  return { pauta, choques };
}

function titulo(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? m[1].trim() : null;
}

// ============================== Programa ==============================

const args = argumentos(process.argv.slice(2));

const faltan = ['archivo', 'sigla', 'periodo', 'codigo'].filter((k) => !args[k]);
if (faltan.length) {
  console.error(`Faltan argumentos: ${faltan.map((f) => '--' + f).join(', ')}`);
  console.error('Lee el comentario de cabecera de este archivo para el uso completo.');
  process.exit(1);
}

const html = await readFile(args.archivo, 'utf8');
const slides = posicionesDeSlides(html);
const { pauta, choques } = leerPauta(html, slides);
const actividades = Object.keys(pauta).length;

if (!slides.length) {
  console.error(`No encontré ninguna <section class="slide"> en ${basename(args.archivo)}.`);
  console.error('¿Cambió la plantilla? Sin diapositivas no se puede saber cuándo termina.');
  process.exit(1);
}
if (choques.length) {
  console.error(`Hay dos quiz en la(s) diapositiva(s) ${choques.join(', ')}.`);
  console.error('El deck los guarda con la misma llave, así que solo uno daría puntos.');
  console.error('Sepáralos en diapositivas distintas antes de subir esta clase.');
  process.exit(1);
}

const nombre = args.titulo || titulo(html) || args.codigo;
// 15 segundos por diapositiva: el piso para dar la clase por terminada.
const segundosMinimos = Number(args['segundos-minimos'] ?? slides.length * 15);
const ruta = `clases/${args.sigla}/${args.periodo}/${args.codigo}.html`;

const publicadaDesde = args['publicar-en']
  ? new Date(args['publicar-en']).toISOString()
  : args.publicar
    ? new Date().toISOString()
    : null;

console.log(`Archivo      ${basename(args.archivo)} (${(html.length / 1024).toFixed(0)} KB)`);
console.log(`Clase        ${args.sigla} ${args.periodo} · ${args.codigo} · ${nombre}`);
console.log(`Diapositivas ${slides.length}`);
console.log(`Actividades  ${actividades} quiz con pauta → llaves ${Object.keys(pauta).join(', ')}`);
console.log(`Mínimo       ${segundosMinimos} s para darla por terminada`);
console.log(`Ruta blob    ${ruta}`);
console.log(`Publicada    ${publicadaDesde ?? 'no (queda cargada y oculta)'}`);

if (args.seco) {
  console.log('\n--seco: no subí nada ni escribí en la base.');
  process.exit(0);
}

if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Falta BLOB_READ_WRITE_TOKEN');
if (!process.env.DATABASE_URL_OWNER) throw new Error('Falta DATABASE_URL_OWNER');

const blob = await put(ruta, html, {
  access: 'private',
  contentType: 'text/html; charset=utf-8',
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 31536000, // el contenido de una ruta dada no cambia; si cambia, se sobrescribe
});
console.log(`\nSubido: ${blob.pathname}`);

const sql = neon(process.env.DATABASE_URL_OWNER);

const filas = await sql`
  insert into public.clases (
    asignatura_id, periodo_id, codigo, titulo, descripcion, orden, dictada_el,
    archivo, pauta, slides, actividades,
    puntos_abrir, puntos_actividad, puntos_terminar,
    segundos_minimos, publicada_desde)
  select a.id, p.id, ${args.codigo}, ${nombre}, ${args.descripcion ?? null},
         ${Number(args.orden ?? 0)}, ${args.dictada ?? null}::date,
         ${blob.pathname}, ${JSON.stringify(pauta)}::jsonb,
         ${slides.length}, ${actividades},
         ${Number(args.abrir ?? 5)}, ${Number(args.actividad ?? 10)},
         ${Number(args.terminar ?? 20)},
         ${segundosMinimos}, ${publicadaDesde}::timestamptz
    from public.asignaturas a, public.periodos p
   where a.sigla = ${args.sigla} and p.codigo = ${args.periodo}
  on conflict (asignatura_id, periodo_id, codigo) do update
    set titulo = excluded.titulo,
        descripcion = excluded.descripcion,
        orden = excluded.orden,
        dictada_el = excluded.dictada_el,
        archivo = excluded.archivo,
        pauta = excluded.pauta,
        slides = excluded.slides,
        actividades = excluded.actividades,
        puntos_abrir = excluded.puntos_abrir,
        puntos_actividad = excluded.puntos_actividad,
        puntos_terminar = excluded.puntos_terminar,
        segundos_minimos = excluded.segundos_minimos,
        publicada_desde = excluded.publicada_desde,
        actualizada_en = now()
  returning id, codigo, titulo, slides, actividades, publicada_desde`;

if (!filas.length) {
  console.error(`\nNo existe la asignatura ${args.sigla} en el periodo ${args.periodo}.`);
  console.error('El archivo quedó subido a Blob, pero sin fila en `clases` nadie lo verá.');
  process.exit(1);
}

console.log('Registrada en Pulso:', filas[0]);
