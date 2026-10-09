/**
 * Lo que comparten las mecánicas de la misión diaria.
 *
 * Cada mecánica es un archivo con la misma forma —esquema, instrucción, validador
 * y armado— y casi todas necesitan lo mismo: presentar el concepto, calibrar con
 * el perfil, normalizar texto para comparar y barajar. Estaba copiado dentro de
 * `quiz.mjs`; con cinco mecánicas, cinco copias terminan siendo cinco versiones.
 *
 * ── Dos tamaños de contexto, por plata ──
 *
 * El prompt de entrada es lo que más pesa en el gasto: lo que el modelo escribe
 * son unas 150 palabras, lo que se le manda antes eran 330 tokens y subiendo
 * (el curso, la clase en curso, el recorrido entero, el perfil). Por eso hay dos
 * tamaños:
 *
 *   * `ligero`: el concepto, su definición y una línea de nivel. Basta cuando la
 *     mecánica se corrige contra la definición (verdadero/falso, corrección).
 *   * `completo`: suma qué es el curso y dónde va. Se usa cuando el modelo tiene
 *     que **aplicar** el concepto (quiz, diagrama, desarrollo) y sin saber el
 *     nivel escribe cosas desubicadas.
 *
 * El recorrido —los títulos de todo lo que el alumno ya vio— se recorta a las
 * últimas clases: la definición del docente ya delimita la materia, y la lista
 * entera crece con el semestre sin aportar nada.
 */

/** Cuántas clases del recorrido viajan en el prompt. */
export const MAX_RECORRIDO = 5;

export const normalizar = (s) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Fisher-Yates. El orden de las piezas lo decidimos nosotros, no el modelo. */
export function barajar(xs, azar = Math.random) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Elige un elemento al azar. */
export const uno = (xs, azar = Math.random) => xs[Math.floor(azar() * xs.length)];

/**
 * Palabras absolutas. Un distractor que dice «siempre», «nunca» o «únicamente» se
 * descarta solo: los alumnos lo aprenden en la segunda semana, y es la pista más
 * vieja de las pruebas de alternativas.
 */
export const ABSOLUTOS = /\b(siempre|nunca|jamas|unicamente|exclusivamente|todos|ninguno|ninguna|solo|solamente|obligatoriamente)\b/;

export const tieneAbsoluto = (s) => ABSOLUTOS.test(normalizar(s));

/** El perfil del alumno, traducido a una sola línea de nivel. Sin nombre ni notas. */
export function nivel(perfil) {
  return {
    base: 'Este alumno viene costándole: pregunta directa y sobre lo esencial, sin matices finos.',
    media: 'Dificultad normal: hay que haber entendido el concepto, no solo leído la palabra.',
    alta: 'Este alumno viene acertando casi todo: que tenga que aplicar el concepto a una situación.',
  }[perfil?.dificultad] ?? '';
}

/** Dónde está parado el curso. Solo en el tamaño `completo`. */
function elCurso({ contexto, clase_actual, recorrido }) {
  const l = [];
  if (contexto) l.push(`Sobre el curso: ${contexto}`);
  if (clase_actual) l.push(`El curso va en la clase ${clase_actual.codigo}: «${clase_actual.titulo}».`);
  const vistas = (recorrido ?? []).slice(-MAX_RECORRIDO).map((c) => `${c.codigo} ${c.titulo}`);
  if (vistas.length) l.push(`Lo último que vio el alumno: ${vistas.join('; ')}.`);
  return l;
}

/**
 * El arranque común de todas las instrucciones.
 *
 * @param {'ligero'|'completo'} tamano
 */
export function apertura(ctx, tamano = 'completo') {
  const { termino, definicion, asignatura, fuente } = ctx;
  return [
    `Eres ayudante de un curso de ${asignatura} en Duoc UC, Chile.`,
    ...(tamano === 'completo' ? elCurso(ctx) : []),
    nivel(ctx.perfil),
    '',
    `Concepto: ${termino}`,
    `Definición del docente: ${definicion}`,
    fuente ? `Se enseñó en la clase ${fuente}.` : '',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '');
}

/** Reglas de estilo que valen para todo lo que el modelo escribe de cara al alumno. */
export const ESTILO = [
  '- Español de Chile **de tú**: «mira», «revisa», «tienes». Nunca voseo («mirá», «tenís», «podés»).',
  '- Respetuoso y sobrio, aunque lo que escribió el alumno no tenga sentido. Nunca garabatos,',
  '  apelativos ni jerga: ni «weón», ni «cachai», ni «cabro». Eres el ayudante de un ramo.',
  '- Con tildes: «comunicación», «lógica».',
  '- No menciones el desempeño del alumno ni hables del diseño del ejercicio.',
];

/**
 * Lo que no puede salir nunca en un texto del modelo, aunque la instrucción ya lo
 * prohíba. Pasó: con «español de Chile» a secas, la corrección de una respuesta
 * sin sentido empezó con «Weón, …» y siguió con «no cachai». La regla en la
 * instrucción baja la frecuencia; esta comprobación es la que impide que llegue.
 */
const GROSERO = /\b(we[oó]n|hue[oó]n|wn|cach[aá]i|cabr[oa]|qli|ctm|culiao)/i;
// Solo las formas con tilde: «mira» sin tilde es tuteo y está bien.
const VOSEO = /\b(mirá|revisá|volvé|leé|fijate|tenés|tenís|podés|querés|sabés)/i;

/** Motivos por los que un texto para el alumno no sirve; vacío si sirve. */
export function problemasDeTono(texto) {
  const t = String(texto ?? '');
  const motivos = [];
  if (GROSERO.test(t)) motivos.push('usa un garabato, un apelativo o jerga; escribe sobrio y respetuoso');
  if (VOSEO.test(t)) motivos.push('usa voseo; tutea («mira», «tienes»)');
  return motivos;
}

/**
 * Cómo se reparte el largo entre alternativas. Es la comprobación que la
 * mecánica `quiz` y el `diagrama` comparten: la correcta no puede ser la más
 * larga por más de un 10%, que es lo que los alumnos detectan.
 *
 * @returns {string|null} el motivo del rechazo, o null si está bien
 */
export function sesgoDeLargo(correcta, incorrectas, margen = 0.10) {
  const masLarga = Math.max(...incorrectas.map((o) => o.length));
  if (correcta.length > masLarga * (1 + margen)) {
    return 'la alternativa correcta es la más larga por más de un 10%: se delata';
  }
  return null;
}
