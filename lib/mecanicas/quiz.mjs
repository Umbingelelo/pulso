/**
 * Mecánica «quiz»: una pregunta, cuatro alternativas, una correcta.
 *
 * La más simple de las veinte, y por eso la primera: deja armado el camino
 * completo —generar, validar, guardar, corregir— con la menor cantidad de piezas
 * nuevas. Las que vengan después se enchufan en el mismo lugar.
 *
 * El reparto de responsabilidades:
 *
 *   * el modelo **redacta**, con las piezas del banco de términos;
 *   * este archivo **valida y arma**, y es la única autoridad sobre si sirve;
 *   * Postgres **corrige**, contra una solución que nunca baja al navegador.
 *
 * ── Por qué no se le pide el índice de la correcta ──
 *
 * La primera versión le pedía `opciones` más un entero `correcta`. En seis
 * generaciones reales, **cuatro** salieron con el índice apuntando a otra
 * alternativa: la explicación describía la (c) y el índice decía (d). Un alumno
 * que responde bien queda marcado como que falló, y en silencio.
 *
 * No es un problema que se arregle pidiéndolo mejor: contar posiciones en un
 * arreglo es justo lo que a estos modelos les cuesta. Así que ya no se le pide.
 * El modelo entrega **la respuesta correcta y tres incorrectas**, cada una como
 * texto, y el índice lo calculamos nosotros al barajar.
 *
 * De paso resuelve algo que ya nos había mordido: al barajar acá, la posición de
 * la correcta queda repartida pareja. En el diagnóstico de DSY el 72% de las
 * respuestas correctas había caído en la B, y contestar todo B sacaba más de un
 * 70% sin leer nada.
 */

export const codigo = 'quiz';
export const nombre = 'Pregunta de alternativas';
export const mecanica = 'quiz';
export const banda = 'contenido';
export const xp = 25;

/** Lo que se le exige al modelo. Va tal cual como `json_schema` a OpenRouter. */
export const esquema = {
  type: 'object',
  additionalProperties: false,
  required: ['pregunta', 'respuesta_correcta', 'incorrectas', 'explicacion'],
  properties: {
    pregunta: {
      type: 'string',
      description: 'La pregunta, en español de Chile, clara y en una sola oración.',
    },
    respuesta_correcta: {
      type: 'string',
      description: 'La alternativa correcta. Sin letra ni número al principio.',
    },
    incorrectas: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string' },
      description: 'Tres alternativas incorrectas pero plausibles, de largo parecido a la correcta.',
    },
    explicacion: {
      type: 'string',
      description: 'Por qué esa es la correcta, dirigido al alumno. Máximo tres oraciones.',
    },
  },
};

export function instruccion({ termino, definicion, asignatura, fuente }) {
  return [
    `Eres ayudante de un curso de ${asignatura} en Duoc UC, Chile.`,
    '',
    'Escribe UNA pregunta de alternativas sobre este concepto, usando SOLO la',
    'definición que se te entrega. No agregues datos que no estén en ella.',
    '',
    `Concepto: ${termino}`,
    `Definición del docente: ${definicion}`,
    fuente ? `Se enseñó en la clase ${fuente}.` : '',
    '',
    'Reglas:',
    '- Español de Chile, tono directo, sin tratar al alumno de tonto.',
    '- Acentúa bien: «comunicación», «específico», «lógica». Se lee en Chile.',
    '- Las cuatro alternativas —la correcta y las tres incorrectas— de largo',
    '  parecido. Si desarrollas la correcta y despachas las otras en tres',
    '  palabras, el alumno acierta sin leer la pregunta.',
    '- Las incorrectas tienen que ser plausibles para alguien que estudió a',
    '  medias: confusiones reales, no chistes ni disparates evidentes.',
    '- Sin letra ni número ni guion al principio de cada alternativa.',
    '- Nada de «todas las anteriores» ni «ninguna de las anteriores».',
    '- No repitas la definición palabra por palabra en la correcta.',
    '- La explicación va dirigida AL ALUMNO, en segunda persona, y en tres',
    '  oraciones como máximo. No comentes tu propio diseño ni describas las',
    '  alternativas como «la A confunde X con Y»: eso es hablarle al profesor.',
  ].filter(Boolean).join('\n');
}

// ============================== Validación ==============================

const normalizar = (s) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

const CON_VINETA = /^\s*(\(?[a-dA-D1-4][).:]|[-•*])\s/;

export function validar(p, { termino } = {}) {
  const motivos = [];
  const push = (m) => motivos.push(m);

  if (!p || typeof p !== 'object') return { ok: false, motivos: ['no es un objeto'] };

  const pregunta = String(p.pregunta ?? '').trim();
  if (pregunta.length < 15) push('la pregunta es demasiado corta');
  if (pregunta.length > 320) push('la pregunta es demasiado larga');
  if (!/[?¿]/.test(pregunta)) push('la pregunta no pregunta nada');

  const correcta = String(p.respuesta_correcta ?? '').trim();
  if (!correcta) push('falta la respuesta correcta');

  if (!Array.isArray(p.incorrectas) || p.incorrectas.length !== 3) {
    push('no son exactamente tres alternativas incorrectas');
    return { ok: false, motivos: [...new Set(motivos)] };
  }

  const todas = [correcta, ...p.incorrectas.map((o) => String(o ?? '').trim())];

  if (todas.some((o) => o.length === 0)) push('hay una alternativa vacía');
  if (todas.some((o) => o.length > 220)) push('hay una alternativa demasiado larga');
  if (new Set(todas.map(normalizar)).size !== 4) push('hay alternativas repetidas');

  for (const o of todas) {
    if (/\b(todas|ninguna) las anteriores\b/i.test(o)) push('usa «todas/ninguna las anteriores»');
    // El modelo a veces enumera él mismo y la pantalla le agrega su propia letra,
    // así que el alumno lee «a) a) Es un método…». Salió en el quiz de Base64.
    if (CON_VINETA.test(o)) push('una alternativa viene con su propia letra o viñeta');
  }

  // El delator: la correcta desarrollada y las otras tres en dos palabras.
  const otras = todas.slice(1);
  const promedio = otras.reduce((s, o) => s + o.length, 0) / otras.length;
  if (promedio > 0 && correcta.length > promedio * 1.6) {
    push('la alternativa correcta es mucho más larga que las otras: se delata');
  }

  if (termino && normalizar(correcta) === normalizar(termino)) {
    push('la alternativa correcta es literalmente el término');
  }

  const explicacion = String(p.explicacion ?? '').trim();
  if (explicacion.length < 15) push('falta la explicación');
  if (explicacion.length > 600) push('la explicación es demasiado larga');

  // Sin repetir: los motivos se le mandan al modelo en el reintento, y cuatro
  // veces la misma frase solo gasta contexto y le resta énfasis a las demás.
  return { ok: motivos.length === 0, motivos: [...new Set(motivos)] };
}

// ============================== Armado ==============================

/** Fisher-Yates. La posición de la correcta la decidimos nosotros, no el modelo. */
function barajar(xs) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Devuelve el par completo: lo que ve el alumno y la pauta que se guarda.
 *
 * Van juntos a propósito. El índice de la correcta solo existe **después** de
 * barajar, así que separar esto en dos funciones obligaría a barajar dos veces
 * o a pasarse el orden entre ellas, y ahí es donde se cuela el desajuste que
 * estamos justamente evitando.
 */
export function armar(p, { termino, fuente } = {}) {
  const correcta = String(p.respuesta_correcta).trim();
  const opciones = barajar([correcta, ...p.incorrectas.map((o) => String(o).trim())]);
  const indice = opciones.findIndex((o) => o === correcta);

  return {
    enunciado: {
      mecanica: 'quiz',
      termino: termino ?? null,
      fuente: fuente ?? null,
      pregunta: String(p.pregunta).trim(),
      opciones,
    },
    solucion: {
      tipo: 'quiz',
      correcta: String(indice),
      explicacion: String(p.explicacion).trim(),
    },
  };
}
