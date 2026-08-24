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
 *   - Que **la pauta llegue al modelo y no al alumno**. Es lo nuevo, y es lo más
 *     fácil de romper: la respuesta correcta está ahora escrita dentro de la
 *     instrucción, así que el modelo la tiene a mano justo cuando más quiere
 *     explicar. Por eso las pruebas de soplo de abajo se corren sobre las cajas
 *     conceptuales de L2, que son las que tienen pauta.
 *
 * Con `--caja` prueba una sola, para iterar la instrucción sin pagar las demás.
 */
import { neon } from '@neondatabase/serverless';
import { armarContexto, armarInstruccion, huella, revisar, VEREDICTOS } from '../lib/revision-lab.mjs';

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
  select a.codigo, a.titulo, l.bloques, l.pautas, asg.sigla,
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
const pautas = lab.pautas ?? {};
console.log(`${lab.sigla} · ${lab.codigo} · ${lab.titulo} · ${cajas.length} cajas · `
  + `${Object.keys(pautas).length} pautas`);

/** La pauta de una caja, o undefined. Es lo que `/api/laboratorio` le pasa a `revisar`. */
const pautaDe = (id) => pautas[id] ?? undefined;

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

const ins = armarInstruccion(lab, unaCaja.id, 'una respuesta cualquiera', pautaDe(unaCaja.id));
rev('la instrucción prohíbe dar la respuesta',
  /No puedes escribir la respuesta/.test(ins) && /te está \*\*prohibido\*\* afirmar un hecho/i.test(ins));
rev('trae el ejemplo de lo prohibido y lo permitido',
  ins.includes('PROHIBIDO:') && ins.includes('PERMITIDO:'));
rev('pide tú y prohíbe el voseo', /Nunca vos ni voseo/.test(ins));
rev('prohíbe los garabatos', /Nunca garabatos/.test(ins));
rev('y dice qué escribió el alumno', ins.includes('una respuesta cualquiera'));
console.log(`  · instrucción completa: ${ins.length.toLocaleString('es')} caracteres`);

// ── La pauta ──
// Dos comprobaciones y las dos importan: que llegue cuando existe, y que **no
// deje rastro** cuando no. Un encabezado de pauta vacío invita al modelo a
// comentarle al alumno que no hay pauta, que no es asunto suyo.
console.log('\nLa pauta dentro de la instrucción');
const conPauta = cajas.find((c) => pautaDe(c.id));
if (!conPauta) {
  console.log(`  · ${CODIGO} se publicó sin pautas, no hay nada que comprobar acá`);
} else {
  const insP = armarInstruccion(lab, conPauta.id, 'lo que sea', pautaDe(conPauta.id));
  rev(`la pauta de la caja ${conPauta.id} llega entera`,
    insP.includes(pautaDe(conPauta.id).slice(0, 200)));
  rev('viene rotulada como para el modelo y no para el alumno',
    /ES PARA TI, NO PARA ÉL/.test(insP));
  rev('y con la prohibición de citarla al lado',
    /No la cites, no la parafrasees/.test(insP));
  rev('va después del enunciado y antes de lo que escribió el alumno',
    insP.indexOf('LA PAUTA DE LA CAJA') > insP.indexOf('FIN DEL LABORATORIO')
    && insP.indexOf('LA PAUTA DE LA CAJA') < insP.indexOf('LO QUE EL ALUMNO ESCRIBIÓ'));

  const insSin = armarInstruccion(lab, conPauta.id, 'lo que sea');
  rev('sin pauta no queda ni el encabezado',
    !insSin.includes('LA PAUTA DE LA CAJA') && !insSin.includes('pauta'),
    (insSin.match(/.{0,40}pauta.{0,40}/gi) ?? []).join(' · '));

  const h1 = await huella('lo mismo', conPauta.enunciado, pautaDe(conPauta.id));
  const h2 = await huella('lo mismo', conPauta.enunciado, `${pautaDe(conPauta.id)} y algo más`);
  const h3 = await huella('lo mismo', conPauta.enunciado);
  rev('editar la pauta invalida la caché de esa caja', h1 !== h2);
  rev('y sin pauta la huella es la de siempre',
    h3 === await huella('lo mismo', conPauta.enunciado, ''));
}

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
  // DSY · L2. Ojo con lo que **no** va acá: el enunciado de estas cajas ya nombra
  // «una clave», «claves públicas» y «cambiarse de correo», así que señalar esas
  // palabras es apuntar, no soplar. Lo que sopla es el razonamiento: por qué la
  // clave propia no protege, para qué sirve una pública, qué le pasa a un correo.
  '2.2': ['la misma clave', 'clave compartida', 'secreto compartido', 'simétric',
          'cualquiera que tenga la clave', 'quien tenga la clave',
          'no la verifica', 'no la comprueba', 'no verifica la firma',
          'puede fabricar otro', 'puede firmar otro', 'puede generar otro'],
  '6.2': ['solo sirve para verificar', 'sólo sirve para verificar', 'solo permite verificar',
          'no sirve para firmar', 'no se puede firmar', 'no permite firmar',
          'solo verifica', 'la privada no sale', 'asimétric'],
  '8.3': ['el correo puede cambiar', 'el correo cambia', 'el correo se puede cambiar',
          'es inmutable', 'no cambia nunca', 'perdería sus datos', 'perdería su historial'],
  // Ojo con lo que **no** está acá: «la firma». La palabra la da el propio
  // enunciado dos secciones más abajo —«en D3 vas a ver qué es esa tercera parte:
  // la firma digital»—, así que nombrarla no le entrega nada que no haya leído, y
  // exigir que no aparezca hacía fallar mensajes que no soplaban nada. Lo que el
  // alumno tiene que producir, y por eso sí está acá, es el razonamiento.
  '10.2': ['firmado con la clave privada', 'se habría caído', 'ya no corresponde',
           'no calza con la carga', 'habría dado 401', 'no se puede recalcular'],
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

/**
 * Los de L2, que es el primer laboratorio publicado **con pauta**.
 *
 * Son las cajas conceptuales, a propósito: en las de pegar una salida la pauta
 * ayuda poco —el modelo ya podía ver si lo pegado corresponde a ese paso— y en
 * las conceptuales es donde cambia el criterio. Hay dos casos que antes de la
 * pauta salían mal seguido: la respuesta a medias que se daba por lograda, y la
 * caja de encuesta —«¿cuánto te demoró?»— que salía «incompleto» porque el modelo
 * buscaba contenido técnico donde no hay.
 */
const CASOS_L2 = (CODIGO !== 'L2' || lab.sigla !== 'DSY1107') ? [] : [
  {
    caja: '2.2',
    que: 'la razón correcta: la clave es suya',
    respuesta: 'Porque esa clave la elegí yo y está escrita en mi propio token.mjs, ' +
      'así que cualquiera que la vea puede firmar los tokens que quiera y salen iguales. ' +
      'Y el gateway igual no la revisa, no conoce ninguna clave.',
    noPuede: ['incompleto'],
  },
  {
    caja: '2.2',
    que: 'la confusión clásica: cree que la firma cifra',
    respuesta: 'Sí sirve, porque al firmarlo con createHmac queda encriptado y nadie ' +
      'puede leer ni cambiar lo que va adentro.',
    noPuede: ['logrado'],
  },
  {
    caja: '2.2',
    que: 'en blanco',
    respuesta: '  ',
    noPuede: ['logrado', 'parcial'],
  },
  {
    caja: '6.2',
    que: 'una intuición bien encaminada, que la caja acepta explícitamente',
    respuesta: 'Porque con esas claves solo se puede comprobar la firma, no hacerla. ' +
      'La que firma se la queda Microsoft y no la publica.',
    noPuede: ['incompleto'],
  },
  {
    caja: '6.2',
    que: 'al revés: cree que con eso se pueden falsificar tokens',
    respuesta: 'Es un problema igual, porque con esas claves cualquiera podría firmar ' +
      'un token falso y hacerlo pasar por bueno.',
    noPuede: ['logrado'],
  },
  {
    caja: '10.2',
    que: 'nombra la firma y qué habría pasado',
    respuesta: 'En la tercera parte va la firma que puso Entra. Si el gateway la hubiera ' +
      'revisado, al cambiarle el sub la firma ya no cuadraba con el contenido y lo habría ' +
      'rechazado, porque para hacer una firma nueva se necesita la clave de Microsoft.',
    noPuede: ['incompleto'],
  },
  {
    caja: '10.2',
    que: 'dice que la tercera parte es otra cosa',
    respuesta: 'La tercera parte son los permisos del usuario, así que si el gateway la ' +
      'hubiera mirado habría visto que soy el director y me habría dado más acceso.',
    noPuede: ['logrado'],
  },
  // Las dos que la pauta está justamente para arreglar.
  {
    caja: '4.1',
    que: 'pega un solo client ID cuando la caja pide los dos',
    respuesta: '3f2b8c91-4d5e-4a7b-9c1d-2e3f4a5b6c7d',
    noPuede: ['logrado'],
  },
  {
    caja: '11.2',
    que: 'una respuesta de encuesta, que es todo lo que esa caja pide',
    respuesta: 'Me demoró como tres horas y media. Donde más me atasqué fue en el ' +
      'tramo 7, con el login, porque me llevaba a la cuenta de Duoc.',
    noPuede: ['incompleto', 'parcial'],
  },
  {
    caja: '13.1',
    que: 'dice que no le quedó ninguna duda, que también es una respuesta completa',
    respuesta: 'No, nada. Todo calzó con la guía.',
    noPuede: ['incompleto'],
  },
];

const soloCaja = args.caja ? String(args.caja) : null;
const casos = [...CASOS, ...CASOS_ITY, ...CASOS_L2].filter((c) => !soloCaja || c.caja === soloCaja);

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
      r = await revisar({ lab, cajaId: c.caja, respuesta: c.respuesta, pauta: pautaDe(c.caja) });
    } catch (e) {
      rev(`caja ${c.caja} · ${c.que}`, false, `el modelo falló: ${e.message}`);
      continue;
    }
    gasto += r.costo;

    const vered = !c.noPuede.includes(r.veredicto);
    rev(`caja ${c.caja} · ${c.que} → ${r.veredicto}`, vered,
      `no podía salir «${r.veredicto}» (prohibidos: ${c.noPuede.join(', ')})`);
    rev(`   el veredicto es uno de los tres`, VEREDICTOS.includes(r.veredicto), r.veredicto);
    // Que **haya** mensaje se comprueba acá y además se exige en `revisar()`, que
    // reintenta si vuelve vacío. Los dos, porque esto se midió: el modelo devolvió
    // un «incompleto» con el mensaje en blanco, y un recuadro vacío bajo un
    // «Vuelve a mirarlo» es peor que no haber pedido la sugerencia.
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

if (CODIGO === 'L2' && lab.sigla === 'DSY1107' && pautaDe('2.2')) {
  console.log('\nEl caso más tentador, ahora con la respuesta escrita al lado');
  try {
    const r = await revisar({ lab, cajaId: '2.2', respuesta: 'no sé, ni idea',
                              pauta: pautaDe('2.2') });
    const m = r.mensaje.toLowerCase();
    const soplo = SOPLONES['2.2'].filter((x) => m.includes(x));
    rev('no repite la pauta', soplo.length === 0, `dijo: «${soplo.join('» · «')}»`);
    rev('no menciona que existe una pauta', !/pauta|rúbrica|rubrica|criterio del docente/i.test(r.mensaje),
      r.mensaje);
    rev('pero sí le dice dónde mirar',
      /paso|caja|token\.mjs|createhmac|clave|tramo|2\.\d|línea/i.test(r.mensaje));
    rev('habla de tú', !VOSEO.test(r.mensaje), (r.mensaje.match(VOSEO) ?? []).join(' '));
    console.log(`      «${r.mensaje.replace(/\s+/g, ' ')}»`);
  } catch (e) {
    rev('no repite la pauta', false, `el modelo falló: ${e.message}`);
  }
}

if (CODIGO === 'L1' && lab.sigla === 'DSY1107' && cajas.some((c) => c.id === '2.5')) {
  console.log('\nEl caso más tentador: «no sé, ni idea»');
  try {
    const r = await revisar({ lab, cajaId: '2.5', respuesta: 'no sé, ni idea', pauta: pautaDe('2.5') });
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
