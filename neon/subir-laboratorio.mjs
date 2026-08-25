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
 *     :::pauta{1.2}        la respuesta correcta de esa caja. **No se le muestra
 *                          nunca al alumno**: va a una columna aparte y su único
 *                          lector es el modelo que revisa. Ver `0030_pauta.sql`.
 *     :::control{1}        punto de control que valida el docente en sala
 *     :::alerta            aviso
 *     :::pista             ayuda
 *     :::ojo               algo que mirar
 *
 * Quien parte el Markdown en bloques y decide qué es válido es
 * `laboratorio-md.mjs`. Acá sólo se lee el archivo, se informa y se escribe.
 *
 * ── El plazo ──
 *
 * `desde:` y `hasta:` en el encabezado marcan la ventana en que el laboratorio
 * **paga puntos**. Fuera de ella se hace y se entrega igual, pero no suma. Se
 * escriben en hora local —`hasta: 2026-08-24` es ese domingo a las 23:59— y son
 * opcionales: sin ellas el laboratorio paga siempre, como antes.
 *
 * Si el .md no las trae, **no se pisa** lo que haya en el panel del docente. Para
 * quitar un plazo se vacían los dos campos allá.
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
const { meta, bloques, ids, pautas, controles, avisos, problemas } = compilar(texto);

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

// La cobertura de pautas se informa siempre, y las que faltan por nombre. No es
// un error —se puede publicar sin ninguna, y así están L0 y L1— pero una caja sin
// pauta se revisa con menos criterio que sus vecinas y eso no se nota mirando la
// pantalla: el alumno recibe un veredicto igual de seguro.
const sinPauta = ids.filter((id) => !(id in pautas));
console.log(`Pautas     ${ids.length - sinPauta.length} de ${ids.length} cajas`);
if (sinPauta.length) console.log(`           sin pauta: ${sinPauta.join(', ')}`);

if (meta.opcional === 'true' || meta.requiere || meta.excluye) {
  console.log(`Acceso     ${meta.opcional === 'true' ? 'opcional' : 'de la línea principal'}` +
    (meta.requiere ? ` · se abre al entregar ${meta.requiere}` : ' · sin candado') +
    (meta.excluye ? ` · alternativa de ${meta.excluye}: se hace uno o el otro` : ''));
}
console.log(`Plazo      ${meta.desde || meta.hasta
  ? `${meta.desde ?? 'siempre'} → ${meta.hasta ?? 'siempre'} (hora local)`
  : 'no viene en el .md · se conserva el del panel'}`);

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

// `meta.desde` y `meta.hasta` vienen del compilador en hora local sin zona, así que
// `new Date` las interpreta en la zona de esta máquina —la del docente— y
// `toISOString` las manda con zona. Nadie tiene que acordarse de sumar horas.
const aUtc = (local) => (local ? new Date(`${local}:00`).toISOString() : null);
const desde = aUtc(meta.desde);
const hasta = aUtc(meta.hasta);

const [act] = await sql`
  insert into public.actividades (asignatura_id, periodo_id, codigo, titulo, descripcion,
                                  tipo, puntos, orden, activa, puntua_desde, puntua_hasta)
  values (${ambito.asignatura_id}, ${ambito.periodo_id}, ${meta.codigo}, ${meta.titulo},
          ${meta.descripcion ?? null}, 'laboratorio',
          ${Number(meta.puntos)}, ${Number(meta.orden ?? 0)}, true,
          ${desde}::timestamptz, ${hasta}::timestamptz)
  on conflict (asignatura_id, periodo_id, codigo) do update
    set titulo = excluded.titulo, descripcion = excluded.descripcion,
        puntos = excluded.puntos, orden = excluded.orden, activa = true,
        -- Con coalesce y no asignación directa: si el .md no trae el plazo, se
        -- conserva el que el docente puso en el panel. Volver a subir un
        -- laboratorio para corregirle una tilde no puede borrarle la fecha, y
        -- borrarla no da error: simplemente vuelve a pagar siempre, para todos, sin
        -- que nadie se entere. Para quitar el plazo se vacían los campos del panel.
        --
        -- (Sin comillas invertidas en este comentario: va dentro de un template
        --  literal de JavaScript y una comilla invertida lo cerraría en la mitad.)
        puntua_desde = coalesce(excluded.puntua_desde, public.actividades.puntua_desde),
        puntua_hasta = coalesce(excluded.puntua_hasta, public.actividades.puntua_hasta)
  returning id, puntua_desde, puntua_hasta`;

await sql`
  insert into public.laboratorios (actividad_id, bloques, pautas, minutos, cajas, controles,
                                   opcional, requiere, excluye)
  values (${act.id}, ${JSON.stringify(bloques)}::jsonb, ${JSON.stringify(pautas)}::jsonb,
          ${meta.minutos ? Number(meta.minutos) : null}, ${ids.length}, ${controles},
          ${meta.opcional === 'true'}, ${meta.requiere ?? null}, ${meta.excluye ?? null})
  on conflict (actividad_id) do update
    set bloques = excluded.bloques, pautas = excluded.pautas, minutos = excluded.minutos,
        cajas = excluded.cajas, controles = excluded.controles,
        opcional = excluded.opcional, requiere = excluded.requiere,
        excluye = excluded.excluye,
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
