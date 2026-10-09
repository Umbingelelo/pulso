/**
 * Las cinco mecánicas de la misión diaria, contra la base de verdad.
 *
 * Por cada mecánica: genera **una** misión (con el modelo real donde corresponde),
 * la registra con el rol generador, la responde con la identidad del alumno y el
 * RLS puesto, y comprueba que se corrige —mal sin pagar, bien pagando 75—. Aparte:
 *
 *   * que `pulso_app` no puede calificar, leer la pauta ni inscribirse misiones;
 *   * que `desarrollo` no se cobra por `mision_responder` y que, si el modelo
 *     falla, la misión queda sin responder;
 *   * el escalón del pago (logrado / parcial / incompleto = 75 / 37 / 0);
 *   * que `/api/mision` rota (nunca la misma de ayer) y cae a `emparejar` cuando
 *     el modelo no está;
 *   * los validadores anti-sesgo y la rotación, sin gastar un token.
 *
 * Al final imprime los tokens y el costo medidos por mecánica, y limpia: borra las
 * misiones y la experiencia del alumno de prueba.
 *
 * Los handlers de `api/` se llaman en el mismo proceso, con una cookie firmada con
 * un secreto de prueba (los de producción son Sensitive y no se pueden leer). El
 * `comoUsuario` de esos handlers usa aquí el rol dueño con la identidad puesta, no
 * `pulso_app`: las funciones de las misiones son `security definer` y deciden por
 * `usuario_actual()`, así que la lógica que se ejercita es la misma.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-misiones-variadas.mjs
 */
import { Readable } from 'node:stream';
import { neon } from '@neondatabase/serverless';

const CORREO = 'alumno.prueba@duocuc.cl';
const SIGLA = 'DSY1107';

process.env.SESION_SECRETO = 'secreto-de-prueba-solo-local';
process.env.DATABASE_URL = process.env.DATABASE_URL_OWNER;
const KEY_REAL = process.env.OPENROUTER_API_KEY;

const { generar, elegirMecanica, respaldo, MECANICAS, PESOS } = await import('../lib/misiones.mjs');
const quiz = await import('../lib/mecanicas/quiz.mjs');
const vf = await import('../lib/mecanicas/verdadero_falso.mjs');
const diagrama = await import('../lib/mecanicas/diagrama.mjs');
const emparejar = await import('../lib/mecanicas/emparejar.mjs');
const desarrollo = await import('../lib/mecanicas/desarrollo.mjs');
const { firmarRefresco } = await import('../lib/sesion.mjs');
const handlerMision = (await import('../api/mision.mjs')).default;
const handlerResponder = (await import('../api/mision-responder.mjs')).default;

const d = neon(process.env.DATABASE_URL_OWNER);
const g = neon(process.env.DATABASE_URL_MISIONES);

let fallos = 0;
const revisar = (e, r, x) => {
  const ok = JSON.stringify(r) === JSON.stringify(x);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(r)}${ok ? '' : ` ← esperaba ${JSON.stringify(x)}`}`);
};
const cierto = (e, c, dato = '') => revisar(e + (dato ? ` (${dato})` : ''), !!c, true);
const info = (e, v) => console.log(`  · ${e}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);

const [alumno] = await d`select id from public.usuarios where correo = ${CORREO}`;
const [mat] = await d`
  select mt.id from public.matriculas mt
    join public.usuarios    u on u.id = mt.perfil_id
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
   where lower(u.correo) = ${CORREO} and a.sigla = ${SIGLA}`;
const [{ xp: XP }] = await d`select xp from public.mision_plantillas where codigo = 'quiz'`;

/** Como la aplicación: identidad puesta a mano y el rol de la app adoptado. */
const como = async (q) => (await d.transaction([
  d`select set_config('pulso.usuario_id', ${alumno.id}, true)`,
  d`set local role pulso_app`,
  q(d),
]))[2] ?? [];

const limpiar = async () => {
  await d`delete from public.misiones where matricula_id = ${mat.id}`;
  await d`delete from public.movimientos_experiencia where matricula_id = ${mat.id}`;
};

/** Deja la misión como recién creada, para poder responderla otra vez. */
const reabrir = async (id, quitar = []) => {
  await d`update public.misiones
             set resuelta_en = null, acertada = null, intentos = 0,
                 solucion = solucion - 'respuesta' - 'veredicto' - 'xp_ganada'
                          - ${quitar.includes('explicacion') ? 'explicacion' : 'sin_explicacion'}
           where id = ${id}`;
  await d`delete from public.movimientos_experiencia where matricula_id = ${mat.id}`;
};

const xpTotal = async () =>
  (await d`select coalesce(sum(xp),0)::int x from public.movimientos_experiencia where matricula_id = ${mat.id}`)[0].x;

/** Un par request/response de mentira para llamar a los handlers de `api/`. */
async function llamar(handler, { metodo = 'POST', url, cuerpo }) {
  const cookie = `pulso_sesion=${encodeURIComponent(await firmarRefresco(alumno.id))}`;
  const req = Object.assign(Readable.from([]), {
    method: metodo, url, headers: { host: 'localhost', cookie }, body: cuerpo ?? {},
  });
  return await new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(txt) { resolve({ estado: this.statusCode, cuerpo: txt ? JSON.parse(txt) : null }); },
    };
    handler(req, res);
  });
}

/** El contexto que arma `/api/mision`, pero con la mecánica elegida a mano. */
async function contexto() {
  const [c] = await como((s) => s`select public.termino_para_mision(${mat.id}::uuid) as t`);
  const [p] = await como((s) => s`select public.terminos_para_emparejar(${mat.id}::uuid, 8) as c`);
  return { ...c.t, candidatos: p.c };
}

async function crear(codigo) {
  const ctx = await contexto();
  const h = await generar(codigo, ctx);
  await g`select public.mision_registrar(${mat.id}::uuid, ${h.mecanica}, 'diaria',
            ${JSON.stringify(h.enunciado)}::jsonb, ${JSON.stringify(h.solucion)}::jsonb, ${h.origen},
            ${h.tokens}::integer, ${h.costo}::numeric)`;
  const [m] = await como((s) => s`select public.mi_mision(${mat.id}::uuid) as m`);
  const [{ solucion }] = await d`select solucion from public.misiones where id = ${m.m.id}`;
  return { mision: m.m, solucion, gen: h, ctx };
}

const responder = async (id, respuesta) => (await como((s) =>
  s`select public.mision_responder(${id}::uuid, ${JSON.stringify(respuesta)}::jsonb) as r`))[0].r;

const gasto = {};   // por mecánica: tokens y costo medidos

// ========================================================================
console.log('0. Validadores y rotación (sin gastar tokens)');
{
  // quiz: la correcta no puede ser la más larga por más de un 10%.
  const base = { pregunta: '¿Qué hace la autenticación en un sistema?', explicacion: 'Porque eso responde quién eres.' };
  const ok = quiz.validar({ ...base, respuesta_correcta: 'Verifica quién es el usuario',
    incorrectas: ['Decide qué recursos puede usar', 'Cifra la conexión entera', 'Registra cada acceso hecho'] });
  cierto('quiz: acepta una correcta de largo parecido', ok.ok, ok.motivos.join('; '));
  const larga = quiz.validar({ ...base, respuesta_correcta: 'Verifica quién es el usuario que entra al sistema',
    incorrectas: ['Decide qué puede usar', 'Cifra la conexión', 'Registra cada acceso'] });
  cierto('quiz: rechaza la correcta mucho más larga', !larga.ok && larga.motivos.some((m) => /más larga/.test(m)));
  // Justo lo que el 1,6× dejaba pasar: una correcta un 11% más larga que la más larga.
  const letras = (c, n) => c.repeat(n);
  const conLargo = (c, o) => quiz.validar({ ...base, respuesta_correcta: letras('a', c),
    incorrectas: [letras('b', o[0]), letras('c', o[1]), letras('d', o[2])] });
  cierto('quiz: rechaza 50 contra 45 (11% sobre la más larga)', !conLargo(50, [45, 40, 30]).ok);
  cierto('quiz: acepta 49 contra 45 (≤ 10%)', conLargo(49, [45, 40, 30]).ok);
  cierto('quiz: acepta la correcta más corta que las demás', conLargo(30, [45, 40, 44]).ok);
  cierto('quiz: la consigna «más corta» aparece solo a veces',
    new Set([0.1, 0.9].map((a) => quiz.instruccion(quiz.preparar({ termino: 't', definicion: 'd', asignatura: 'a' }, () => a)))).size === 2);

  // verdadero/falso
  const vfBueno = { afirmaciones: [
    { texto: 'Autenticar es comprobar quién es el usuario.', verdadera: true, porque: 'Es justo lo que responde.' },
    { texto: 'Autenticar decide qué recursos puede abrir.', verdadera: false, porque: 'Eso es autorizar.' },
    { texto: 'Una clave es una forma de autenticarse.', verdadera: true, porque: 'Es un factor de conocimiento.' },
    { texto: 'Autenticar cifra toda la conexión del cliente.', verdadera: false, porque: 'Eso lo hace TLS.' }] };
  cierto('v/f: acepta un caso bueno', vf.validar(vfBueno).ok);
  cierto('v/f: rechaza todas verdaderas',
    !vf.validar({ afirmaciones: vfBueno.afirmaciones.map((a) => ({ ...a, verdadera: true })) }).ok);
  const sesgado = JSON.parse(JSON.stringify(vfBueno));
  sesgado.afirmaciones[1].texto = 'Autenticar siempre decide qué recursos puede abrir.';
  cierto('v/f: tolera una «siempre» suelta en una falsa', vf.validar(sesgado).ok);
  sesgado.afirmaciones[3].texto = 'Autenticar nunca necesita una clave ni otro factor.';
  cierto('v/f: rechaza «siempre/nunca» repartidos solo en las falsas', !vf.validar(sesgado).ok);
  const largos = JSON.parse(JSON.stringify(vfBueno));
  largos.afirmaciones[0].texto += ' Además lo hace antes de cualquier otra comprobación del sistema completo.';
  largos.afirmaciones[2].texto += ' Además se guarda cifrada en la base de datos del sistema completo.';
  cierto('v/f: rechaza verdaderas mucho más largas', !vf.validar(largos).ok);
  const arm = vf.armar(vfBueno, { termino: 'autenticación' });
  cierto('v/f: armar deja el orden coherente con la pauta',
    arm.enunciado.afirmaciones.every((t, i) =>
      vfBueno.afirmaciones.find((a) => a.texto === t).verdadera === (arm.solucion.respuestas[i] === 'v')));

  // diagrama
  const ctxD = { n_pasos: 4, oculto: 2 };
  const dBueno = { apto: true, titulo: 'Recorrido de una petición', pasos: ['Cliente', 'API Gateway', 'Servicio', 'Base de datos'],
    flechas: ['pide', 'enruta', 'consulta'], distractores: ['Balanceador', 'Navegador', 'Caché local'], explicacion: 'El servicio resuelve la lógica.' };
  cierto('diagrama: acepta un caso bueno', diagrama.validar(dBueno, ctxD).ok);
  const noApto = diagrama.validar({ ...dBueno, apto: false }, ctxD);
  cierto('diagrama: apto=false se descarta sin reintento', !noApto.ok && noApto.descartar === true);
  cierto('diagrama: rechaza un distractor que ya está en el diagrama',
    !diagrama.validar({ ...dBueno, distractores: ['Cliente', 'Navegador', 'Caché local'] }, ctxD).ok);
  cierto('diagrama: rechaza la correcta mucho más larga',
    !diagrama.validar({ ...dBueno, pasos: ['Cliente', 'API Gateway', 'Servicio de negocio principal', 'Base de datos'] }, ctxD).ok);
  const armD = diagrama.armar(dBueno, { termino: 'x', oculto: 2 });
  cierto('diagrama: oculta exactamente un nodo', armD.enunciado.nodos.filter((n) => n === null).length === 1 && armD.enunciado.nodos[2] === null);
  cierto('diagrama: la correcta apunta al paso oculto', armD.enunciado.opciones[Number(armD.solucion.correcta)] === 'Servicio');
  const pd = diagrama.preparar({}, () => 0.99);
  cierto('diagrama: el hueco nunca es el primero ni el último',
    Array.from({ length: 200 }, () => diagrama.preparar({})).every((c) => c.oculto >= 1 && c.oculto <= c.n_pasos - 2), JSON.stringify(pd));

  // emparejar
  cierto('emparejar: tapa el término dentro de su definición',
    emparejar.taparTermino('TLS es el protocolo que cifra la conexión.', 'TLS') === '… es el protocolo que cifra la conexión.');
  const cand = [
    { termino: 'autenticación', definicion: 'responde quién eres, no qué puedes hacer.' },
    { termino: 'autorización', definicion: 'responde qué puedes hacer, no confundir con autenticación.' },
    { termino: 'TLS', definicion: 'es el protocolo que cifra la conexión.' },
    { termino: 'JWT', definicion: 'es un token firmado con la identidad dentro.' },
    { termino: 'JSON', definicion: 'es un formato de texto para representar datos.' },
    { termino: 'CORS', definicion: 'es lo que decide qué orígenes pueden llamar a una API.' }];
  const el = emparejar.elegirPares(cand);
  cierto('emparejar: elige cuatro', el?.length === 4);
  cierto('emparejar: no junta dos que se mencionan entre sí',
    !(el.some((x) => x.termino === 'autorización') && el.some((x) => x.termino === 'autenticación')));
  cierto('emparejar: con menos de cuatro compatibles devuelve null', emparejar.elegirPares(cand.slice(0, 3)) === null);

  // rotación
  const activas = Object.keys(MECANICAS);
  const cuenta = {};
  for (let i = 0; i < 20000; i++) {
    const c = elegirMecanica({ activas, previa: null });
    cuenta[c] = (cuenta[c] ?? 0) + 1;
  }
  const total = Object.values(PESOS).reduce((a, b) => a + b, 0);
  cierto('rotación: respeta los pesos (±2 puntos)',
    Object.entries(PESOS).every(([c, p]) => Math.abs(cuenta[c] / 200 - (100 * p) / total) < 2), JSON.stringify(cuenta));
  cierto('rotación: nunca repite la anterior',
    activas.every((p) => Array.from({ length: 500 }, () => elegirMecanica({ activas, previa: p })).every((c) => c !== p)));
  cierto('rotación: sin modelo solo sale emparejar',
    Array.from({ length: 200 }, () => elegirMecanica({ activas, previa: 'quiz', hayModelo: false })).every((c) => c === 'emparejar'));
  cierto('rotación: sin pares nunca sale emparejar',
    Array.from({ length: 500 }, () => elegirMecanica({ activas, previa: null, hayPares: false })).every((c) => c !== 'emparejar'));
  revisar('rotación: una sola activa y es la anterior → la repite', elegirMecanica({ activas: ['quiz'], previa: 'quiz' }), 'quiz');
  revisar('rotación: respeta las plantillas que el docente apagó',
    Array.from({ length: 300 }, () => elegirMecanica({ activas: ['quiz', 'diagrama'], previa: null })).every((c) => ['quiz', 'diagrama'].includes(c)), true);
  revisar('respaldo: de un modelo cae a emparejar', respaldo({ falló: 'diagrama', activas }), 'emparejar');
  revisar('respaldo: sin pares cae al quiz', respaldo({ falló: 'diagrama', activas, hayPares: false }), 'quiz');
  revisar('respaldo: si falló el quiz sin pares no hay', respaldo({ falló: 'quiz', activas, hayPares: false }), null);

  // desarrollo
  cierto('desarrollo: recorta el mensaje a tres frases',
    desarrollo.recortarFrases('Uno. Dos. Tres. Cuatro. Cinco.') === 'Uno. Dos. Tres.');
  cierto('desarrollo: limpia el texto del alumno al tope',
    desarrollo.limpiarRespuesta('a'.repeat(900)).length === 600);
}

await limpiar();

// ========================================================================
console.log('\n1. emparejar (sin modelo)');
{
  const { mision, solucion, gen } = await crear('emparejar');
  info('términos', mision.enunciado.terminos);
  revisar('mecánica', mision.mecanica, 'emparejar');
  revisar('no gastó tokens', gen.tokens, 0);
  revisar('origen', gen.origen, 'pozo');
  revisar('cuatro términos', mision.enunciado.terminos.length, 4);
  revisar('cuatro definiciones', mision.enunciado.definiciones.length, 4);
  revisar('el enunciado no trae los pares', 'pares' in (mision.enunciado ?? {}), false);
  revisar('mientras está pendiente la pauta no baja', mision.solucion ?? null, null);
  revisar(`vale ${XP}`, mision.xp, XP);
  cierto('ninguna definición nombra a su propio término',
    mision.enunciado.definiciones.every((df, j) =>
      !new RegExp(`(?<![\\p{L}\\p{N}])${mision.enunciado.terminos[Number(solucion.pares[j])]
        .replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(df)));
  const guardados = (await d`select enunciado->'terminos' t from public.misiones where id = ${mision.id}`)[0].t;
  revisar('los términos quedan en el enunciado (para no repetirlos mañana)', guardados.length, 4);
  const [ctx] = await como((s) => s`select public.contexto_mision(${mat.id}::uuid) as c`);
  cierto('contexto_mision cuenta los cuatro como usados',
    guardados.every((t) => ctx.c.terminos_usados.includes(t)));

  const mala = Object.fromEntries(solucion.pares.map((p, j) => [`d${j}`, String((Number(p) + 1) % 4)]));
  const r1 = await responder(mision.id, mala);
  revisar('mal: acertada', r1.acertada, false);
  revisar('mal: experiencia', r1.xp_ganada, 0);
  revisar('mal: guarda lo que contestó', r1.solucion.respuesta, solucion.pares.map((p) => String((Number(p) + 1) % 4)));
  revisar('mal: no hay movimiento', await xpTotal(), 0);

  await reabrir(mision.id);
  // Tres bien y una mal: todo o nada.
  const casi = Object.fromEntries(solucion.pares.map((p, j) => [`d${j}`, j < 2 ? solucion.pares[j === 0 ? 1 : 0] : p]));
  const rc = await responder(mision.id, casi);
  revisar('tres de cuatro: no paga', rc.acertada, false);

  await reabrir(mision.id);
  const buena = Object.fromEntries(solucion.pares.map((p, j) => [`d${j}`, p]));
  const r2 = await responder(mision.id, buena);
  revisar('bien: acertada', r2.acertada, true);
  revisar('bien: experiencia', r2.xp_ganada, XP);
  revisar('bien: movimiento anotado', await xpTotal(), XP);
  const [rel] = await como((s) => s`select public.mi_mision(${mat.id}::uuid) as m`);
  revisar('al recargar vuelve la pauta con lo que contestó', rel.m.solucion.respuesta, solucion.pares);
  gasto.emparejar = { tokens: 0, costo: 0 };
}

// ========================================================================
for (const codigo of ['verdadero_falso', 'diagrama', 'quiz']) {
  console.log(`\n${{ verdadero_falso: '2. verdadero_falso', diagrama: '3. diagrama', quiz: '4. quiz' }[codigo]}`);
  await limpiar();
  const { mision, solucion, gen } = await crear(codigo);
  gasto[codigo] = { tokens: gen.tokens, costo: gen.costo, intentos: gen.intentos };
  console.log(`   término: ${mision.enunciado.termino} · ${gen.tokens} tokens · $${gen.costo.toFixed(6)} · ${gen.intentos} intento(s)`);
  console.log(`   ${mision.enunciado.pregunta}`);
  revisar('mecánica', mision.mecanica, codigo);
  revisar('pauta no baja pendiente', mision.solucion ?? null, null);
  revisar(`vale ${XP}`, mision.xp, XP);

  let mala, buena;
  if (codigo === 'verdadero_falso') {
    mision.enunciado.afirmaciones.forEach((a, i) => console.log(`     ${solucion.respuestas[i] === 'v' ? 'V' : 'F'} · ${a}`));
    revisar('cuatro afirmaciones', mision.enunciado.afirmaciones.length, 4);
    cierto('hay verdaderas y falsas', solucion.respuestas.includes('v') && solucion.respuestas.includes('f'));
    revisar('el enunciado no trae las respuestas', 'respuestas' in mision.enunciado, false);
    buena = Object.fromEntries(solucion.respuestas.map((v, i) => [`a${i}`, v]));
    mala = { ...buena, a0: buena.a0 === 'v' ? 'f' : 'v' };
  } else if (codigo === 'diagrama') {
    console.log(`   ${mision.enunciado.nodos.map((n) => n ?? '[?]').join(' → ')}`);
    revisar('exactamente un hueco', mision.enunciado.nodos.filter((n) => n === null).length, 1);
    revisar('flechas = pasos − 1', mision.enunciado.flechas.length, mision.enunciado.nodos.length - 1);
    revisar('cuatro opciones', mision.enunciado.opciones.length, 4);
    cierto('las etiquetas caben (≤ 40)', [...mision.enunciado.nodos.filter(Boolean), ...mision.enunciado.opciones].every((x) => x.length <= 40));
    buena = { elegida: solucion.correcta };
    mala = { elegida: String((Number(solucion.correcta) + 1) % 4) };
  } else {
    mision.enunciado.opciones.forEach((o, i) => console.log(`     ${'abcd'[i]}) ${o.slice(0, 72)}${i === Number(solucion.correcta) ? '   ← correcta' : ''}`));
    revisar('cuatro opciones', mision.enunciado.opciones.length, 4);
    const correcta = mision.enunciado.opciones[Number(solucion.correcta)];
    const otras = mision.enunciado.opciones.filter((_, i) => i !== Number(solucion.correcta));
    cierto('la correcta no es la más larga por más de un 10%', correcta.length <= Math.max(...otras.map((o) => o.length)) * 1.1,
      `${correcta.length} vs. ${Math.max(...otras.map((o) => o.length))}`);
    buena = { elegida: solucion.correcta };
    mala = { elegida: String((Number(solucion.correcta) + 1) % 4) };
  }

  const r1 = await responder(mision.id, mala);
  revisar('mal: acertada', r1.acertada, false);
  revisar('mal: experiencia', r1.xp_ganada, 0);
  cierto('mal: ya ve la pauta', !!r1.solucion);
  revisar('mal: sin movimiento', await xpTotal(), 0);
  await reabrir(mision.id);
  const r2 = await responder(mision.id, buena);
  revisar('bien: acertada', r2.acertada, true);
  revisar('bien: experiencia', r2.xp_ganada, XP);
  revisar('bien: movimiento anotado', await xpTotal(), XP);
  try {
    await responder(mision.id, buena);
    revisar('no se responde dos veces', 'lo dejó pasar', 'rechaza');
  } catch (e) {
    revisar('no se responde dos veces', /ya está resuelta/.test(e.message), true);
  }
  const [fila] = await d`select tokens, costo_usd::float c from public.misiones where id = ${mision.id}`;
  revisar('quedó registrado el gasto', fila.tokens, gen.tokens);
  cierto('el costo quedó en la base', fila.c > 0);
}

// ========================================================================
console.log('\n5. desarrollo (el modelo redacta y corrige)');
{
  await limpiar();
  const { mision, solucion, gen } = await crear('desarrollo');
  gasto.desarrollo = { tokens: gen.tokens, costo: gen.costo, intentos: gen.intentos };
  console.log(`   término: ${mision.enunciado.termino} · redactar: ${gen.tokens} tokens · $${gen.costo.toFixed(6)}`);
  console.log(`   ${mision.enunciado.pregunta}`);
  console.log(`   criterios: ${solucion.criterios.join(' | ')}`);
  revisar('mecánica', mision.mecanica, 'desarrollo');
  revisar('tope de caracteres', mision.enunciado.max_caracteres, 600);
  revisar('el enunciado no trae los criterios', 'criterios' in mision.enunciado, false);
  revisar('la pauta no baja pendiente', mision.solucion ?? null, null);

  console.log('  — la app no puede cobrarla por el camino de las otras');
  try {
    await responder(mision.id, { elegida: '0' });
    revisar('mision_responder rechaza desarrollo', 'lo dejó pasar', 'rechaza');
  } catch (e) {
    revisar('mision_responder rechaza desarrollo', /se corrige en el servidor/.test(e.message), true);
  }
  revisar('sin movimiento', await xpTotal(), 0);

  console.log('  — por HTTP (handler en proceso)');
  const url = '/api/mision-responder';
  const corto = await llamar(handlerResponder, { url, cuerpo: { mision: mision.id, respuesta: { texto: 'no sé' } } });
  revisar('texto demasiado corto → 400', corto.estado, 400);

  process.env.OPENROUTER_API_KEY = 'clave-mala';
  const caido = await llamar(handlerResponder, { url, cuerpo: { mision: mision.id, respuesta: {
    texto: 'Una respuesta razonable de más de cuarenta caracteres para que no la rechace el mínimo.' } } });
  process.env.OPENROUTER_API_KEY = KEY_REAL;
  revisar('si el modelo falla → 503', caido.estado, 503);
  revisar('y es reintentable', caido.cuerpo.reintentable, true);
  const [pend] = await d`select resuelta_en, intentos from public.misiones where id = ${mision.id}`;
  revisar('la misión sigue sin responder', pend.resuelta_en, null);
  revisar('sin penalización: intentos en 0', pend.intentos, 0);
  revisar('sin movimiento', await xpTotal(), 0);

  const mal = await llamar(handlerResponder, { url, cuerpo: { mision: mision.id, respuesta: {
    texto: 'asdf qwer zxcv el perro come pasto en la plaza y hoy hace calor en la ciudad de santiago' } } });
  revisar('respuesta sin sentido → 200', mal.estado, 200);
  info('veredicto', `${mal.cuerpo.veredicto} · +${mal.cuerpo.xp_ganada} · ${mal.cuerpo.solucion?.explicacion}`);
  revisar('veredicto: incompleto', mal.cuerpo.veredicto, 'incompleto');
  revisar('no paga', mal.cuerpo.xp_ganada, 0);
  revisar('acertada', mal.cuerpo.acertada, false);
  cierto('guarda lo que escribió', /perro come pasto/.test(mal.cuerpo.solucion.respuesta));
  cierto('el comentario no es una clase (≤ 3 frases)', (mal.cuerpo.solucion.explicacion.match(/[.!?](\s|$)/g) ?? []).length <= 3);
  const [t1] = await d`select tokens, costo_usd::float c from public.misiones where id = ${mision.id}`;
  cierto('sumó los tokens de la corrección a los de la redacción', t1.tokens > gen.tokens, `${gen.tokens} → ${t1.tokens}`);
  const gradoTokens = t1.tokens - gen.tokens;
  const gradoCosto = t1.c - gen.costo;
  gasto.desarrollo.corregir = { tokens: gradoTokens, costo: gradoCosto };

  await reabrir(mision.id, ['explicacion']);
  const buena = await llamar(handlerResponder, { url, cuerpo: { mision: mision.id, respuesta: {
    texto: `${solucion.definicion} En concreto: ${solucion.criterios.join('. ')}.` } } });
  revisar('respuesta con las ideas clave → 200', buena.estado, 200);
  info('veredicto', `${buena.cuerpo.veredicto} · +${buena.cuerpo.xp_ganada} · ${buena.cuerpo.solucion?.explicacion}`);
  cierto('paga (logrado o parcial)', buena.cuerpo.xp_ganada === XP || buena.cuerpo.xp_ganada === Math.floor(XP / 2), buena.cuerpo.veredicto);
  revisar('el movimiento coincide con lo pagado', await xpTotal(), buena.cuerpo.xp_ganada);
  const dos = await llamar(handlerResponder, { url, cuerpo: { mision: mision.id, respuesta: { texto: 'x'.repeat(60) } } });
  revisar('no se corrige dos veces → 400', dos.estado, 400);
  cierto('dice que ya está resuelta', /ya está resuelta/.test(dos.cuerpo.error ?? ''));
  const cuerpoCompleto = JSON.stringify((await como((s) => s`select public.mi_mision(${mat.id}::uuid) as m`))[0].m);
  cierto('al recargar trae veredicto y respuesta', /veredicto/.test(cuerpoCompleto) && /respuesta/.test(cuerpoCompleto));

  console.log('  — una quiz no se corrige con texto');
  // (se comprueba en el paso 7 con la misión de otro tipo)

  console.log('  — el escalón del pago, con el rol del servidor (sin modelo)');
  const cal = async (v) => (await g`select public.mision_calificar(${mision.id}::uuid, ${alumno.id}::uuid, ${v}, 'Comentario de prueba que no es vacío.', 'texto', 10, 0.0001) as r`)[0].r;
  await reabrir(mision.id, ['explicacion']);
  const rl = await cal('logrado');
  revisar('logrado paga todo', rl.xp_ganada, XP);
  await reabrir(mision.id, ['explicacion']);
  const rp = await cal('parcial');
  revisar('parcial paga la mitad', rp.xp_ganada, Math.floor(XP / 2));
  revisar('parcial cuenta como «pagó algo»', rp.acertada, true);
  revisar('parcial: movimiento', await xpTotal(), Math.floor(XP / 2));
  await reabrir(mision.id, ['explicacion']);
  const ri = await cal('incompleto');
  revisar('incompleto no paga', ri.xp_ganada, 0);
  revisar('incompleto: sin movimiento', await xpTotal(), 0);
  try {
    await cal('incompleto');
    revisar('calificar dos veces se rechaza', 'lo dejó pasar', 'rechaza');
  } catch (e) {
    revisar('calificar dos veces se rechaza', /ya está resuelta/.test(e.message), true);
  }
  await reabrir(mision.id, ['explicacion']);
  try {
    await g`select public.mision_calificar(${mision.id}::uuid, ${alumno.id}::uuid, 'perfecto', 'x', 'x', 1, 0)`;
    revisar('un veredicto inventado se rechaza', 'lo dejó pasar', 'rechaza');
  } catch (e) {
    revisar('un veredicto inventado se rechaza', /Veredicto desconocido/.test(e.message), true);
  }
  const [otro] = await d`select u.id from public.usuarios u where u.id <> ${alumno.id} limit 1`;
  try {
    await g`select public.mision_calificar(${mision.id}::uuid, ${otro.id}::uuid, 'logrado', 'x', 'x', 1, 0)`;
    revisar('calificar la misión de otro se rechaza', 'lo dejó pasar', 'rechaza');
  } catch (e) {
    revisar('calificar la misión de otro se rechaza', /no es tuya/.test(e.message), true);
  }
  revisar('nada se pagó con los intentos inválidos', await xpTotal(), 0);
}

// ========================================================================
console.log('\n6. Lo que pulso_app NO puede hacer');
{
  const [m] = await d`select id from public.misiones where matricula_id = ${mat.id} limit 1`;
  const deniega = async (etiqueta, q) => {
    try { await como(q); revisar(etiqueta, 'pudo', 'permission denied'); }
    catch (e) { revisar(etiqueta, /permission denied/.test(e.message), true); }
  };
  await deniega('calificar', (s) => s`select public.mision_calificar(${m.id}::uuid, ${alumno.id}::uuid, 'logrado', 'x', 'x', 1, 0)`);
  await deniega('leer la pauta de desarrollo', (s) => s`select public.mision_pauta(${m.id}::uuid, ${alumno.id}::uuid)`);
  await deniega('registrarse una misión (8 args)', (s) => s`select public.mision_registrar(${mat.id}::uuid, 'quiz', 'diaria', '{}'::jsonb, '{}'::jsonb, 'modelo', 1, 0)`);
  await deniega('registrarse una misión (6 args)', (s) => s`select public.mision_registrar(${mat.id}::uuid, 'quiz', 'diaria', '{}'::jsonb, '{}'::jsonb, 'modelo')`);
  await deniega('leer la solución', (s) => s`select solucion from public.misiones where id = ${m.id}::uuid`);
  await deniega('leer tokens ni costo', (s) => s`select tokens, costo_usd from public.misiones where id = ${m.id}::uuid`);
  const [ven] = await como((s) => s`select count(*)::int n from public.mis_misiones where matricula_id = ${mat.id}::uuid`);
  cierto('mis_misiones sigue funcionando', ven.n >= 1);
}

// ========================================================================
console.log('\n7. /api/mision rota, y cae a emparejar si el modelo no está');
{
  const plantillaDe = async (c) => (await d`select id from public.mision_plantillas where codigo = ${c}`)[0].id;
  const sembrarAyer = async (codigo) => {
    await limpiar();
    await d`insert into public.misiones (matricula_id, plantilla_id, fecha, tipo, enunciado, solucion, xp, origen, resuelta_en, acertada, intentos)
            values (${mat.id}, ${await plantillaDe(codigo)}, public.dia_mision() - 1, 'diaria', '{"termino":"JSON"}'::jsonb, '{}'::jsonb, 75, 'modelo', now(), true, 1)`;
  };
  const generada = async () => (await d`select p.codigo, m.origen, m.tokens, m.costo_usd::float c, m.xp
      from public.misiones m join public.mision_plantillas p on p.id = m.plantilla_id
     where m.matricula_id = ${mat.id} and m.fecha = public.dia_mision()`)[0];
  const url = '/api/mision';

  console.log('  — sin la key del modelo');
  await sembrarAyer('quiz');
  delete process.env.OPENROUTER_API_KEY;
  let r = await llamar(handlerMision, { url, cuerpo: { matricula: mat.id } });
  revisar('200', r.estado, 200);
  revisar('generada', r.cuerpo.generada, true);
  revisar('sin modelo, la de hoy es emparejar', (await generada()).codigo, 'emparejar');
  revisar('y no gastó tokens', (await generada()).tokens, 0);
  revisar('origen pozo', (await generada()).origen, 'pozo');
  cierto('la respuesta no trae la pauta', !JSON.stringify(r.cuerpo).includes('"pares"'));

  console.log('  — con la key rota: el modelo falla y se cae al respaldo');
  await sembrarAyer('emparejar');
  process.env.OPENROUTER_API_KEY = 'clave-mala';
  r = await llamar(handlerMision, { url, cuerpo: { matricula: mat.id } });
  process.env.OPENROUTER_API_KEY = KEY_REAL;
  revisar('200 aunque el modelo falle', r.estado, 200);
  revisar('cae a emparejar', (await generada()).codigo, 'emparejar');

  console.log('  — con el modelo: nunca la misma que ayer');
  await sembrarAyer('verdadero_falso');
  r = await llamar(handlerMision, { url, cuerpo: { matricula: mat.id } });
  revisar('200', r.estado, 200);
  const hoy = await generada();
  cierto('no repite la de ayer (verdadero_falso)', hoy.codigo !== 'verdadero_falso', hoy.codigo);
  info('le tocó', `${hoy.codigo} · ${hoy.tokens} tokens · $${(hoy.c ?? 0).toFixed(6)}`);
  revisar('vale 75', hoy.xp, 75);
  const [ya] = [await llamar(handlerMision, { url, cuerpo: { matricula: mat.id } })];
  revisar('apretarlo de nuevo no genera otra', ya.cuerpo.generada, false);
  const gen2 = await d`select count(*)::int n from public.misiones where matricula_id = ${mat.id} and fecha = public.dia_mision()`;
  revisar('sigue habiendo una sola hoy', gen2[0].n, 1);

  console.log('  — texto libre sobre una misión que no es de desarrollo');
  if (hoy.codigo !== 'desarrollo') {
    const [mm] = await d`select id from public.misiones where matricula_id = ${mat.id} and fecha = public.dia_mision()`;
    const t = await llamar(handlerResponder, { url: '/api/mision-responder', cuerpo: { mision: mm.id, respuesta: { texto: 'x'.repeat(60) } } });
    revisar('→ 400', t.estado, 400);
    cierto('no se corrige con texto libre', /texto libre/.test(t.cuerpo.error ?? ''), t.cuerpo.error);
  } else {
    info('omitido', 'hoy le tocó desarrollo');
  }
}

// ========================================================================
console.log('\n8. Lo medido, por mecánica');
console.log('   mecánica          tokens   costo (USD)   intentos');
for (const [c, v] of Object.entries(gasto)) {
  const extra = v.corregir ? `  (+ corregir: ${v.corregir.tokens} tokens, $${v.corregir.costo.toFixed(6)})` : '';
  console.log(`   ${c.padEnd(16)} ${String(v.tokens).padStart(7)}   ${v.costo.toFixed(6).padStart(11)}   ${String(v.intentos ?? '-').padStart(8)}${extra}`);
}

await limpiar();
const [resto] = await d`select (select count(*) from public.misiones where matricula_id = ${mat.id})::int m,
                                (select count(*) from public.movimientos_experiencia where matricula_id = ${mat.id})::int x`;
revisar('limpieza: el alumno de prueba quedó sin misiones ni experiencia', [resto.m, resto.x], [0, 0]);
console.log(fallos === 0
  ? '\nTodo bien: las cinco mecánicas de la misión diaria funcionan.'
  : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
