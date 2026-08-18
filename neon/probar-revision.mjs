/**
 * El criterio de las sugerencias, contra respuestas de mentira.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-revision.mjs [--codigo L1] [--caja 2.5]
 *
 * Lee el enunciado de la base y llama al modelo de verdad —no hay forma de probar
 * un juicio sin el que juzga— pero **no escribe nada**: ni respuestas, ni
 * revisiones, ni puntos.
 *
 * ── Qué se vigila, y qué no ──
 *
 * No se vigila que el modelo acierte siempre: no lo va a hacer, y por eso el
 * veredicto es una sugerencia que no toca los puntos. Se vigila lo que sí tiene
 * que ser cierto todas las veces:
 *
 *   - Que una respuesta en blanco o disparatada **no salga «logrado»**. Si eso
 *     falla, el alumno recibe un visto bueno por nada y la función deja de servir.
 *   - Que una respuesta buena no salga «incompleto». Un ayudante que reprueba lo
 *     correcto es peor que no tener ayudante: el alumno borra lo que estaba bien.
 *   - Que **el mensaje no le dé la respuesta**. Es lo único que evita que alguien
 *     itere hasta que la máquina diga que sí.
 *   - Que el contexto que se le manda traiga de verdad el laboratorio completo, con
 *     la caja marcada en su lugar. Eso se comprueba sin gastar una llamada.
 *
 * Con `--caja` prueba una sola, para iterar la instrucción sin pagar las demás.
 */
import { neon } from '@neondatabase/serverless';
import { armarContexto, armarInstruccion, revisar, VEREDICTOS } from '../lib/revision-lab.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] ?? true]);
    return a;
  }, []),
);
const CODIGO = args.codigo ?? 'L1';
/** Dos asignaturas tienen un `L1`, así que el código solo no alcanza. */
const SIGLA = args.sigla ?? null;

const d = neon(process.env.DATABASE_URL_OWNER);
let fallos = 0;
const rev = (e, ok, detalle = '') => {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}${ok || !detalle ? '' : `\n      ${detalle}`}`);
};

const labs = await d`
  select a.codigo, a.titulo, l.bloques, asg.sigla,
         '{}'::jsonb as respuestas, '{}'::jsonb as revisiones
    from public.laboratorios l
    join public.actividades a on a.id = l.actividad_id
    join public.asignaturas asg on asg.id = a.asignatura_id
   where a.codigo = ${CODIGO} and (${SIGLA}::text is null or asg.sigla = ${SIGLA})
   order by asg.sigla`;
if (!labs.length) throw new Error(`No existe el laboratorio ${CODIGO}${SIGLA ? ` en ${SIGLA}` : ''}.`);
if (labs.length > 1) {
  console.error(`Hay ${labs.length} laboratorios con el código ${CODIGO}: ${labs.map((l) => l.sigla).join(', ')}`);
  console.error(`Elige uno:  node neon/probar-revision.mjs --codigo ${CODIGO} --sigla ${labs[0].sigla}`);
  process.exit(1);
}
const lab = labs[0];

const cajas = lab.bloques.filter((b) => b.tipo === 'caja');
console.log(`${lab.sigla} · ${lab.codigo} · ${lab.titulo} · ${cajas.length} cajas`);

// ============================== El contexto ==============================
// Sin gastar una llamada: si esto está mal, todo lo demás juzga a ciegas.

console.log('\nEl contexto que se le manda');
const unaCaja = cajas.find((c) => c.formato === 'corta') ?? cajas[0];
const ctx = armarContexto(lab, unaCaja.id);
rev('trae el laboratorio completo, no solo la caja',
  ctx.length > 5000, `${ctx.length} caracteres`);
rev('marca la caja que se revisa, en su lugar',
  ctx.includes(`CAJA ${unaCaja.id} · ESTA ES LA QUE TIENES QUE REVISAR`));
rev('la marca no va al final: hay enunciado después',
  ctx.indexOf('fin de la caja a revisar') < ctx.length - 500);
rev('menciona las demás cajas',
  cajas.filter((c) => c.id !== unaCaja.id).every((c) => ctx.includes(`[caja ${c.id}]`)));
// Condicional: no todo enunciado trae código. El L1 de ITY es una hoja de
// respuestas que acompaña a un notebook, y exigirle bloques de código sería
// hacerla fallar por no ser lo que no es.
const codigoEnBase = JSON.stringify(lab.bloques).includes('<pre><code');
if (codigoEnBase) {
  rev('conserva los bloques de código del enunciado',
    (ctx.match(/```/g) ?? []).length >= 4,
    `${(ctx.match(/```/g) ?? []).length / 2} bloques`);
} else {
  console.log('  · este enunciado no trae bloques de código, no hay nada que conservar');
}
rev('no queda HTML crudo', !/<(p|div|pre|code|table|strong)\b/.test(ctx),
  (ctx.match(/<[a-z]+[ >]/g) ?? []).slice(0, 5).join(' '));

const ins = armarInstruccion(lab, unaCaja.id, 'una respuesta cualquiera');
rev('la instrucción prohíbe dar la respuesta',
  /No puedes escribir la respuesta/.test(ins) && /te está \*\*prohibido\*\* afirmar un hecho/i.test(ins));
rev('trae el ejemplo de lo prohibido y lo permitido',
  ins.includes('PROHIBIDO:') && ins.includes('PERMITIDO:'));
rev('pide tú y prohíbe el voseo', /Nunca vos ni voseo/.test(ins));
rev('prohíbe los garabatos', /Nunca garabatos/.test(ins));
rev('y dice qué escribió el alumno', ins.includes('una respuesta cualquiera'));
console.log(`  · instrucción completa: ${ins.length.toLocaleString('es')} caracteres`);

// ============================== El juicio ==============================
// Cada caso es una respuesta de mentira y lo que NO puede pasar con ella.

/**
 * Los hechos técnicos que **son** la respuesta de cada caja.
 *
 * Se revisan en **todos** los mensajes, no en uno de muestra. La primera versión
 * de esta prueba miraba un solo caso y dio «todo bien» mientras el modelo soplaba
 * la respuesta completa en cuatro de siete: pasó por la razón equivocada.
 */
const SOPLONES = {
  '2.5': [
    'no es cifrado', 'no está cifrado', 'no encripta', 'no cifra',
    'solo codifica', 'sólo codifica', 'solo cambia el formato', 'es un formato de texto',
    'da integridad', 'no fue alterado', 'no fue modificado', 'no fue cambiado',
    'sirve para verificar', 'garantiza que', 'es una codificación',
  ],
  '1.7': [
    'content-length cuenta bytes', 'no lleva body', 'no manda body',
    'porque no envía nada', 'la petición no tiene cuerpo',
  ],
  // ITY · L1: la respuesta de 2b **son** los dos centinelas. Nombrarlos es dársela.
  '2b': ['error', 'unknown'],
  '8a': ['se escala con la media del entrenamiento', 'los parámetros del train',
         'se ajusta con train', 'fit solo en train'],
};

/** Voseo y registro: dos cosas que salieron mal en la primera corrida. */
const VOSEO = /\b(mirá|revisá|volvé|volvete|leé|copiá|andá|fijate|tenís|podés|querés|sabés|hacé|pegá|corré|dale nomás)\b/i;
const GARABATOS = /\b(we[oó]n|hue[oó]n|cabr[oa]|causa|po[hs]?\b.*\bweon)\b/i;

/** Respuestas escritas a mano para cajas concretas de L1. */
const CASOS = (CODIGO !== 'L1' || lab.sigla !== 'DSY1107') ? [] : [
  {
    caja: '2.5',
    que: 'una explicación correcta de por qué base64 no protege un JWT',
    respuesta: 'Porque base64 no es cifrado, es solo una forma de escribir los bytes ' +
      'en texto para que viajen sin romperse. Cualquiera lo puede decodificar sin ninguna ' +
      'clave, como hice yo con node. La firma no sirve para esconder nada: sirve para que ' +
      'si alguien cambia el payload, el que reciba el token se dé cuenta. Da integridad, ' +
      'no secreto.',
    noPuede: ['incompleto'],
  },
  {
    caja: '2.5',
    que: 'una respuesta en blanco',
    respuesta: '   ',
    noPuede: ['logrado', 'parcial'],
  },
  {
    caja: '2.5',
    que: 'algo que no tiene nada que ver',
    respuesta: 'no alcancé a hacer esta parte, la voy a hacer en la casa',
    noPuede: ['logrado'],
  },
  {
    caja: '2.5',
    que: 'una respuesta al revés: dice que base64 sí cifra',
    respuesta: 'El JWT está protegido porque base64 lo encripta, así que nadie puede ' +
      'leer lo que va adentro aunque capture el tráfico.',
    noPuede: ['logrado'],
  },
  {
    caja: '1.7',
    que: 'una petición HTTP pegada de verdad (caja de código)',
    respuesta: 'GET /v1/libros HTTP/1.1\nHost: localhost:8080\nUser-Agent: curl/8.7.1\nAccept: */*\n',
    noPuede: ['incompleto'],
  },
  {
    caja: '1.7',
    que: 'la respuesta en vez de la petición, que es lo que la caja NO pide',
    respuesta: 'HTTP/1.1 200 OK\nX-Powered-By: Express\nContent-Type: application/json\n' +
      'Content-Length: 276\n',
    noPuede: ['logrado'],
  },
  {
    caja: '1.7',
    que: 'basura pegada en una caja de código',
    respuesta: 'asdasd no me salio nada',
    noPuede: ['logrado', 'parcial'],
  },
];

/** Los del L1 de ITY1102, que es una hoja de respuestas y no un tutorial. */
const CASOS_ITY = (CODIGO !== 'L1' || lab.sigla !== 'ITY1102') ? [] : [
  {
    caja: '2b',
    que: 'identifica bien los centinelas que isna() no ve',
    respuesta: 'Encontré que hay celdas con el texto ERROR y con el texto UNKNOWN. ' +
      'Como son strings y no NaN, isna() no los cuenta: son 1.234 celdas entre las dos.',
    noPuede: ['incompleto'],
  },
  {
    caja: '2b',
    que: 'dice que no había nada, que es justo lo contrario',
    respuesta: 'No encontré ningún valor raro, los datos estaban limpios.',
    noPuede: ['logrado'],
  },
  {
    caja: '2b',
    que: 'en blanco',
    respuesta: '   ',
    noPuede: ['logrado', 'parcial'],
  },
  {
    caja: '8c',
    que: 'una justificación razonada del costo asimétrico',
    respuesta: 'Cuesta más quedarse sin envases: si preparo de más pierdo el costo del ' +
      'envase, que son unos pesos, pero si me quedo sin ellos pierdo la venta completa y ' +
      'además el cliente se va molesto. El error de faltante es más caro que el de sobrante, ' +
      'así que conviene un modelo que se equivoque hacia preparar de más.',
    noPuede: ['incompleto'],
  },
  {
    caja: '8c',
    que: 'no justifica, solo elige',
    respuesta: 'quedarse sin envases',
    noPuede: ['logrado'],
  },
];

const soloCaja = args.caja ? String(args.caja) : null;
const casos = [...CASOS, ...CASOS_ITY].filter((c) => !soloCaja || c.caja === soloCaja);

if (!casos.length) {
  console.log(`\nSin casos escritos para ${CODIGO}${soloCaja ? ` caja ${soloCaja}` : ''}.`);
} else {
  console.log('\nEl juicio');
  let gasto = 0;
  for (const c of casos) {
    if (!cajas.some((x) => x.id === c.caja)) {
      console.log(`  · la caja ${c.caja} ya no está en ${CODIGO}, me la salto`);
      continue;
    }
    let r;
    try {
      r = await revisar({ lab, cajaId: c.caja, respuesta: c.respuesta });
    } catch (e) {
      rev(`caja ${c.caja} · ${c.que}`, false, `el modelo falló: ${e.message}`);
      continue;
    }
    gasto += r.costo;

    const vered = !c.noPuede.includes(r.veredicto);
    rev(`caja ${c.caja} · ${c.que} → ${r.veredicto}`, vered,
      `no podía salir «${r.veredicto}» (prohibidos: ${c.noPuede.join(', ')})`);
    rev(`   el veredicto es uno de los tres`, VEREDICTOS.includes(r.veredicto), r.veredicto);
    rev('   hay mensaje y no es un párrafo eterno',
      r.mensaje.length > 20 && r.mensaje.length < 700, `${r.mensaje.length} caracteres`);

    // El registro se revisa en **todos** los mensajes. Lo de soplar, solo cuando el
    // alumno **no** dio con la respuesta: si ya la escribió él, repetírsela no le
    // enseña nada que no supiera, y la instrucción justamente pide decirle en una
    // frase qué entendió bien.
    const m = r.mensaje.toLowerCase();
    if (c.noPuede.includes('logrado')) {
      const soplo = (SOPLONES[c.caja] ?? []).filter((s) => m.includes(s));
      rev('   no sopla la respuesta', soplo.length === 0, `dijo: «${soplo.join('» · «')}»`);
    }
    rev('   habla de tú, no de vos', !VOSEO.test(r.mensaje),
      (r.mensaje.match(VOSEO) ?? []).join(' '));
    rev('   sin garabatos ni apelativos', !GARABATOS.test(r.mensaje),
      (r.mensaje.match(GARABATOS) ?? []).join(' '));

    console.log(`      «${r.mensaje.replace(/\s+/g, ' ')}»`);
  }
  console.log(`\n  · gasto de esta corrida: US$ ${gasto.toFixed(4)}`);
}

// ============================== Donde la tentación es máxima ==============================
// «No sé, ni idea» en una caja conceptual: el modelo tiene todo el contexto y nada
// que evaluar, así que es el momento en que más quiere explicar.

if (CODIGO === 'L1' && lab.sigla === 'DSY1107' && cajas.some((c) => c.id === '2.5')) {
  console.log('\nEl caso más tentador: «no sé, ni idea»');
  try {
    const r = await revisar({ lab, cajaId: '2.5', respuesta: 'no sé, ni idea' });
    const m = r.mensaje.toLowerCase();
    const soplo = SOPLONES['2.5'].filter((s) => m.includes(s));
    rev('no explica el mecanismo', soplo.length === 0, `dijo: «${soplo.join('» · «')}»`);
    rev('pero sí le dice dónde mirar',
      /paso|caja|token\.mjs|comando|wireshark|2\.\d|línea/i.test(r.mensaje));
    rev('habla de tú', !VOSEO.test(r.mensaje), (r.mensaje.match(VOSEO) ?? []).join(' '));
    console.log(`      «${r.mensaje.replace(/\s+/g, ' ')}»`);
  } catch (e) {
    rev('no explica el mecanismo', false, `el modelo falló: ${e.message}`);
  }
}

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
