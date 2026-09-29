/**
 * Prueba los puntos para evaluaciones contra la base de verdad.
 *
 * Con la cuenta de prueba: compra décimas y comprueba la escalada —por artículo,
 * +50 % de la base por cada compra previa del mismo—, el tope de 3, que
 * comprar entregue al tiro, que usar descuente del disponible, que no se pueda
 * usar más de lo que hay, que cancelar y rechazar devuelvan al saldo, y que
 * aplicar no. Y que nadie pueda escribir en `usos_decimas` a mano.
 *
 * Deja todo como estaba: borra lo que creó, empiece donde empiece.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-decimas.mjs [--sigla ITY1102]
 */
import { neon } from '@neondatabase/serverless';

const CORREO = 'alumno.prueba@duocuc.cl';
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const SIGLA = args.sigla ?? 'ITY1102';
const MARCA = 'Prueba de décimas';

const db = neon(process.env.DATABASE_URL_OWNER);

let fallos = 0;
function revisar(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`));
}

/** Identidad a mano y rol de la app, como `lib/identidad.mjs`. */
async function como(usuarioId, consulta) {
  const r = await db.transaction([
    db`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    db`set local role pulso_app`,
    consulta(db),
  ]);
  return r[2] ?? [];
}

async function falla(usuarioId, consulta) {
  try { await como(usuarioId, consulta); return null; }
  catch (e) { return e.message; }
}

// ---------- Preparación ----------

const [alumno] = await db`
  select u.id from public.usuarios u where lower(u.correo) = ${CORREO}`;
const [mt] = await db`
  select mt.id, s.asignatura_id, s.periodo_id from public.matriculas mt
    join public.secciones s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
   where mt.perfil_id = ${alumno.id} and a.sigla = ${SIGLA} and mt.activa`;
if (!mt) throw new Error(`${CORREO} no está matriculado en ${SIGLA}.`);
const [docente] = await db`
  select da.docente_id as id from public.docente_asignaturas da
   where da.asignatura_id = ${mt.asignatura_id} and da.periodo_id = ${mt.periodo_id} limit 1`;
const arts = Object.fromEntries((await db`
  select codigo, id, precio, decimas from public.articulos
   where asignatura_id = ${mt.asignatura_id} and periodo_id = ${mt.periodo_id}
     and decimas is not null`).map((a) => [a.codigo, a]));

async function limpiar() {
  await db`delete from public.usos_decimas where matricula_id = ${mt.id}`;
  await db`delete from public.canjes c using public.articulos x
            where x.id = c.articulo_id and x.decimas is not null and c.matricula_id = ${mt.id}`;
  await db`delete from public.movimientos_puntos
            where matricula_id = ${mt.id}
              and (motivo = ${MARCA} or motivo like 'Canje: %puntos en una evaluación%'
                   or motivo like 'Canje: 1 punto en una evaluación%')`;
}

// La cuenta de prueba no debería tener décimas propias. Si las tiene, no se tocan.
const [previas] = await db`
  select count(*)::int n from public.canjes c join public.articulos x on x.id = c.articulo_id
   where x.decimas is not null and c.matricula_id = ${mt.id}`;
if (previas.n > 0) throw new Error('La cuenta de prueba ya tiene canjes de décimas: revisa a mano antes.');

await db`insert into public.movimientos_puntos (matricula_id, puntos, motivo)
         values (${mt.id}, 20000, ${MARCA})`;

const precioEn = async (codigo) => (await como(alumno.id, (s) =>
  s`select precio from public.vitrina where matricula_id = ${mt.id}::uuid and codigo = ${codigo}`))[0].precio;
const comprar = (codigo) => como(alumno.id, (s) =>
  s`select public.solicitar_canje(${mt.id}::uuid, ${arts[codigo].id}::uuid, null) as id`);
const saldo = async () => (await como(alumno.id, (s) =>
  s`select * from public.saldos_decimas where matricula_id = ${mt.id}::uuid`))[0];

try {
  console.log(`${SIGLA} · base ${arts['decimas-02'].precio}/${arts['decimas-05'].precio}/${arts['punto-completo'].precio}\n`);

  console.log('1. La escalada es por artículo y sobre la base');
  revisar('0,2 sin canjes previos', await precioEn('decimas-02'), 300);
  await comprar('decimas-02');
  revisar('0,2 tras un canje de 0,2', await precioEn('decimas-02'), 450);
  revisar('1 punto no sube por un 0,2', await precioEn('punto-completo'), 1350);
  revisar('0,5 no sube por un 0,2', await precioEn('decimas-05'), 675);
  await comprar('punto-completo');
  revisar('1 punto tras un canje de 1 punto', await precioEn('punto-completo'), 2025);
  revisar('0,2 no sube por un 1 punto', await precioEn('decimas-02'), 450);

  const [cobro] = await db`select puntos from public.movimientos_puntos
    where matricula_id = ${mt.id} and motivo like 'Canje: 1 punto%' order by creado_en desc limit 1`;
  revisar('lo cobrado es lo que mostró la vitrina', cobro.puntos, -1350);

  console.log('\n2. Comprar entrega al tiro');
  const [estados] = await db`select array_agg(distinct c.estado) e from public.canjes c
    join public.articulos x on x.id = c.articulo_id where x.decimas is not null and c.matricula_id = ${mt.id}`;
  revisar('estado de los canjes', estados.e, ['entregado']);
  revisar('saldo', await saldo(), { matricula_id: mt.id, ganadas: 12, pendientes: 0, aplicadas: 0 });

  console.log('\n3. El tope de 3 por artículo se mantiene');
  await comprar('decimas-02'); await comprar('decimas-02');
  revisar('el cuarto 0,2 se rechaza',
    (await falla(alumno.id, (s) => s`select public.solicitar_canje(${mt.id}::uuid, ${arts['decimas-02'].id}::uuid, null)`))
      ?.includes('máximo'), true);

  console.log('\n4. Usar');
  const [u1] = await como(alumno.id, (s) => s`select public.usar_decimas(${mt.id}::uuid, 10, 'EP2') as id`);
  revisar('pendientes tras usar 1,0', (await saldo()).pendientes, 10);
  revisar('no se puede usar más de lo disponible (quedan 6)',
    (await falla(alumno.id, (s) => s`select public.usar_decimas(${mt.id}::uuid, 7, 'EP3')`))?.includes('No te alcanzan'), true);
  revisar('sin evaluación no',
    (await falla(alumno.id, (s) => s`select public.usar_decimas(${mt.id}::uuid, 1, '  ')`)) !== null, true);
  revisar('insertar a mano está prohibido',
    (await falla(alumno.id, (s) => s`insert into public.usos_decimas (matricula_id, decimas, evaluacion)
                                    values (${mt.id}::uuid, 99, 'trampa')`)) !== null, true);

  console.log('\n5. Cancelar y rechazar devuelven; aplicar no');
  await como(alumno.id, (s) => s`select public.cancelar_uso_decimas(${u1.id}::bigint)`);
  revisar('cancelar devuelve', (await saldo()).pendientes, 0);

  const [u2] = await como(alumno.id, (s) => s`select public.usar_decimas(${mt.id}::uuid, 5, 'EP2') as id`);
  revisar('el alumno no puede aplicarse su propio uso',
    (await falla(alumno.id, (s) => s`select public.resolver_uso_decimas(${u2.id}::bigint, 'aplicado', null)`)) !== null, true);
  await como(docente.id, (s) => s`select public.resolver_uso_decimas(${u2.id}::bigint, 'rechazado', 'EP2 cerrada')`);
  revisar('rechazar devuelve', await saldo(), { matricula_id: mt.id, ganadas: 16, pendientes: 0, aplicadas: 0 });

  const [u3] = await como(alumno.id, (s) => s`select public.usar_decimas(${mt.id}::uuid, 16, 'EP3') as id`);
  await como(docente.id, (s) => s`select public.resolver_uso_decimas(${u3.id}::bigint, 'aplicado', null)`);
  revisar('aplicar deja las décimas gastadas', await saldo(), { matricula_id: mt.id, ganadas: 16, pendientes: 0, aplicadas: 16 });
  revisar('un uso aplicado ya no se cancela',
    (await falla(alumno.id, (s) => s`select public.cancelar_uso_decimas(${u3.id}::bigint)`))?.includes('aplicado'), true);

  const vistos = await como(docente.id, (s) =>
    s`select count(*)::int n from public.usos_decimas_detalle where matricula_id = ${mt.id}::uuid`);
  revisar('el docente ve los usos del alumno', vistos[0].n, 3);
} finally {
  await limpiar();
  const [resto] = await db`select count(*)::int n from public.movimientos_puntos
    where matricula_id = ${mt.id} and motivo = ${MARCA}`;
  console.log(`\nLimpio: ${resto.n === 0 ? 'sí' : 'NO'}`);
}

console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : '\nTodo bien.');
process.exit(fallos ? 1 : 0);
