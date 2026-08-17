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
 * Encabezado sencillo y después el enunciado, con bloques propios:
 *
 *     :::caja{1.2 corta}   donde el alumno escribe. El identificador es la llave
 *     :::control{1}        punto de control que valida el docente en sala
 *     :::alerta            aviso
 *     :::pista             ayuda
 *     :::ojo               algo que mirar
 *
 * Quien parte el Markdown en bloques y decide qué es válido es
 * `laboratorio-md.mjs`. Acá sólo se lee el archivo, se informa y se escribe.
 *
 * ── Lo que se verifica antes de subir ──
 *
 * Todo lo que el compilador junte en `problemas`, y además —ya en la base— las
 * cajas huérfanas: las respuestas que los alumnos escribieron en una caja cuyo
 * identificador cambió quedan guardadas donde nadie las lee, y eso no da error
 * en ninguna parte.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { compilar } from './laboratorio-md.mjs';

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

// ============================== Compilar ==============================

const texto = await readFile(args.archivo, 'utf8');
const { meta, bloques, ids, controles, avisos, problemas } = compilar(texto);

if (problemas.length) {
  console.error(`${basename(args.archivo)}:`);
  for (const p of problemas) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`Archivo    ${basename(args.archivo)}`);
console.log(`Laboratorio ${meta.codigo} · ${meta.titulo}`);
console.log(`Bloques    ${bloques.length} · ${ids.length} cajas · ${controles} controles · ${avisos} avisos`);
console.log(`Cajas      ${ids.join(', ')}`);
console.log(`Puntos     ${meta.puntos} · ${meta.minutos ?? '?'} minutos · orden ${meta.orden ?? 0}`);

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
          ${Number(meta.puntos)}, ${Number(meta.orden ?? 0)}, true)
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
