/**
 * El recorrido completo de un laboratorio, con el alumno de prueba.
 *
 * Llama a las mismas funciones de Postgres que llama `/api/laboratorio`, con la
 * misma identidad puesta igual y como el mismo rol `pulso_app` con RLS aplicado.
 * Lo único que no ejercita es el HTTP y el navegador.
 *
 * Además de que el camino feliz funcione, comprueba lo que de verdad duele:
 * que no se pueda entregar en blanco, que después de entregar no se pueda seguir
 * escribiendo, que no se pueda entregar dos veces —serían puntos duplicados— y
 * que el laboratorio de otro ramo no se vea. Un laboratorio son dos horas de
 * trabajo del alumno; los modos de falla caros son los que pierden ese trabajo o
 * lo dejan cobrar de más.
 *
 * Deja el estado como estaba: borra su avance al empezar y al terminar.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-laboratorio.mjs [--codigo L1]
 */
import { neon } from '@neondatabase/serverless';

const CORREO = 'alumno.prueba@duocuc.cl';
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1]]);
    return a;
  }, []),
);
const CODIGO = args.codigo ?? 'L1';

const dueno = neon(process.env.DATABASE_URL_OWNER);
const app = neon(process.env.DATABASE_URL_OWNER);

let fallos = 0;
const rev = (e, real, esp) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esp)}`));
};

/** Igual que `lib/identidad.mjs`: identidad a mano, local a la transacción. */
async function comoAlumno(usuarioId, consulta) {
  const r = await app.transaction([
    app`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    app`set local role pulso_app`,
    consulta(app),
  ]);
  return r[2] ?? [];
}

/** Falla a propósito: devuelve el mensaje en vez de reventar. */
async function debeFallar(etiqueta, usuarioId, consulta, contiene) {
  try {
    await comoAlumno(usuarioId, consulta);
    fallos++;
    console.log(`  ✗ ${etiqueta}: no falló, y tenía que fallar`);
  } catch (e) {
    const ok = (e.message ?? '').includes(contiene);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: «${e.message}»` +
      (ok ? '' : `  ← esperaba que dijera «${contiene}»`));
  }
}

// ---------- Preparación ----------

const [alumno] = await dueno`
  select u.id from public.usuarios u where lower(u.correo) = ${CORREO}`;
if (!alumno) throw new Error(`No existe ${CORREO}.`);

const [m] = await dueno`
  select mt.id as matricula, a.id as actividad, a.puntos, l.cajas, l.controles
    from public.matriculas mt
    join public.secciones  s on s.id = mt.seccion_id
    join public.actividades a on a.asignatura_id = s.asignatura_id
                             and a.periodo_id    = s.periodo_id
    join public.laboratorios l on l.actividad_id = a.id
   where mt.perfil_id = ${alumno.id} and a.codigo = ${CODIGO}`;
if (!m) throw new Error(`El alumno de prueba no tiene el laboratorio ${CODIGO}.`);

/**
 * Deja la matrícula como estaba.
 *
 * Los movimientos se borran por marca de agua y no por motivo: el trigger escribe
 * el **título** de la actividad, no su código, así que un filtro por «L1» no
 * calzaba con nada y cada corrida le dejaba cien puntos regalados al alumno de
 * prueba. Lo que hay después de la marca es lo que hizo esta corrida y nada más.
 */
const marca = async () => {
  const [r] = await dueno`select coalesce(max(id),0) as id
     from public.movimientos_puntos where matricula_id = ${m.matricula}`;
  return r.id;
};
let piso = await marca();

const limpiar = async () => {
  await dueno`delete from public.laboratorio_avance
               where matricula_id = ${m.matricula} and actividad_id = ${m.actividad}`;
  await dueno`delete from public.resultados_actividad
               where matricula_id = ${m.matricula} and actividad_id = ${m.actividad}`;
  await dueno`delete from public.movimientos_puntos
               where matricula_id = ${m.matricula} and id > ${piso}`;
};
await limpiar();

const saldo = async () => {
  const [r] = await dueno`select coalesce(sum(puntos),0)::int as p
     from public.movimientos_puntos where matricula_id = ${m.matricula}`;
  return r.p;
};
const antes = await saldo();

console.log(`Laboratorio ${CODIGO} · ${m.cajas} cajas · ${m.controles} controles · ${m.puntos} puntos`);

// ---------- Leerlo ----------

console.log('\nAbrirlo');
const [{ r: lab }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('trae el enunciado', Array.isArray(lab?.bloques) && lab.bloques.length > 0, true);
rev('cajas', lab?.cajas, m.cajas);
rev('empieza sin respuestas', lab?.respuestas, {});
rev('empieza en el tramo 0', lab?.tramo, 0);
rev('sin entregar', lab?.entregado_en, null);

const idsDeCaja = lab.bloques.filter((b) => b.tipo === 'caja').map((b) => b.id);
rev('los identificadores no se repiten', new Set(idsDeCaja).size, idsDeCaja.length);
rev('ninguna caja sin identificador', idsDeCaja.every((x) => !!x), true);

// ---------- Entregar en blanco ----------
// Antes del camino feliz: si dejara entregar vacío, el alumno perdería su único
// intento con un clic sin querer y no habría vuelta atrás desde su lado.

console.log('\nLo que no se puede hacer todavía');
await debeFallar('no se entrega en blanco', alumno.id, (s) =>
  s`select public.laboratorio_entregar(${m.matricula}::uuid, ${CODIGO})`,
  'No has respondido ninguna caja');

// Con espacios en blanco tampoco: `trim` tiene que contar eso como vacío.
await comoAlumno(alumno.id, (s) =>
  s`select public.laboratorio_guardar(${m.matricula}::uuid, ${CODIGO},
      ${JSON.stringify({ [idsDeCaja[0]]: '   \n  ' })}::jsonb, 0)`);
await debeFallar('los espacios no cuentan como respuesta', alumno.id, (s) =>
  s`select public.laboratorio_entregar(${m.matricula}::uuid, ${CODIGO})`,
  'No has respondido ninguna caja');

// ---------- Ir escribiendo ----------

console.log('\nIr respondiendo');
const escritas = {};
for (const [i, id] of idsDeCaja.entries()) escritas[id] = `Respuesta de prueba a ${id} (${i})`;

await comoAlumno(alumno.id, (s) =>
  s`select public.laboratorio_guardar(${m.matricula}::uuid, ${CODIGO},
      ${JSON.stringify(escritas)}::jsonb, 1)`);
const [{ r: v1 }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('guardó todas', Object.keys(v1.respuestas).length, m.cajas);
rev('el texto es el mismo', v1.respuestas[idsDeCaja[0]], escritas[idsDeCaja[0]]);
rev('avanzó al tramo 1', v1.tramo, 1);

// El tramo solo sube: si vuelve atrás a corregir una caja no puede perder el
// punto de control que ya alcanzó delante del profesor.
await comoAlumno(alumno.id, (s) =>
  s`select public.laboratorio_guardar(${m.matricula}::uuid, ${CODIGO},
      ${JSON.stringify(escritas)}::jsonb, 0)`);
const [{ r: v2 }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('el tramo no retrocede', v2.tramo, 1);

rev('todavía no hay puntos', await saldo(), antes);

// ---------- Entregar ----------

console.log('\nEntregar');
const [{ r: entrega }] = await comoAlumno(alumno.id, (s) =>
  s`select public.laboratorio_entregar(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('entregado', entrega?.entregado, true);
rev('cuenta las respondidas', entrega?.respondidas, m.cajas);
rev('pagó los puntos', await saldo() - antes, m.puntos);

const [{ r: v3 }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('queda con fecha de entrega', typeof v3.entregado_en === 'string', true);

// ---------- Después de entregar ----------

console.log('\nDespués de entregar');
await debeFallar('no se puede seguir escribiendo', alumno.id, (s) =>
  s`select public.laboratorio_guardar(${m.matricula}::uuid, ${CODIGO},
      ${JSON.stringify({ ...escritas, [idsDeCaja[0]]: 'cambiado' })}::jsonb, 2)`,
  'Ya lo entregaste');
await debeFallar('no se entrega dos veces', alumno.id, (s) =>
  s`select public.laboratorio_entregar(${m.matricula}::uuid, ${CODIGO})`,
  'Ya lo habías entregado');
rev('los puntos no se duplicaron', await saldo() - antes, m.puntos);

// ---------- Lo que no es suyo ----------

console.log('\nLo que no es suyo');
const [otra] = await dueno`
  select id from public.matriculas where id <> ${m.matricula} limit 1`;
if (otra) {
  await debeFallar('no lee el laboratorio de otro', alumno.id, (s) =>
    s`select public.mi_laboratorio(${otra.id}::uuid, ${CODIGO})`, 'no es tuya');
  await debeFallar('no escribe en el de otro', alumno.id, (s) =>
    s`select public.laboratorio_guardar(${otra.id}::uuid, ${CODIGO}, '{}'::jsonb, 0)`,
    'no es tuya');
}
const [{ r: inexistente }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, 'NO-EXISTE') as r`);
rev('un código que no existe da nulo', inexistente, null);

// ---------- Lo que ve el docente ----------

console.log('\nLo que ve el docente');
const [docente] = await dueno`
  select id from public.usuarios where lower(correo) = 'cr.calderons@profesor.duoc.cl'`;
if (docente) {
  const [ambito] = await dueno`
    select a.asignatura_id, a.periodo_id from public.actividades a where a.id = ${m.actividad}`;
  const filas = await comoAlumno(docente.id, (s) =>
    s`select * from public.laboratorio_avances(
        ${ambito.asignatura_id}::uuid, ${ambito.periodo_id}::uuid, ${CODIGO})`);
  const mia = filas.find((x) => x.matricula_id === m.matricula);
  rev('ve al alumno de prueba', !!mia, true);
  rev('con sus respuestas contadas', mia?.respondidas, m.cajas);
  // `mi_laboratorio` devuelve jsonb, así que ahí la fecha llega como cadena;
  // acá es una columna timestamptz y el driver la convierte en Date.
  rev('y su entrega', !!mia?.entregado_en, true);
}

// ---------- Dejarlo como estaba ----------

await limpiar();
const despues = await saldo();
rev('el saldo vuelve a como estaba', despues, antes);

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
