/**
 * Prueba de punta a punta del recorrido de una clase, con el alumno de prueba.
 *
 * No simula nada: llama a las mismas funciones de Postgres que llaman
 * `/api/clase` y `/api/clase-avance`, con la misma identidad puesta de la misma
 * forma, y como el mismo rol `pulso_app` con RLS aplicado. Lo único que no
 * ejercita es el HTTP y el navegador.
 *
 * Empieza borrando el progreso del alumno de prueba en esa clase para que la
 * corrida sea repetible, y deja el estado final tal como quedaría un alumno que
 * recorrió la clase completa.
 *
 *   node neon/probar-clase.mjs [--sigla DSY1107] [--codigo S01]
 */
import { neon } from '@neondatabase/serverless';
import { get } from '@vercel/blob';
import { instrumentar } from '../lib/rastreo-clase.mjs';

const CORREO = 'alumno.prueba@duocuc.cl';
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const SIGLA = args.sigla ?? 'DSY1107';
const CODIGO = args.codigo ?? 'S01';

const dueno = neon(process.env.DATABASE_URL_OWNER);
const app = neon(process.env.DATABASE_URL);

let fallos = 0;
function revisar(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`));
}

/** Igual que `lib/identidad.mjs`: identidad a mano, local a la transacción. */
async function comoAlumno(usuarioId, consulta) {
  const r = await app.transaction([
    app`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    consulta(app),
  ]);
  return r[1] ?? [];
}

// ---------- Preparación ----------

const [alumno] = await dueno`
  select u.id, p.nombre from public.usuarios u
    join public.perfiles p on p.id = u.id
   where lower(u.correo) = ${CORREO}`;
if (!alumno) throw new Error(`No existe ${CORREO}. Créalo antes de probar.`);

const [clase] = await dueno`
  select c.id, c.titulo, c.slides, c.actividades, c.pauta, c.archivo,
         c.puntos_abrir, c.puntos_actividad, c.puntos_terminar, c.segundos_minimos
    from public.clases c join public.asignaturas a on a.id = c.asignatura_id
   where a.sigla = ${SIGLA} and c.codigo = ${CODIGO}`;
if (!clase) throw new Error(`No existe la clase ${SIGLA}/${CODIGO}.`);

const [matricula] = await dueno`
  select mt.id, s.codigo as seccion from public.matriculas mt
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
   where mt.perfil_id = ${alumno.id} and a.sigla = ${SIGLA}`;
if (!matricula) throw new Error(`${CORREO} no está matriculado en ${SIGLA}.`);

console.log(`Alumno  ${alumno.nombre} · ${CORREO}`);
console.log(`Ramo    ${SIGLA} sección ${matricula.seccion} · matrícula ${matricula.id}`);
console.log(`Clase   ${CODIGO} · ${clase.titulo} · ${clase.slides} slides · ${clase.actividades} actividades`);
console.log(`Puntos  abrir ${clase.puntos_abrir} · actividad ${clase.puntos_actividad} · terminar ${clase.puntos_terminar}`);
console.log(`Pauta   ${JSON.stringify(clase.pauta)}\n`);

// Estado limpio, para que la corrida sea repetible.
await dueno`delete from public.progreso_clase
             where matricula_id = ${matricula.id} and clase_id = ${clase.id}`;
await dueno`delete from public.movimientos_puntos
             where matricula_id = ${matricula.id}
               and (motivo like ${'%clase ' + CODIGO + '%'} or motivo like ${'%de ' + CODIGO})`;

const saldoDe = async () => {
  const [f] = await dueno`select coalesce(sum(puntos),0)::int as s
                            from public.movimientos_puntos where matricula_id = ${matricula.id}`;
  return f.s;
};
const saldoInicial = await saldoDe();
console.log(`Saldo inicial: ${saldoInicial}\n`);

// ---------- 1. Abrir ----------

console.log('1. Abrir la clase por primera vez');
const [a1] = await comoAlumno(alumno.id, (s) =>
  s`select public.abrir_clase(${clase.id}::uuid) as r`);
revisar('puntos por abrir', a1.r.puntos_nuevos, clase.puntos_abrir);
revisar('trae la ruta del archivo', typeof a1.r.archivo === 'string' && a1.r.archivo.length > 0, true);
revisar('saldo', await saldoDe(), saldoInicial + clase.puntos_abrir);

console.log('\n2. Abrirla de nuevo no vuelve a pagar');
const [a2] = await comoAlumno(alumno.id, (s) =>
  s`select public.abrir_clase(${clase.id}::uuid) as r`);
revisar('puntos por reabrir', a2.r.puntos_nuevos, 0);
revisar('saldo sin cambios', await saldoDe(), saldoInicial + clase.puntos_abrir);

// ---------- 3. Responder mal ----------

const llaves = Object.keys(clase.pauta);
const malas = Object.fromEntries(llaves.map((k) => [k, clase.pauta[k] === 'a' ? 'b' : 'a']));

console.log('\n3. Responder todas mal no paga');
const [m1] = await comoAlumno(alumno.id, (s) =>
  s`select public.progreso_clase_guardar(${clase.id}::uuid, 3::integer,
             ${JSON.stringify(malas)}::jsonb) as r`);
revisar('puntos', m1.r.puntos_nuevos, 0);
revisar('aciertos', m1.r.aciertos, 0);

// ---------- 4. Responder bien una ----------

console.log('\n4. Acertar la primera actividad');
const una = { [llaves[0]]: clase.pauta[llaves[0]] };
const [b1] = await comoAlumno(alumno.id, (s) =>
  s`select public.progreso_clase_guardar(${clase.id}::uuid, 5::integer,
             ${JSON.stringify(una)}::jsonb) as r`);
revisar('puntos', b1.r.puntos_nuevos, clase.puntos_actividad);
revisar('aciertos', b1.r.aciertos, 1);

console.log('\n5. Reenviar la misma respuesta no vuelve a pagar');
const [b2] = await comoAlumno(alumno.id, (s) =>
  s`select public.progreso_clase_guardar(${clase.id}::uuid, 6::integer,
             ${JSON.stringify(una)}::jsonb) as r`);
revisar('puntos', b2.r.puntos_nuevos, 0);
revisar('aciertos', b2.r.aciertos, 1);

// ---------- 6. Basura ----------

console.log('\n6. Basura en las respuestas no revienta ni paga');
const basura = { hola: 'x', '99999': 'z', '-1': 'a', '': 'b' };
const [g1] = await comoAlumno(alumno.id, (s) =>
  s`select public.progreso_clase_guardar(${clase.id}::uuid, 6::integer,
             ${JSON.stringify(basura)}::jsonb) as r`);
revisar('puntos', g1.r.puntos_nuevos, 0);

// ---------- 7. Terminar demasiado rápido ----------

console.log('\n7. Saltar al final antes del mínimo no paga el término');
const todas = { ...clase.pauta };
const [t1] = await comoAlumno(alumno.id, (s) =>
  s`select public.progreso_clase_guardar(${clase.id}::uuid, ${clase.slides - 1}::integer,
             ${JSON.stringify(todas)}::jsonb) as r`);
// Paga las 2 actividades que faltaban, pero NO los puntos de terminar.
revisar('puntos (solo las actividades que faltaban)', t1.r.puntos_nuevos,
  (clase.actividades - 1) * clase.puntos_actividad);
revisar('terminada', t1.r.terminada, false);
revisar('aciertos', t1.r.aciertos, clase.actividades);

// ---------- 8. Terminar de verdad ----------

console.log(`\n8. Con el tiempo cumplido (${clase.segundos_minimos}s) sí paga el término`);
// Envejecemos la apertura en vez de esperar: es el mismo cálculo.
await dueno`update public.progreso_clase
               set abierta_en = now() - make_interval(secs => ${clase.segundos_minimos + 5})
             where matricula_id = ${matricula.id} and clase_id = ${clase.id}`;
const [t2] = await comoAlumno(alumno.id, (s) =>
  s`select public.progreso_clase_guardar(${clase.id}::uuid, ${clase.slides - 1}::integer,
             ${JSON.stringify(todas)}::jsonb) as r`);
revisar('puntos por terminar', t2.r.puntos_nuevos, clase.puntos_terminar);
revisar('terminada', t2.r.terminada, true);

console.log('\n9. Terminarla otra vez no paga');
const [t3] = await comoAlumno(alumno.id, (s) =>
  s`select public.progreso_clase_guardar(${clase.id}::uuid, ${clase.slides - 1}::integer,
             ${JSON.stringify(todas)}::jsonb) as r`);
revisar('puntos', t3.r.puntos_nuevos, 0);

const esperado = saldoInicial + clase.puntos_abrir
  + clase.actividades * clase.puntos_actividad + clase.puntos_terminar;
revisar('saldo final', await saldoDe(), esperado);

// ---------- 10. La vista no filtra secretos ----------

console.log('\n10. `mis_clases` no expone el archivo ni la pauta');
const vista = await comoAlumno(alumno.id, (s) =>
  s`select * from public.mis_clases where id = ${clase.id}::uuid`);
revisar('trae la fila', vista.length, 1);
const columnas = Object.keys(vista[0] ?? {});
revisar('sin columna archivo', columnas.includes('archivo'), false);
revisar('sin columna pauta', columnas.includes('pauta'), false);
revisar('avance visible', vista[0]?.slide_max, clase.slides - 1);
revisar('resueltas', vista[0]?.resueltas, clase.actividades);

console.log('\n11. Como pulso_app, leer `clases.archivo` o `clases.pauta` está prohibido');
// El nombre de una columna no se puede parametrizar, así que van escritas.
const prohibidas = [
  ['archivo', () => comoAlumno(alumno.id, (s) => s`select archivo from public.clases limit 1`)],
  ['pauta', () => comoAlumno(alumno.id, (s) => s`select pauta from public.clases limit 1`)],
];
for (const [col, intento] of prohibidas) {
  try {
    const q = await intento();
    console.log(`  ✗ ${col}: se pudo leer → ${JSON.stringify(q).slice(0, 60)}`);
    fallos++;
  } catch (e) {
    const ok = /permission denied|permiso/i.test(e.message);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✓' : '✗'} ${col}: ${e.message.split('\n')[0].slice(0, 70)}`);
  }
}

// ---------- 12. El archivo y la inyección ----------

console.log('\n12. El deck se puede traer del Blob y queda instrumentado');
const blob = await get(clase.archivo, { access: 'private' });
const html = await new Response(blob.stream).text();
revisar('bajó del blob', html.length > 100000, true);
revisar('sigue siendo el mismo archivo', html.includes('<title>'), true);
const salida = instrumentar(html, { claseId: clase.id, docente: false, slides: clase.slides });
revisar('creció solo lo del script', salida.length - html.length < 6000, true);

// El módulo puede estar bien y el script emitido roto: el guion se arma con un
// template literal, y basta un backtick en un comentario para cerrarlo antes de
// tiempo. Pasó una vez y tumbó `/api/clase` con un 500. Así que se parsea.
const emitido = salida.slice(salida.indexOf('<script data-pulso="rastreo">') + 29,
                             salida.lastIndexOf('</script>'));
try {
  new Function(emitido);
  revisar('el script emitido parsea', true, true);
} catch (e) {
  revisar(`el script emitido parsea (${e.message})`, false, true);
}
revisar('sin backticks sueltos en el script', emitido.includes('`'), false);
revisar('el script quedó antes de </body>',
  salida.lastIndexOf('data-pulso="rastreo"') < salida.lastIndexOf('</body>'), true);
revisar('lleva el id de la clase', salida.includes(clase.id), true);
revisar('fuerza el modo estudio', salida.includes("cambiarModo('estudio')"), true);
revisar('el deck original no trae rastreo', html.includes('data-pulso="rastreo"'), false);
const docente = instrumentar(html, { claseId: clase.id, docente: true, slides: clase.slides });
revisar('al docente no se le rastrea', docente.includes('DOCENTE = true'), true);

console.log(fallos === 0
  ? `\nTodo bien: ${(await saldoDe()) - saldoInicial} puntos ganados en el recorrido completo.`
  : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
