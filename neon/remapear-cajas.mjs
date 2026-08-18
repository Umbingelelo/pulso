/**
 * Mueve respuestas de alumnos de una caja a otra cuando cambian los identificadores.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/remapear-cajas.mjs --codigo L1 --sigla ITY1102 \
 *     --mapa "0=0.1,1=1.1,2a=1.5,2b=1.6,1.3=1.1,1.6=1.5" [--escribir]
 *
 * Sin `--escribir` informa y no toca nada.
 *
 * ── Por qué existe ──
 *
 * El identificador de una caja es la llave con la que se guarda la respuesta. Si
 * cambia después de publicar, lo que el alumno escribió queda **huérfano**: la
 * caja aparece vacía y su texto sigue en la base sin que nadie lo lea. El
 * publicador avisa de eso.
 *
 * Pero hay un caso que el aviso **no** puede detectar y es peor: cuando los
 * identificadores se **desplazan**. Si `1.6` pasa a ser `1.5` y aparece un `1.6`
 * nuevo con otra pregunta, la respuesta vieja no queda huérfana — queda pegada a
 * la pregunta equivocada, y se ve perfectamente normal. Pasó con este laboratorio:
 * dos alumnos habían contestado «6826» a «cuántos nulos reporta isna()» y ese
 * número terminó colgado de «qué valores no detecta isna()».
 *
 * ── Cómo no hacer daño ──
 *
 * - **Nunca sobreescribe.** Si el destino ya tiene texto, se salta y lo dice: dos
 *   respuestas no se pueden fusionar y elegir una por el alumno es peor que
 *   dejarlo como está.
 * - **Se aplica de una vez sobre una copia**, no en cadena. Con un mapa como
 *   `1.6=1.5, 1.7=1.6` aplicado paso a paso, el segundo movimiento pisaría lo que
 *   acaba de escribir el primero.
 * - **No toca a quien ya entregó**, salvo con `--incluir-entregados`. Después de
 *   entregar, lo que hay es lo que se corrigió.
 */
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] ?? true]);
    return a;
  }, []),
);
if (!args.codigo || !args.mapa) {
  console.error('Uso: node neon/remapear-cajas.mjs --codigo L1 --sigla ITY1102 --mapa "viejo=nuevo,..." [--escribir]');
  process.exit(1);
}
const ESCRIBIR = !!args.escribir;
const INCLUIR_ENTREGADOS = !!args['incluir-entregados'];

const mapa = new Map(
  String(args.mapa).split(',').map((par) => {
    const [de, a] = par.split('=').map((x) => x.trim());
    if (!de || !a) { console.error(`No entiendo «${par}»: se escribe viejo=nuevo`); process.exit(1); }
    return [de, a];
  }),
);

const sql = neon(process.env.DATABASE_URL_OWNER);

const [lab] = await sql`
  select a.id as actividad, a.codigo, asg.sigla, l.bloques
    from public.actividades a
    join public.laboratorios l on l.actividad_id = a.id
    join public.asignaturas asg on asg.id = a.asignatura_id
   where a.codigo = ${args.codigo}
     and (${args.sigla ?? null}::text is null or asg.sigla = ${args.sigla ?? null})`;
if (!lab) throw new Error(`No existe el laboratorio ${args.codigo}${args.sigla ? ` en ${args.sigla}` : ''}.`);

/** Las cajas que existen hoy: mover a una que no existe sería volver a esconder el texto. */
const existen = new Set(lab.bloques.filter((b) => b.tipo === 'caja').map((b) => b.id));
const inventadas = [...mapa.values()].filter((d) => !existen.has(d));
if (inventadas.length) {
  console.error(`Estas cajas de destino no existen en el enunciado: ${inventadas.join(', ')}`);
  console.error(`Las que hay: ${[...existen].join(', ')}`);
  process.exit(1);
}

console.log(`${lab.sigla} · ${lab.codigo}`);
console.log(`Mapa: ${[...mapa].map(([d, a]) => `${d} → ${a}`).join(' · ')}\n`);

const filas = await sql`
  select av.matricula_id, av.respuestas, av.entregado_en, p.nombre
    from public.laboratorio_avance av
    join public.matriculas mt on mt.id = av.matricula_id
    join public.perfiles p on p.id = mt.perfil_id
   where av.actividad_id = ${lab.actividad}
   order by p.nombre`;

let movidas = 0; let saltadas = 0; let tocados = 0;

for (const f of filas) {
  if (f.entregado_en && !INCLUIR_ENTREGADOS) continue;
  const antes = f.respuestas ?? {};
  // De una vez sobre una copia: en cadena, `1.7=1.6` pisaría lo que acaba de
  // escribir `1.6=1.5`.
  const despues = { ...antes };
  const notas = [];

  for (const [de, a] of mapa) {
    if (!(de in antes)) continue;
    const texto = antes[de];
    if ((despues[a] ?? '').trim() && a !== de) {
      notas.push(`  ⚠ ${de} → ${a}: el destino ya tiene texto, lo dejo donde está`);
      saltadas++;
      continue;
    }
    despues[a] = texto;
    if (a !== de) delete despues[de];
    notas.push(`  ${de} → ${a}: «${String(texto).replace(/\s+/g, ' ').trim().slice(0, 52)}»`);
    movidas++;
  }

  if (!notas.length) continue;
  tocados++;
  console.log(f.nombre + (f.entregado_en ? '  (ya entregó)' : ''));
  for (const n of notas) console.log(n);

  if (ESCRIBIR) {
    await sql`update public.laboratorio_avance
                 set respuestas = ${JSON.stringify(despues)}::jsonb, actualizado_en = now()
               where matricula_id = ${f.matricula_id} and actividad_id = ${lab.actividad}`;
  }
}

console.log(`\n${tocados} alumnos · ${movidas} respuestas movidas` +
  (saltadas ? ` · ${saltadas} saltadas por destino ocupado` : ''));
if (!ESCRIBIR) console.log('\nSin --escribir: no toqué nada.');
