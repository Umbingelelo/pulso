/**
 * El candado de los laboratorios opcionales.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-opcional.mjs [--codigo X1] [--sigla DSY1107]
 *
 * ── Qué se vigila ──
 *
 * Que **no se pueda abrir sin haber entregado el oficial**, y que se abra en
 * cuanto se entrega. Eso se comprueba en la base y no en la pantalla: esconder la
 * tarjeta no sirve de nada porque la dirección `/laboratorio/X1` se escribe a
 * mano, así que lo que importa es que las cuatro puertas —leer, guardar, sugerir
 * y entregar— estén cerradas.
 *
 * Y que **bloqueado signifique que no se ve**: si `mi_laboratorio` devolviera los
 * bloques, el alumno podría leer los tres desafíos sin haber entregado L1 y la
 * mitad del sentido de que sea un premio se pierde.
 *
 * Deja el estado como estaba.
 */
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] ?? true]);
    return a;
  }, []),
);
const CODIGO = args.codigo ?? 'X1';
const SIGLA = args.sigla ?? 'DSY1107';
const CORREO = 'alumno.prueba@duocuc.cl';

const d = neon(process.env.DATABASE_URL_OWNER);
let fallos = 0;
const rev = (e, real, esp) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esp)}`));
};
async function como(usuarioId, consulta) {
  const r = await d.transaction([
    d`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    d`set local role pulso_app`,
    consulta(d),
  ]);
  return r[2] ?? [];
}
async function debeFallar(etiqueta, usuarioId, consulta, contiene) {
  try {
    await como(usuarioId, consulta);
    fallos++;
    console.log(`  ✗ ${etiqueta}: no falló, y tenía que fallar`);
  } catch (e) {
    const ok = (e.message ?? '').includes(contiene);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: «${e.message}»` +
      (ok ? '' : `  ← esperaba «${contiene}»`));
  }
}

// ---------- Preparación ----------

const [alumno] = await d`select id from public.usuarios where lower(correo) = ${CORREO}`;
if (!alumno) throw new Error(`No existe ${CORREO}.`);

const [x] = await d`
  select mt.id as matricula, a.id as actividad, a.titulo, a.puntos,
         l.cajas, l.opcional, l.requiere
    from public.matriculas mt
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas asg on asg.id = s.asignatura_id
    join public.actividades a on a.asignatura_id = s.asignatura_id
                             and a.periodo_id    = s.periodo_id
    join public.laboratorios l on l.actividad_id = a.id
   where mt.perfil_id = ${alumno.id} and a.codigo = ${CODIGO} and asg.sigla = ${SIGLA}`;
if (!x) throw new Error(`El alumno de prueba no tiene ${CODIGO} en ${SIGLA}.`);

const [oficial] = await d`
  select a.id as actividad, a.titulo
    from public.actividades a
    join public.matriculas mt on mt.id = ${x.matricula}
    join public.secciones  s  on s.id = mt.seccion_id
   where a.codigo = ${x.requiere}
     and a.asignatura_id = s.asignatura_id and a.periodo_id = s.periodo_id`;
if (!oficial) throw new Error(`No existe el prerrequisito ${x.requiere}.`);

console.log(`${SIGLA} · ${CODIGO} · ${x.titulo}`);
console.log(`Opcional: ${x.opcional} · se abre al entregar ${x.requiere}\n`);

// Estado previo, para devolverlo intacto.
const [{ id: pisoPuntos }] = await d`select coalesce(max(id),0) as id
   from public.movimientos_puntos where matricula_id = ${x.matricula}`;
const previos = await d`select actividad_id from public.resultados_actividad
   where matricula_id = ${x.matricula}`;
const teniaOficial = previos.some((r) => r.actividad_id === oficial.actividad);

const limpiar = async () => {
  for (const act of [x.actividad, oficial.actividad]) {
    await d`delete from public.laboratorio_avance
             where matricula_id = ${x.matricula} and actividad_id = ${act}`;
    if (!previos.some((r) => r.actividad_id === act)) {
      await d`delete from public.resultados_actividad
               where matricula_id = ${x.matricula} and actividad_id = ${act}`;
    }
  }
  await d`delete from public.movimientos_puntos
           where matricula_id = ${x.matricula}
             and (id > ${pisoPuntos} or motivo in (${x.titulo}, ${oficial.titulo}))`;
};
await limpiar();

const abrir = async () => {
  const [{ r }] = await como(alumno.id, (s) =>
    s`select public.mi_laboratorio(${x.matricula}::uuid, ${CODIGO}) as r`);
  return r;
};

// ---------- Sin haber entregado el oficial ----------

console.log(`Sin haber entregado ${x.requiere}`);
const cerrado = await abrir();
rev('la ficha se ve', cerrado?.codigo, CODIGO);
rev('dice qué falta', cerrado?.falta, x.requiere);
rev('viene marcado como opcional', cerrado?.opcional, true);
// Lo que de verdad importa: el enunciado **no** baja.
rev('el enunciado no baja', (cerrado?.bloques ?? []).length, 0);
rev('ni las respuestas de nadie', cerrado?.respuestas, {});

await debeFallar('no se puede escribir', alumno.id, (s) =>
  s`select public.laboratorio_guardar(${x.matricula}::uuid, ${CODIGO}, '{"1.1":"trampa"}'::jsonb, 0)`,
  `primero tienes que entregar ${x.requiere}`);
await debeFallar('no se puede pedir sugerencia', alumno.id, (s) =>
  s`select public.laboratorio_revisar_guardar(${x.matricula}::uuid, ${CODIGO},
      '1.1', 'logrado', 'x', 'y')`, `primero tienes que entregar ${x.requiere}`);
await debeFallar('no se puede entregar', alumno.id, (s) =>
  s`select public.laboratorio_entregar(${x.matricula}::uuid, ${CODIGO})`,
  `primero tienes que entregar ${x.requiere}`);

const enLista = await como(alumno.id, (s) =>
  s`select * from public.mis_laboratorios(${x.matricula}::uuid)`);
const suyo = enLista.find((l) => l.codigo === CODIGO);
rev('la lista lo muestra bloqueado', suyo?.falta, x.requiere);
rev('y el oficial abierto', enLista.find((l) => l.codigo === x.requiere)?.falta, null);

// ---------- Entregar el oficial ----------
// Se hace por el camino de verdad: responder y entregar, no un insert a mano.

console.log(`\nSe entrega ${x.requiere}`);
const [{ r: labOficial }] = await como(alumno.id, (s) =>
  s`select public.mi_laboratorio(${x.matricula}::uuid, ${x.requiere}) as r`);
const primera = labOficial.bloques.find((b) => b.tipo === 'caja').id;
await como(alumno.id, (s) =>
  s`select public.laboratorio_guardar(${x.matricula}::uuid, ${x.requiere},
      ${JSON.stringify({ [primera]: 'respuesta de prueba' })}::jsonb, 0)`);
const [{ r: entrega }] = await como(alumno.id, (s) =>
  s`select public.laboratorio_entregar(${x.matricula}::uuid, ${x.requiere}) as r`);
rev(`${x.requiere} quedó entregado`, entrega?.entregado, true);

// ---------- Ahora sí ----------

console.log('\nY se abre');
const abierto = await abrir();
rev('ya no falta nada', abierto?.falta, null);
rev('el enunciado baja completo', abierto?.bloques?.length > 0, true);
rev('con todas sus cajas', abierto?.cajas, x.cajas);

await como(alumno.id, (s) =>
  s`select public.laboratorio_guardar(${x.matricula}::uuid, ${CODIGO},
      ${JSON.stringify({ '1.1': 'ahora sí puedo escribir' })}::jsonb, 1)`);
const conTexto = await abrir();
rev('y se puede escribir', conTexto?.respuestas?.['1.1'], 'ahora sí puedo escribir');

// ---------- Dejarlo como estaba ----------

await limpiar();
const despues = await abrir();
rev('vuelve a quedar cerrado al deshacer la entrega',
  despues?.falta, teniaOficial ? null : x.requiere);

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
