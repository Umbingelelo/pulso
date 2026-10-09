/**
 * La ruleta de nota: quién puede tirarla, que se tire una sola vez, y que los
 * porcentajes sean los que se le prometieron al alumno.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-ruleta.mjs
 *
 * Llama a las mismas funciones que llama `/api/docente` (`tirar-ruleta`), con la
 * misma identidad y el mismo rol `pulso_app` con RLS.
 *
 * ── Qué se vigila acá y por qué ──
 *
 *   - **Que el sorteo sea el prometido.** 20.000 llamadas a `ruleta_sortear()` —la
 *     misma función que usa `tirar_ruleta`, sin tocar ningún canje— y cada
 *     frecuencia dentro de cinco desviaciones estándar de lo esperado. Cinco y no
 *     dos: con dos, una corrida honesta fallaría una de cada veinte veces por pura
 *     mala suerte, y una prueba que falla sola se termina ignorando.
 *   - **Que no se pueda sortear dos veces.** El segundo giro falla, y dos giros
 *     simultáneos dejan exactamente uno. Es el `for update`: sin él ambos leen
 *     «solicitado» y el docente se queda con el que más le guste.
 *   - **Que tirar contra cancelar no dé las dos cosas.** El alumno que cancela justo
 *     cuando el docente gira no puede quedarse con la nota y con los puntos.
 *   - **Que «Entregar» a secas no cierre la ruleta.** `resolver_canje` tiene que
 *     negarse: si no, una nota se entrega sin sorteo.
 *   - **Que rechazar siga devolviendo los puntos.**
 *
 * Los canjes reales de la ruleta (los de otros alumnos) no se tocan: esta prueba
 * solo escribe sobre la matrícula del alumno de prueba, y todo lo que escribe va
 * firmado con `NOTA` y `MOTIVO` para poder barrerlo aunque una corrida anterior
 * haya muerto a medio camino. Al final comprueba que no quedó nada.
 */
import { neon } from '@neondatabase/serverless';

const CORREO_ALUMNO = 'alumno.prueba@duocuc.cl';
const CORREO_DOCENTE = 'cr.calderons@profesor.duoc.cl';
const NOTA = 'prueba de ruleta';
const MOTIVO = 'Prueba de la ruleta de nota';
const SORTEOS = 20000;
const ESPERADO = { '1.0': 500, '4.0': 400, '5.0': 90, '6.0': 8, '7.0': 2 }; // por mil

const dueno = neon(process.env.DATABASE_URL_OWNER);

let fallos = 0;
const rev = (e, real, esp) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esp)}`));
};
const verdad = (e, cond, detalle = '') => {
  if (!cond) fallos++;
  console.log(`  ${cond ? '✓' : '✗'} ${e}${detalle ? `: ${detalle}` : ''}`);
};

/** Igual que `lib/identidad.mjs`: identidad a mano, local a la transacción. */
async function como(usuarioId, consulta) {
  const r = await dueno.transaction([
    dueno`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    dueno`set local role pulso_app`,
    consulta(dueno),
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
      (ok ? '' : `  ← esperaba que dijera «${contiene}»`));
  }
}

// ---------- Preparación ----------

const [alumno] = await dueno`select id from public.usuarios where lower(correo) = ${CORREO_ALUMNO}`;
if (!alumno) throw new Error(`No existe ${CORREO_ALUMNO}.`);
const [docente] = await dueno`select id from public.usuarios where lower(correo) = ${CORREO_DOCENTE}`;
if (!docente) throw new Error(`No existe ${CORREO_DOCENTE}.`);

// La matrícula del alumno de prueba en un ramo que tenga la ruleta en su tienda.
const [m] = await dueno`
  select mt.id as matricula, s.codigo as seccion_codigo, a.sigla,
         ar.id as ruleta, ar.precio
    from public.matriculas  mt
    join public.secciones   s  on s.id = mt.seccion_id
    join public.asignaturas a  on a.id = s.asignatura_id
    join public.articulos   ar on ar.asignatura_id = a.id and ar.periodo_id = s.periodo_id
   where mt.perfil_id = ${alumno.id} and mt.activa
     and ar.codigo = 'ruleta-nota' and ar.activo
   limit 1`;
if (!m) throw new Error('El alumno de prueba no tiene un ramo con la ruleta en la tienda.');

// Otro artículo que pida aprobación, para probar que la ruleta no se tira sobre
// cualquier canje.
const [otro] = await dueno`
  select ar.id, ar.precio
    from public.articulos ar
    join public.articulos r on r.id = ${m.ruleta}
   where ar.asignatura_id = r.asignatura_id and ar.periodo_id = r.periodo_id
     and ar.activo and ar.requiere_aprobacion and ar.codigo <> 'ruleta-nota'
   order by ar.precio asc limit 1`;
if (!otro) throw new Error('No hay un artículo con aprobación distinto de la ruleta.');

console.log(`Ramo ${m.sigla} · sección ${m.seccion_codigo} · ruleta a ${m.precio} puntos`);

// Los canjes de verdad que hay en la ruleta: no se tocan. Se toma una foto para
// comprobar al final que siguen igual.
const fotoReales = async () => await dueno`
  select c.id, c.estado, c.precio_pagado, c.comentario_docente, c.resuelto_en, c.ruleta_nota
    from public.canjes c
   where c.matricula_id <> ${m.matricula}
     and c.articulo_id in (select id from public.articulos where codigo = 'ruleta-nota')
   order by c.id`;
const antesReales = await fotoReales();
console.log(`Canjes reales de la ruleta (no se tocan): ${antesReales.map((c) => `#${c.id} ${c.estado}`).join(', ') || 'ninguno'}`);

const limpiar = async () => {
  await dueno`delete from public.canjes
               where matricula_id = ${m.matricula} and nota_alumno = ${NOTA}`;
};
await limpiar();
const [{ id: piso }] = await dueno`select coalesce(max(id),0) as id
   from public.movimientos_puntos where matricula_id = ${m.matricula}`;
const limpiarTodo = async () => {
  await limpiar();
  await dueno`delete from public.movimientos_puntos
               where matricula_id = ${m.matricula} and (id > ${piso} or motivo = ${MOTIVO})`;
};
await limpiarTodo();

const saldo = async () => {
  const [r] = await dueno`select coalesce(sum(puntos),0)::int as p
     from public.movimientos_puntos where matricula_id = ${m.matricula}`;
  return r.p;
};
const saldoOriginal = await saldo();

/** Un canje solicitado de la ruleta que no pasa por `solicitar_canje` (tope de uno por alumno). */
const fixture = async (articulo = m.ruleta, precio = m.precio) => {
  const [r] = await dueno`
    insert into public.canjes (articulo_id, matricula_id, estado, precio_pagado, nota_alumno)
    values (${articulo}, ${m.matricula}, 'solicitado', ${precio}, ${NOTA})
    returning id`;
  return r.id;
};
const canje = async (id) => (await dueno`select * from public.canjes where id = ${id}`)[0];

try {
  // Que le alcance para canjear, pase lo que pase con su saldo real.
  await dueno`insert into public.movimientos_puntos (matricula_id, puntos, motivo)
              values (${m.matricula}, ${m.precio * 3}, ${MOTIVO})`;

  // ---------- Los tramos ----------

  console.log('\nLos tramos');
  const tramos = await dueno`select nota::text as nota, peso from public.ruleta_tramos order by orden`;
  rev('cinco tramos', tramos.length, 5);
  rev('suman mil', tramos.reduce((n, t) => n + t.peso, 0), 1000);
  rev('con los pesos de la tienda',
    Object.fromEntries(tramos.map((t) => [t.nota, t.peso]).sort((x, y) => x[0].localeCompare(y[0]))),
    ESPERADO);
  const [vista] = await dueno`select count(*)::int as n from information_schema.columns
     where table_name = 'canjes_detalle' and column_name in ('ruleta_nota','ruleta_en')`;
  rev('canjes_detalle trae las dos columnas nuevas', vista.n, 2);

  // ---------- El sorteo ----------

  console.log(`\nEl sorteo (${SORTEOS} llamadas a ruleta_sortear, sin tocar canjes)`);
  const conteo = await dueno`
    select n::text as nota, count(*)::int as veces
      from (select public.ruleta_sortear() as n from generate_series(1, ${SORTEOS}::int)) x
     group by n order by n`;
  const hallado = Object.fromEntries(conteo.map((r) => [r.nota, r.veces]));
  for (const [nota, peso] of Object.entries(ESPERADO)) {
    const p = peso / 1000;
    const esperado = SORTEOS * p;
    const sigma = Math.sqrt(SORTEOS * p * (1 - p));
    const veces = hallado[nota] ?? 0;
    verdad(`nota ${nota.replace('.', ',')}: ${veces} de ${SORTEOS} (${(veces / SORTEOS * 100).toFixed(2)}%)`,
      Math.abs(veces - esperado) <= 5 * sigma,
      `esperaba ${esperado} ± ${(5 * sigma).toFixed(0)}`);
  }
  rev('y no sale ninguna otra nota', Object.keys(hallado).sort(), Object.keys(ESPERADO).sort());

  // ---------- Lo que no puede hacer un alumno ----------

  console.log('\nLo que un alumno no puede hacer');
  const idA = await como(alumno.id, (s) =>
    s`select public.solicitar_canje(${m.matricula}::uuid, ${m.ruleta}::uuid, ${NOTA}) as id`)
    .then((r) => r[0].id);
  const saldoConA = await saldo();
  rev('solicitar la ruleta descuenta el precio', saldoConA, saldoOriginal + m.precio * 3 - m.precio);
  await debeFallar('el alumno no la tira', alumno.id, (s) =>
    s`select public.tirar_ruleta(${idA}::bigint)`, 'no es de una sección que dictes');
  await debeFallar('no puede pedir sorteos sueltos', alumno.id, (s) =>
    s`select public.ruleta_sortear()`, 'permission denied');
  await debeFallar('ni el docente', docente.id, (s) =>
    s`select public.ruleta_sortear()`, 'permission denied');
  rev('y el canje sigue solicitado', (await canje(idA)).estado, 'solicitado');

  // ---------- «Entregar» a secas no vale ----------

  console.log('\nLa ruleta se resuelve tirándola');
  await debeFallar('entregar no la cierra', docente.id, (s) =>
    s`select public.resolver_canje(${idA}::bigint, 'entregado', 'a dedo')`,
    'La ruleta se resuelve tirándola');
  await debeFallar('aprobar tampoco', docente.id, (s) =>
    s`select public.resolver_canje(${idA}::bigint, 'aprobado', null)`,
    'La ruleta se resuelve tirándola');
  rev('el canje sigue solicitado', (await canje(idA)).estado, 'solicitado');

  // ---------- Rechazar sigue devolviendo ----------

  console.log('\nRechazar sigue devolviendo los puntos');
  await como(docente.id, (s) =>
    s`select public.resolver_canje(${idA}::bigint, 'rechazado', 'La EP2 ya pasó')`);
  const a = await canje(idA);
  rev('queda rechazado', a.estado, 'rechazado');
  rev('con su comentario', a.comentario_docente, 'La EP2 ya pasó');
  rev('sin nota de ruleta', a.ruleta_nota, null);
  rev('el saldo vuelve a donde estaba antes de pedirla', await saldo(), saldoOriginal + m.precio * 3);
  await debeFallar('un canje rechazado no se tira', docente.id, (s) =>
    s`select public.tirar_ruleta(${idA}::bigint)`, 'ya no está esperando: está rechazado');

  // ---------- Que no se tire sobre otro artículo ----------

  console.log('\nSolo la ruleta se tira');
  const idO = await fixture(otro.id, otro.precio);
  await debeFallar('un canje de otro artículo no se tira', docente.id, (s) =>
    s`select public.tirar_ruleta(${idO}::bigint)`, 'no es de la ruleta');
  await debeFallar('un canje que no existe', docente.id, (s) =>
    s`select public.tirar_ruleta(-1::bigint)`, 'no existe');
  rev('el otro canje sigue solicitado', (await canje(idO)).estado, 'solicitado');

  // ---------- Tirarla ----------

  console.log('\nTirarla');
  const idB = await como(alumno.id, (s) =>
    s`select public.solicitar_canje(${m.matricula}::uuid, ${m.ruleta}::uuid, ${NOTA}) as id`)
    .then((r) => r[0].id);
  const saldoConB = await saldo();
  const [{ r }] = await como(docente.id, (s) =>
    s`select public.tirar_ruleta(${idB}::bigint) as r`);
  verdad('devuelve una nota de la rueda', Object.keys(ESPERADO).includes(Number(r.nota).toFixed(1)),
    String(r.nota));
  rev('con los cinco tramos, en el orden de la rueda',
    r.tramos.map((t) => [Number(t.nota).toFixed(1), t.peso]),
    [['1.0', 500], ['6.0', 8], ['4.0', 400], ['7.0', 2], ['5.0', 90]]);
  rev('y el canje que quedó', [String(r.canje.id), r.canje.estado, Number(r.canje.ruleta_nota)],
    [String(idB), 'entregado', Number(r.nota)]);

  const b = await canje(idB);
  rev('queda entregado', b.estado, 'entregado');
  rev('con la nota guardada', Number(b.ruleta_nota), Number(r.nota));
  verdad('y cuándo se tiró', b.ruleta_en !== null);
  rev('firmado por el docente', b.resuelto_por, docente.id);
  verdad('resuelto_en puesto', b.resuelto_en !== null);
  rev('el alumno lee el resultado',
    b.comentario_docente,
    `La ruleta salió ${Number(r.nota).toFixed(1).replace('.', ',')} · se aplica a «${NOTA}»`);
  rev('los puntos no vuelven', await saldo(), saldoConB);

  const [det] = await como(docente.id, (s) =>
    s`select ruleta_nota::float8 as n, articulo_codigo from public.canjes_detalle where id = ${idB}::bigint`);
  rev('canjes_detalle lo muestra al docente', [det.n, det.articulo_codigo], [Number(r.nota), 'ruleta-nota']);

  // ---------- Una sola vez ----------

  console.log('\nUna sola vez');
  await debeFallar('el segundo giro falla', docente.id, (s) =>
    s`select public.tirar_ruleta(${idB}::bigint)`, 'ya no está esperando: está entregado');
  rev('y la nota no cambió', Number((await canje(idB)).ruleta_nota), Number(r.nota));
  await debeFallar('no se puede rechazar lo ya tirado', docente.id, (s) =>
    s`select public.resolver_canje(${idB}::bigint, 'rechazado', null)`,
    'No se puede rechazar algo ya entregado');
  await debeFallar('el alumno no cancela lo ya tirado', alumno.id, (s) =>
    s`select public.cancelar_canje(${idB}::bigint)`, 'Ya no se puede cancelar');
  rev('el saldo sigue igual', await saldo(), saldoConB);

  // ---------- Dos clics a la vez ----------

  console.log('\nDos giros simultáneos');
  const RONDAS = 4;
  let unicas = 0, mismaNota = 0;
  for (let i = 0; i < RONDAS; i++) {
    const id = await fixture();
    const res = await Promise.allSettled([1, 2].map(() =>
      como(docente.id, (s) => s`select public.tirar_ruleta(${id}::bigint) as r`)));
    const ok = res.filter((x) => x.status === 'fulfilled');
    const mal = res.filter((x) => x.status === 'rejected');
    if (ok.length === 1 && mal.length === 1 &&
        (mal[0].reason.message ?? '').includes('ya no está esperando')) unicas++;
    const fila = await canje(id);
    if (ok.length === 1 && Number(ok[0].value[0].r.nota) === Number(fila.ruleta_nota)) mismaNota++;
  }
  rev(`en ${RONDAS} rondas siempre gana uno solo y el otro espera y falla`, unicas, RONDAS);
  rev('y la nota guardada es la del que ganó', mismaNota, RONDAS);

  // ---------- Tirar contra cancelar ----------

  console.log('\nTirar contra cancelar');
  let coherentes = 0, tiraron = 0, cancelaron = 0;
  const RONDAS_CANCELAR = 12;
  for (let i = 0; i < RONDAS_CANCELAR; i++) {
    const id = await fixture();
    const antes = await saldo();
    // El que cancela sale con un desfase al azar: así a veces llega antes que el giro
    // y a veces después, y se prueban las dos mitades de la carrera.
    const retraso = Math.floor(Math.random() * 120);
    const res = await Promise.allSettled([
      como(docente.id, (s) => s`select public.tirar_ruleta(${id}::bigint) as r`),
      new Promise((ok) => setTimeout(ok, retraso)).then(() =>
        como(alumno.id, (s) => s`select public.cancelar_canje(${id}::bigint)`)),
    ]);
    const fila = await canje(id);
    const despues = await saldo();
    const unoSolo = res.filter((x) => x.status === 'fulfilled').length === 1;
    const conNota = fila.estado === 'entregado' && fila.ruleta_nota !== null && despues === antes;
    const sinNota = fila.estado === 'cancelado' && fila.ruleta_nota === null && despues === antes + m.precio;
    if (unoSolo && (conNota || sinNota)) coherentes++;
    if (conNota) tiraron++; else if (sinNota) cancelaron++;
  }
  rev(`en ${RONDAS_CANCELAR} rondas nunca quedan la nota y los puntos juntos ` +
      `(tiró ${tiraron}, canceló ${cancelaron})`, coherentes, RONDAS_CANCELAR);
} finally {
  await limpiarTodo();
}

// ---------- Que no quede nada ----------

console.log('\nLo que queda');
const [{ n: restos }] = await dueno`select count(*)::int as n from public.canjes
   where matricula_id = ${m.matricula} and nota_alumno = ${NOTA}`;
rev('ningún canje de la prueba', restos, 0);
rev('el saldo es el de antes', await saldo(), saldoOriginal);
rev('los canjes reales de la ruleta, intactos', JSON.stringify(await fotoReales()),
  JSON.stringify(antesReales));

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
