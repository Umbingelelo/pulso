/**
 * El compilador de laboratorios, contra archivos de mentira y contra los de verdad.
 *
 *   node neon/probar-compilador.mjs
 *
 * No toca la base ni necesita `.env.local`: compila texto y mira lo que sale.
 *
 * ── Por qué existe ──
 *
 * Un laboratorio mal compilado no falla: llega así a la pantalla del alumno. Las
 * dos horas de trabajo se pierden igual, pero sin traza. Todos los casos de
 * «tiene que fallar» que hay acá abajo son cosas que el compilador **aceptaba en
 * silencio** y publicaba rotas:
 *
 *   - una caja indentada, o con un espacio antes de la llave, desaparecía entera
 *   - un `:::pists` mal escrito se imprimía tal cual al alumno
 *   - una caja dentro de un aviso desaparecía y el aviso se cerraba en el lugar
 *     equivocado
 *   - un bloque de código que mostrara esta misma sintaxis quedaba destrozado, y
 *     encima aparecía una caja fantasma que no pidió nadie
 *   - `puntos: 100 pts` publicaba el laboratorio con cero puntos
 *
 * Y la pauta trae un modo de falla propio, que es el peor de todos: si terminara
 * entre los bloques, el enunciado que llega al navegador vendría **con las
 * respuestas adentro**. Por eso acá no se comprueba solo que compile: se
 * comprueba que la pauta **no esté** en ningún bloque.
 *
 * Ninguna daba error. Por eso el criterio de este archivo no es «compila», es
 * «se queja de lo que tiene que quejarse».
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compilar } from './laboratorio-md.mjs';

/**
 * Dónde viven los laboratorios de verdad.
 *
 * Son dos carpetas porque son dos asignaturas, y las dos tienen un `L1`: el
 * código es único dentro de (asignatura, periodo), no en toda la base.
 */
const LABORATORIOS = [
  '../Desarrollo_Cloud_Native/Laboratorios',
  '../Arquitectura_de_Sistemas_IA/Laboratorios',
];

/**
 * Qué archivo es un enunciado y qué no.
 *
 * Junto a cada laboratorio de ITY1102 vive una `Guia-docente-*.md` que dice en su
 * primera línea «no se entrega a los alumnos»: es el reloj de la sesión y la pauta
 * del docente, no tiene encabezado y no tiene por qué tenerlo. Sin este filtro la
 * prueba las compilaba y reportaba dos fallos por archivos que están perfectos.
 */
const esEnunciado = (nombre) =>
  nombre.endsWith('.md') && nombre !== 'README.md' && !nombre.startsWith('Guia-docente');

let fallos = 0;
const rev = (etiqueta, ok, detalle = '') => {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}${ok || !detalle ? '' : `\n      ${detalle}`}`);
};

/** Un encabezado válido, para que los casos de abajo sólo tengan una cosa mala. */
const CABEZA = `---
codigo: LX
titulo: Sonda
puntos: 100
minutos: 90
orden: 10
---
`;
const conCabeza = (cuerpo) => CABEZA + '\n' + cuerpo;

/** Una caja de verdad, para que el caso no falle por «no tiene ninguna caja». */
const CAJA_OK = `
:::caja{9.1 corta}
Una caja sana.
:::
`;

// ============================== Lo que tiene que fallar ==============================

const RECHAZOS = [
  ['un aviso que no existe',
    ':::nota\nTypo de :::pista.\n:::' + CAJA_OK, 'no existe'],

  ['una caja con un formato que no existe',
    ':::caja{1.1 larga}\nAncha.\n:::', 'no es un formato de caja'],

  ['una caja con espacio antes de la llave',
    ':::caja {1.1 corta}\nSe perdía entera.\n:::' + CAJA_OK, 'no entiendo'],

  ['un marcador indentado',
    '- Un ítem:\n\n  :::caja{1.1 corta}\n  Se perdía entera.\n  :::' + CAJA_OK, 'indentado'],

  ['una caja anidada dentro de un aviso',
    ':::alerta\nOjo:\n\n:::caja{1.1 corta}\nSe perdía entera.\n:::\n:::' + CAJA_OK, 'no se anidan'],

  ['un identificador repetido',
    ':::caja{1.1 corta}\nUna.\n:::\n\n:::caja{1.1 corta}\nOtra.\n:::', 'repetido'],

  ['una caja sin identificador',
    ':::caja\nSin llave.\n:::' + CAJA_OK, 'necesita identificador'],

  ['sobra texto en la llave de una caja',
    ':::caja{1.1 corta y ancha}\nDe más.\n:::' + CAJA_OK, 'sobra'],

  ['un aviso con llave',
    ':::pista{1}\nNo lleva.\n:::' + CAJA_OK, 'no lleva llave'],

  // Sin CAJA_OK: una caja después de un bloque abierto dispara primero —y con
  // razón— el error de anidamiento, y taparía el que se quiere probar acá.
  ['un bloque sin cerrar',
    ':::pista\nY nunca cierra.', 'no se cierra'],

  ['un ::: de cierre suelto',
    'Prosa.\n\n:::' + CAJA_OK, 'sin bloque abierto'],

  ['un control sin número',
    ':::control{uno}\nMal.\n:::' + CAJA_OK, 'necesita un número'],

  ['controles con un salto',
    ':::control{1}\nUno.\n:::\n\n:::control{3}\nTres.\n:::' + CAJA_OK, 'correlativos'],

  ['controles repetidos',
    ':::control{1}\nUno.\n:::\n\n:::control{1}\nOtra vez uno.\n:::' + CAJA_OK, 'correlativos'],

  ['controles al revés',
    ':::control{2}\nDos.\n:::\n\n:::control{1}\nUno.\n:::' + CAJA_OK, 'correlativos'],

  ['un laboratorio sin ninguna caja',
    ':::pista\nSólo avisos.\n:::', 'ninguna caja de respuesta'],

  ['una cerca de código sin cerrar',
    '```bash\nnode -v' + CAJA_OK, 'no se cierra'],

  ['una pauta sin decir de qué caja es',
    CAJA_OK + ':::pauta\nLa respuesta.\n:::', 'necesita la caja'],

  ['una pauta de una caja que no existe',
    CAJA_OK + ':::pauta{7.7}\nLa respuesta.\n:::', 'no corresponde a ninguna caja'],

  ['dos pautas para la misma caja',
    CAJA_OK + ':::pauta{9.1}\nUna.\n:::\n\n:::pauta{9.1}\nOtra.\n:::', 'ya tiene pauta'],

  ['una pauta vacía',
    CAJA_OK + ':::pauta{9.1}\n:::', 'está vacía'],

  ['una pauta con algo más en la llave',
    CAJA_OK + ':::pauta{9.1 corta}\nLa respuesta.\n:::', 'solo el identificador'],

  // El typo que importa: `:::pauat` cae en la regla general y se caza como
  // cualquier otra clase inventada. Si en cambio se colara a prosa, el alumno
  // leería la respuesta correcta en pantalla.
  ['una pauta mal escrita',
    CAJA_OK + ':::pauat{9.1}\nLa respuesta.\n:::', 'no existe'],
];

console.log('Lo que tiene que rechazar');
for (const [etiqueta, cuerpo, contiene] of RECHAZOS) {
  const { problemas } = compilar(conCabeza(cuerpo));
  const ok = problemas.some((p) => p.includes(contiene));
  rev(etiqueta, ok, ok ? '' :
    `esperaba un problema con «${contiene}», dijo: ${JSON.stringify(problemas)}`);
}

// ============================== El encabezado ==============================

const ENCABEZADOS = [
  ['puntos que no son número', 'puntos: 100 pts', 'no es un número entero'],
  ['minutos que no son número', 'minutos: dos horas', 'no es un número entero'],
  ['orden que no es número', 'orden: primero', 'no es un número entero'],
  ['una llave con tilde', 'descripción: con tilde', 'no es una llave del encabezado'],
  ['una llave inventada', 'semana: 3', 'no es una llave del encabezado'],
];

console.log('\nEl encabezado');
for (const [etiqueta, linea, contiene] of ENCABEZADOS) {
  const texto = `---\ncodigo: LX\ntitulo: Sonda\npuntos: 100\n${linea}\n---\n${CAJA_OK}`;
  const { problemas } = compilar(texto);
  const ok = problemas.some((p) => p.includes(contiene));
  rev(etiqueta, ok, ok ? '' :
    `esperaba un problema con «${contiene}», dijo: ${JSON.stringify(problemas)}`);
}

for (const [etiqueta, linea, contiene] of [
  ['opcional que no es true ni false', 'opcional: si', 'tiene que ser true o false'],
  ['opcional sin decir qué lo abre',   'opcional: true', 'queda abierto desde el principio'],
  // «requiere: ninguno» es la forma de decir «opcional y abierto» a propósito. En
  // un laboratorio de la línea principal no significa nada, y aceptarlo callado
  // dejaría una línea que el que lea el encabezado en marzo no sabría interpretar.
  ['«requiere: ninguno» en uno obligatorio', 'requiere: ninguno', 'solo tiene sentido junto a'],
]) {
  const texto = `---\ncodigo: LX\ntitulo: Sonda\npuntos: 100\n${linea}\n---\n${CAJA_OK}`;
  const { problemas } = compilar(texto);
  const ok = problemas.some((p) => p.includes(contiene));
  rev(etiqueta, ok, ok ? '' : `dijo: ${JSON.stringify(problemas)}`);
}
{
  const texto = `---\ncodigo: LX\ntitulo: Sonda\npuntos: 100\nopcional: true\nrequiere: LX\n---\n${CAJA_OK}`;
  const { problemas } = compilar(texto);
  rev('un requiere que apunta a sí mismo',
    problemas.some((p) => p.includes('apunta a sí mismo')), JSON.stringify(problemas));
}

// ============================== El plazo ==============================
// `desde` y `hasta` marcan la ventana en que el laboratorio paga. Una fecha mal
// escrita que se aceptara en silencio es de las peores que hay acá: no falla en
// ninguna parte y el curso entero entrega a tiempo cobrando cero.

console.log('\nEl plazo');

const conPlazo = (lineas) =>
  `---\ncodigo: LX\ntitulo: Sonda\npuntos: 100\n${lineas}\n---\n${CAJA_OK}`;

for (const [etiqueta, lineas, contiene] of [
  ['una fecha al derecho y al revés', 'hasta: 24-08-2026',        'no es una fecha'],
  ['una fecha en palabras',           'hasta: el domingo',        'no es una fecha'],
  ['una hora sin minutos',            'hasta: 2026-08-24 23',     'no es una fecha'],
  ['un día que no existe',            'hasta: 2026-02-31',        'no existe en el calendario'],
  ['un mes que no existe',            'desde: 2026-13-01',        'no existe en el calendario'],
  ['el plazo al revés', 'desde: 2026-08-24\nhasta: 2026-08-18', 'terminaría antes de empezar'],
]) {
  const { problemas } = compilar(conPlazo(lineas));
  const ok = problemas.some((p) => p.includes(contiene));
  rev(etiqueta, ok, ok ? '' :
    `esperaba un problema con «${contiene}», dijo: ${JSON.stringify(problemas)}`);
}

for (const [etiqueta, lineas, esperado] of [
  // El caso que importa de verdad: «hasta» sin hora tiene que ser el último minuto
  // del día. Si fuera medianoche, el domingo completo quedaría fuera del plazo —y
  // el domingo es cuando entrega el que dejó el laboratorio para el final.
  ['«hasta» sin hora llega al final del día', 'hasta: 2026-08-24',
    { hasta: '2026-08-24T23:59' }],
  ['«desde» sin hora empieza al principio',   'desde: 2026-08-18',
    { desde: '2026-08-18T00:00' }],
  ['con hora se respeta la que dice', 'desde: 2026-08-18 08:30\nhasta: 2026-08-24 20:00',
    { desde: '2026-08-18T08:30', hasta: '2026-08-24T20:00' }],
  ['la «T» en medio también sirve', 'hasta: 2026-08-24T20:00',
    { hasta: '2026-08-24T20:00' }],
]) {
  const { meta, problemas } = compilar(conPlazo(lineas));
  const ok = problemas.length === 0
    && Object.entries(esperado).every(([k, v]) => meta[k] === v);
  rev(etiqueta, ok,
    `problemas: ${JSON.stringify(problemas)}, desde: ${meta.desde}, hasta: ${meta.hasta}`);
}

{
  // Sin plazo es lo normal y tiene que seguir compilando: así están todos los
  // laboratorios que ya se subieron.
  const { meta, problemas } = compilar(conPlazo('minutos: 90'));
  rev('sin plazo no es un problema',
    problemas.length === 0 && meta.desde === undefined && meta.hasta === undefined,
    JSON.stringify(problemas));
}

for (const [etiqueta, texto, contiene] of [
  ['sin encabezado', `## Hola\n${CAJA_OK}`, 'falta el encabezado'],
  ['encabezado sin cerrar', `---\ncodigo: LX\ntitulo: Sonda\n${CAJA_OK}`, 'no se cierra'],
  ['sin código', `---\ntitulo: Sonda\npuntos: 100\n---\n${CAJA_OK}`, 'falta «codigo»'],
  ['sin puntos', `---\ncodigo: LX\ntitulo: Sonda\n---\n${CAJA_OK}`, 'falta «puntos»'],
]) {
  const { problemas } = compilar(texto);
  const ok = problemas.some((p) => p.includes(contiene));
  rev(etiqueta, ok, ok ? '' :
    `esperaba un problema con «${contiene}», dijo: ${JSON.stringify(problemas)}`);
}

// ============================== Lo que tiene que aceptar ==============================
// La otra mitad: apretar de más rompe laboratorios que estaban bien.

console.log('\nLo que tiene que aceptar');

const bloqueDeCodigo = compilar(conCabeza(
  'Así se escribe una caja:\n\n' +
  '```text\n:::caja{9.9 corta}\nEsto es documentación, no una caja.\n:::\n```\n' + CAJA_OK));
rev('un bloque de código que muestra esta misma sintaxis',
  bloqueDeCodigo.problemas.length === 0 && bloqueDeCodigo.ids.join() === '9.1',
  `problemas: ${JSON.stringify(bloqueDeCodigo.problemas)}, cajas: ${bloqueDeCodigo.ids.join(', ')}`);
rev('y el código llega entero al alumno',
  bloqueDeCodigo.bloques.some((b) => b.tipo === 'html' && b.html.includes(':::caja{9.9 corta}')));

const cercaEnBloque = compilar(conCabeza(
  ':::alerta\nCuidado:\n\n```bash\n:::caja{9.9 corta}\n```\n\nSigue la alerta.\n:::' + CAJA_OK));
rev('una cerca de código dentro de un aviso',
  cercaEnBloque.problemas.length === 0 && cercaEnBloque.ids.join() === '9.1'
  && cercaEnBloque.bloques.find((b) => b.clase === 'alerta')?.html.includes('Sigue la alerta'),
  JSON.stringify(cercaEnBloque.problemas));

const cercaTilde = compilar(conCabeza('~~~text\n:::pista\n~~~\n' + CAJA_OK));
rev('lo mismo con cerca de ~~~', cercaTilde.problemas.length === 0,
  JSON.stringify(cercaTilde.problemas));

const sinFormato = compilar(conCabeza(':::caja{1.1}\nSin formato.\n:::'));
rev('una caja sin formato queda corta',
  sinFormato.problemas.length === 0
  && sinFormato.bloques.find((b) => b.tipo === 'caja')?.formato === 'corta',
  JSON.stringify(sinFormato.problemas));

const separadores = compilar(conCabeza(
  '## Uno\n\n---\n\n## Dos\n\n---\n\n## Tres\n' + CAJA_OK));
rev('los --- del cuerpo son separadores y no cortan el enunciado',
  separadores.problemas.length === 0
  && separadores.bloques.filter((b) => b.tipo === 'html')
       .map((b) => b.html).join('').split('<hr>').length - 1 === 2,
  JSON.stringify(separadores.problemas));

// El título con dos puntos adentro se escribe entre comillas, y las comillas no
// pueden llegar a la pantalla del alumno.
const entreComillas = compilar(
  `---\ncodigo: LX\ntitulo: "Desafío 1 · Hablar HTTP a mano"\npuntos: 100\n---\n${CAJA_OK}`);
rev('un título entre comillas pierde las comillas',
  entreComillas.meta.titulo === 'Desafío 1 · Hablar HTTP a mano',
  JSON.stringify(entreComillas.meta.titulo));

const opcionalBien = compilar(
  `---\ncodigo: X1\ntitulo: Desafío\npuntos: 100\nopcional: true\nrequiere: L1\n---\n${CAJA_OK}`);
rev('un opcional bien declarado se acepta',
  opcionalBien.problemas.length === 0
  && opcionalBien.meta.opcional === 'true' && opcionalBien.meta.requiere === 'L1',
  JSON.stringify(opcionalBien.problemas));

// El opcional **autosuficiente**: se puede hacer suelto, así que va abierto. Es el
// L2B de ITY1102, y su guía docente lo dice con esas palabras. Lo que se comprueba
// es que `requiere` quede **sin valor**: con «ninguno» ahí, `laboratorio_falta`
// buscaría una actividad de código «ninguno» y el candado no se abriría nunca.
const opcionalAbierto = compilar(
  `---\ncodigo: L2B\ntitulo: Opcional\npuntos: 100\nopcional: true\nrequiere: ninguno\n---\n${CAJA_OK}`);
rev('un opcional autosuficiente se declara con «requiere: ninguno»',
  opcionalAbierto.problemas.length === 0
  && opcionalAbierto.meta.opcional === 'true'
  && opcionalAbierto.meta.requiere === undefined,
  JSON.stringify({ problemas: opcionalAbierto.problemas, requiere: opcionalAbierto.meta.requiere }));

const conDosPuntos = compilar(
  `---\ncodigo: LX\ntitulo: Sonda\npuntos: 100\ndescripcion: Mira esto: viaja en texto plano\n---\n${CAJA_OK}`);
rev('una descripción con dos puntos adentro',
  conDosPuntos.problemas.length === 0
  && conDosPuntos.meta.descripcion === 'Mira esto: viaja en texto plano',
  JSON.stringify(conDosPuntos.problemas));

const numeros = compilar(conCabeza(':::control{1}\nUno.\n:::\n\n:::control{2}\nDos.\n:::' + CAJA_OK));
rev('controles correlativos', numeros.problemas.length === 0 && numeros.controles === 2,
  JSON.stringify(numeros.problemas));

// ============================== La pauta ==============================
// La respuesta correcta sale por `pautas` y **no** puede aparecer en ningún
// bloque: los bloques son literalmente lo que el navegador dibuja.

console.log('\nLa pauta');

const conPauta = compilar(conCabeza(
  CAJA_OK + ':::pauta{9.1}\nLa respuesta es **42** y se justifica así.\n:::'));
rev('una pauta bien escrita se acepta', conPauta.problemas.length === 0,
  JSON.stringify(conPauta.problemas));
rev('  llega a pautas, con su Markdown crudo',
  conPauta.pautas['9.1'] === 'La respuesta es **42** y se justifica así.',
  JSON.stringify(conPauta.pautas));
rev('  y NO queda ningún bloque de pauta',
  !conPauta.bloques.some((b) => b.tipo === 'pauta' || b.clase === 'pauta'),
  JSON.stringify(conPauta.bloques.map((b) => b.tipo ?? b.clase)));
rev('  ni el texto de la respuesta aparece en lo que se dibuja',
  !JSON.stringify(conPauta.bloques).includes('42'),
  JSON.stringify(conPauta.bloques));
rev('  y el enunciado queda igual que sin ella',
  conPauta.bloques.length === compilar(conCabeza(CAJA_OK)).bloques.length);

// Una pauta que documenta esta sintaxis, o que trae un ejemplo de salida, lleva
// cercas de código adentro. Es el caso normal en un laboratorio de terminal.
const pautaConCerca = compilar(conCabeza(
  CAJA_OK + ':::pauta{9.1}\nTiene que verse así:\n\n```\nHTTP/1.1 200 OK\n```\n:::'));
rev('una pauta con una cerca de código adentro',
  pautaConCerca.problemas.length === 0
  && pautaConCerca.pautas['9.1'].includes('HTTP/1.1 200 OK'),
  JSON.stringify(pautaConCerca.problemas));

// Sin pauta, `pautas` existe y está vacío: quien lo lee no tiene que preguntarse
// si es undefined. Así están publicados L0, L1 y X1.
const sinPauta = compilar(conCabeza(CAJA_OK));
rev('un laboratorio sin pautas devuelve un objeto vacío, no undefined',
  sinPauta.problemas.length === 0 && Object.keys(sinPauta.pautas ?? {}).length === 0,
  JSON.stringify(sinPauta.pautas));

const linea = compilar(`---\ncodigo: LX\ntitulo: Sonda\npuntos: 100\n---\n\n\n\n:::caja {1.1}\nx\n:::\n`);
rev('el número de línea apunta al archivo, no al cuerpo',
  linea.problemas.some((p) => p.startsWith('línea 9:')), JSON.stringify(linea.problemas));

// ============================== Los laboratorios de verdad ==============================
// La red de seguridad: las reglas nuevas no pueden rechazar lo que ya está publicado.

console.log('\nLos laboratorios de verdad');
const archivos = [];
for (const carpeta of LABORATORIOS) {
  try {
    // Un nivel de subcarpetas: el L1 de ITY vive dentro de la carpeta del
    // laboratorio, junto a su notebook y sus guías.
    for (const entrada of await readdir(carpeta, { withFileTypes: true })) {
      const ruta = join(carpeta, entrada.name);
      if (entrada.isFile() && esEnunciado(entrada.name)) {
        archivos.push(ruta);
      } else if (entrada.isDirectory()) {
        for (const dentro of await readdir(ruta)) {
          if (esEnunciado(dentro)) archivos.push(join(ruta, dentro));
        }
      }
    }
  } catch {
    console.log(`  · no encontré ${carpeta}, me la salto`);
  }
}
archivos.sort();
for (const ruta of archivos) {
  const archivo = ruta.split('/').pop();
  const { meta, bloques, ids, pautas, controles, problemas } = compilar(
    await readFile(ruta, 'utf8'));
  rev(`${archivo} compila limpio`, problemas.length === 0, problemas.join('\n      '));
  if (problemas.length) continue;
  const conPauta = Object.keys(pautas).length;
  rev(`  ${meta.codigo} · ${bloques.length} bloques · ${ids.length} cajas · ${controles} controles`
    + ` · ${conPauta}/${ids.length} pautas`,
    bloques.length > 0 && ids.length > 0);
  // Lo que se le queda pegado a un enunciado mal compilado y llega a la pantalla.
  const crudo = bloques.filter((b) => (b.html ?? b.enunciado ?? '')
    .match(/<p>\s*:::/));
  rev('  no queda ningún ::: suelto en la prosa', crudo.length === 0,
    JSON.stringify(crudo.map((b) => (b.html ?? b.enunciado).slice(0, 80))));

  // La comprobación que justifica todo el diseño de la pauta, hecha contra los
  // archivos de verdad: ni una frase de ninguna pauta puede estar en los bloques,
  // porque los bloques son lo que viaja al navegador. Se compara por frases
  // largas —no por palabras— para que «la respuesta» o «el token» no den falsos
  // positivos contra el enunciado, que naturalmente habla de lo mismo.
  if (conPauta) {
    const dibujado = JSON.stringify(bloques);
    const filtradas = [];
    for (const [id, texto] of Object.entries(pautas)) {
      for (const frase of texto.split(/[\n.;]/).map((f) => f.trim())) {
        if (frase.length >= 60 && dibujado.includes(frase)) filtradas.push(`${id}: ${frase}`);
      }
    }
    rev('  ninguna pauta se filtró a los bloques', filtradas.length === 0,
      filtradas.join('\n      '));
  }
}

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
