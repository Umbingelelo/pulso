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

const conDosPuntos = compilar(
  `---\ncodigo: LX\ntitulo: Sonda\npuntos: 100\ndescripcion: Mira esto: viaja en texto plano\n---\n${CAJA_OK}`);
rev('una descripción con dos puntos adentro',
  conDosPuntos.problemas.length === 0
  && conDosPuntos.meta.descripcion === 'Mira esto: viaja en texto plano',
  JSON.stringify(conDosPuntos.problemas));

const numeros = compilar(conCabeza(':::control{1}\nUno.\n:::\n\n:::control{2}\nDos.\n:::' + CAJA_OK));
rev('controles correlativos', numeros.problemas.length === 0 && numeros.controles === 2,
  JSON.stringify(numeros.problemas));

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
      if (entrada.isFile() && entrada.name.endsWith('.md') && entrada.name !== 'README.md') {
        archivos.push(ruta);
      } else if (entrada.isDirectory()) {
        for (const dentro of await readdir(ruta)) {
          if (dentro.endsWith('.md') && dentro !== 'README.md') archivos.push(join(ruta, dentro));
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
  const { meta, bloques, ids, controles, problemas } = compilar(
    await readFile(ruta, 'utf8'));
  rev(`${archivo} compila limpio`, problemas.length === 0, problemas.join('\n      '));
  if (problemas.length) continue;
  rev(`  ${meta.codigo} · ${bloques.length} bloques · ${ids.length} cajas · ${controles} controles`,
    bloques.length > 0 && ids.length > 0);
  // Lo que se le queda pegado a un enunciado mal compilado y llega a la pantalla.
  const crudo = bloques.filter((b) => (b.html ?? b.enunciado ?? '')
    .match(/<p>\s*:::/));
  rev('  no queda ningún ::: suelto en la prosa', crudo.length === 0,
    JSON.stringify(crudo.map((b) => (b.html ?? b.enunciado).slice(0, 80))));
}

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
