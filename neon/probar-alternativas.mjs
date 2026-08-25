/**
 * Dos laboratorios alternativos: se hace uno o el otro, y el que ya cobró no pierde.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-alternativas.mjs
 *
 * Crea un par de laboratorios de mentira —ZZA y ZZB—, los declara alternativos, y
 * prueba las puertas con la identidad del alumno de prueba y el rol `pulso_app`.
 * Los borra al terminar, y comprueba que quedaron borrados.
 *
 * ── Qué se vigila, y por qué cada cosa ──
 *
 * La regla se pidió con una condición que es la mitad del trabajo: **quien ya
 * entregó conserva sus puntos**. Así que no basta con comprobar que el segundo se
 * cierre; hay que comprobar que el primero siga siendo del alumno —que pueda
 * leerlo, ver sus respuestas y pedir sugerencia— porque cerrarle su propio trabajo
 * sería peor que no haber puesto la regla.
 *
 * Y se vigila que el candado esté en **las tres puertas de escritura** y no solo en
 * la pantalla: la dirección se escribe a mano y las funciones se alcanzan por la
 * Data API. Un candado que solo esconde el botón no es un candado.
 */
import { neon } from '@neondatabase/serverless';

const CORREO = 'alumno.prueba@duocuc.cl';
const d = neon(process.env.DATABASE_URL_OWNER);

let fallos = 0;
const rev = (e, real, esp) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(real)}` +
    (ok ? '' : ` ← esperaba ${JSON.stringify(esp)}`));
};

const [alumno] = await d`select id from public.usuarios where lower(correo) = ${CORREO}`;
if (!alumno) throw new Error(`No existe ${CORREO}.`);
const [m] = await d`
  select mt.id, s.asignatura_id, s.periodo_id
    from public.matriculas mt
    join public.secciones s on s.id = mt.seccion_id
    join public.asignaturas g on g.id = s.asignatura_id
   where mt.perfil_id = ${alumno.id} and mt.activa and g.sigla = 'DSY1107'
   limit 1`;
if (!m) throw new Error('El alumno de prueba no tiene matrícula en DSY1107.');

const CAJA = [{ tipo: 'caja', id: '1.1', formato: 'corta', enunciado: '<p>Una caja.</p>' }];

/**
 * Una consulta con la identidad del alumno y el rol de la aplicación.
 *
 * Va en una transacción de tres sentencias y no con un `begin` a mano: el driver de
 * Neon habla **HTTP**, así que cada consulta suelta es su propia transacción y un
 * `set local role` no sobrevive a la siguiente. Es el mismo helper que usa
 * `probar-gacha.mjs`, y la primera versión de esta prueba se estrelló justamente
 * por no usarlo.
 */
async function como(consulta) {
  const r = await d.transaction([
    d`select set_config('pulso.usuario_id', ${alumno.id}, true)`,
    d`set local role pulso_app`,
    consulta(d),
  ]);
  return r[2] ?? [];
}

/** Lo que hay que borrar al final, por lo mismo: no hay transacción que deshacer. */
const limpiar = async () => {
  await d`delete from public.actividades a
           where a.codigo in ('ZZA','ZZB') and a.asignatura_id = ${m.asignatura_id}`;
};
await limpiar();

try {
  // Dos laboratorios de mentira, alternativos entre sí. Solo uno declara `excluye`:
  // así se comprueba de paso que la exclusión se lee en las dos direcciones.
  const actividades = {};
  for (const [codigo, orden, excluye] of [['ZZA', 901, 'ZZB'], ['ZZB', 902, null]]) {
    const [a] = await d`
      insert into public.actividades (asignatura_id, periodo_id, codigo, titulo,
                                      tipo, puntos, orden, activa)
      values (${m.asignatura_id}, ${m.periodo_id}, ${codigo}, ${'Prueba ' + codigo},
              'laboratorio', 100, ${orden}, true)
      returning id`;
    await d`
      insert into public.laboratorios (actividad_id, bloques, minutos, cajas, controles,
                                       opcional, requiere, excluye)
      values (${a.id}, ${JSON.stringify(CAJA)}::jsonb, 60, 1, 0, false, null, ${excluye})`;
    actividades[codigo] = a.id;
  }

  const estado = async (codigo) => {
    const filas = await como((s) =>
      s`select * from public.mis_laboratorios(${m.id}::uuid) where codigo = ${codigo}`);
    return filas[0];
  };
  const falla = async (etiqueta, consulta, contiene) => {
    try {
      await como(consulta);
      fallos++;
      console.log(`  ✗ ${etiqueta}: no falló, y tenía que fallar`);
    } catch (e) {
      const ok = (e.message ?? '').includes(contiene);
      if (!ok) fallos++;
      console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: «${e.message}»` +
        (ok ? '' : `  ← esperaba «${contiene}»`));
    }
  };

  // ---------- Antes de elegir, los dos están abiertos ----------
  console.log('Antes de elegir');
  rev('ZZA se declara alternativa de ZZB', (await estado('ZZA')).excluye, 'ZZB');
  rev('y ZZB también, sin declararlo: se lee en los dos sentidos',
    (await estado('ZZB')).excluye, null);
  rev('ninguno está cerrado',
    [(await estado('ZZA')).cerrado_por, (await estado('ZZB')).cerrado_por], [null, null]);
  const [{ r: bloquesA }] = await como((s) =>
    s`select jsonb_array_length((public.mi_laboratorio(${m.id}::uuid, 'ZZA'))->'bloques') as r`);
  rev('el enunciado de ZZA baja completo', bloquesA, 1);
  const [{ r: bloquesB }] = await como((s) =>
    s`select jsonb_array_length((public.mi_laboratorio(${m.id}::uuid, 'ZZB'))->'bloques') as r`);
  rev('y el de ZZB también', bloquesB, 1);

  // ---------- Se elige uno ----------
  console.log('\nSe entrega ZZA');
  await como((s) => s`select public.laboratorio_guardar(${m.id}::uuid, 'ZZA',
              ${JSON.stringify({ '1.1': 'lo hice' })}::jsonb, 0)`);
  const [{ r: entrega }] = await como((s) =>
    s`select public.laboratorio_entregar(${m.id}::uuid, 'ZZA') as r`);
  rev('paga sus puntos', entrega.puntos, 100);

  // ---------- Y el otro se cierra ----------
  console.log('\nEl otro queda cerrado');
  rev('ZZB dice quién lo cerró', (await estado('ZZB')).cerrado_por, 'ZZA');
  const [{ r: bloquesCerrado }] = await como((s) =>
    s`select jsonb_array_length((public.mi_laboratorio(${m.id}::uuid, 'ZZB'))->'bloques') as r`);
  rev('y su enunciado ya no baja', bloquesCerrado, 0);

  // Las tres puertas de escritura, que es donde de verdad importa: la pantalla se
  // puede saltar escribiendo la dirección, y las funciones se alcanzan por la Data API.
  await falla('no se puede escribir en el cerrado',
    (s) => s`select public.laboratorio_guardar(${m.id}::uuid, 'ZZB', '{}'::jsonb, 0)`,
    'se hace uno o el otro');
  await falla('no se puede entregar el cerrado',
    (s) => s`select public.laboratorio_entregar(${m.id}::uuid, 'ZZB')`,
    'se hace uno o el otro');
  await falla('no se puede pedir sugerencia en el cerrado',
    (s) => s`select public.laboratorio_revisar_guardar(${m.id}::uuid, 'ZZB', '1.1',
                'logrado', 'x', 'y')`,
    'se hace uno o el otro');

  // ---------- Lo que ya es suyo sigue siendo suyo ----------
  // La otra mitad de lo que se pidió. Si esto falla, la regla le quitó al alumno
  // trabajo que ya había entregado y cobrado, que es el peor resultado posible.
  console.log('\nLo que ya entregó sigue siendo suyo');
  rev('ZZA no se cerró a sí mismo', (await estado('ZZA')).cerrado_por, null);
  const [{ r: mio }] = await como((s) =>
    s`select public.mi_laboratorio(${m.id}::uuid, 'ZZA') as r`);
  rev('sigue bajando su enunciado', mio.bloques.length, 1);
  rev('con lo que escribió', mio.respuestas['1.1'], 'lo hice');
  rev('y marcado como entregado', mio.entregado_en !== null, true);
  const [{ r: sug }] = await como((s) =>
    s`select public.laboratorio_revisar_guardar(${m.id}::uuid, 'ZZA', '1.1',
             'logrado', 'bien', 'h1') as r`);
  rev('todavía puede pedir sugerencia sobre lo suyo', sug.veredicto, 'logrado');

  // Y los puntos: la exclusión no los toca.
  const [{ n: pagados }] = await d`
    select count(*)::int as n from public.resultados_actividad
     where matricula_id = ${m.id} and actividad_id = ${actividades.ZZA}`;
  rev('el resultado que paga sigue en pie', pagados, 1);
} finally {
  await limpiar();
}

// Que la limpieza de verdad limpió. El `on delete cascade` de `actividades` se
// lleva los laboratorios, el avance y el resultado que pagó.
const [{ n }] = await d`select count(*)::int as n from public.actividades
   where codigo in ('ZZA','ZZB')`;
rev('la prueba no dejó nada en la base', n, 0);

console.log(fallos === 0 ? '\nTodo bien: se hace uno o el otro, y el que cobró no pierde.'
                         : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
