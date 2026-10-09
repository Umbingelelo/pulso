/**
 * Mecánica «quiz»: una pregunta, cuatro alternativas, una correcta.
 *
 * La primera de las mecánicas, y por eso la más simple: dejó armado el camino
 * completo —generar, validar, guardar, corregir— con la menor cantidad de piezas
 * nuevas. Las demás se enchufan en el mismo lugar (ver `lib/misiones.mjs`).
 *
 * Sola era monótona —una alternativa al día, todos los días— y tenía un vicio que
 * los alumnos detectaron: la correcta tendía a ser la más larga. Desde la 0043
 * convive con otras cuatro y el validador es más estricto con el largo.
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

import {
  apertura, ESTILO, barajar, normalizar, sesgoDeLargo,
} from './comun.mjs';

export const codigo = 'quiz';
export const nombre = 'Pregunta de alternativas';
export const mecanica = 'quiz';
export const banda = 'contenido';
/** Lo que paga la plantilla. La verdad está en `mision_plantillas.xp`; esto es la semilla. */
export const xp = 75;
export const usaModelo = true;
/** Tope de salida: la pregunta pesa ~190 tokens, esto deja holgura sin dejar correr al modelo. */
export const maxTokens = 450;

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

/**
 * Se decide acá, una vez por misión, y no en cada intento: el reintento tiene
 * que seguir la misma consigna para que el validador y la instrucción hablen de
 * lo mismo. Con 40% de probabilidad se le exige que la correcta sea la más corta.
 */
export function preparar(ctx, azar = Math.random) {
  return { ...ctx, pista_largo: azar() < 0.4 ? 'corta' : 'libre' };
}

export function instruccion(ctx) {
  const largo = ctx.pista_largo === 'corta'
    ? '- La correcta debe ser la alternativa MÁS CORTA de las cuatro; las incorrectas, un poco más largas y detalladas.'
    : '- La correcta NO puede ser la más larga: escribe las tres incorrectas bien desarrolladas y la correcta de largo igual o menor.';
  return [
    ...apertura(ctx, 'completo'),
    '',
    'Escribe UNA pregunta de alternativas sobre este concepto, usando SOLO la',
    'definición del docente: no agregues datos que no estén en ella.',
    '',
    'Reglas:',
    '- Cuatro alternativas (una correcta y tres incorrectas) de largo parecido, sin letra,',
    '  número ni guion al principio, y sin «todas/ninguna de las anteriores».',
    largo,
    '- Las incorrectas son confusiones reales de quien estudió a medias, no disparates, y no',
    '  se delatan con «siempre», «nunca», «solo» o «únicamente».',
    '- No copies la definición palabra por palabra en la correcta.',
    '- La explicación va al alumno, en segunda persona, en tres oraciones como máximo.',
    ...ESTILO,
  ].filter(Boolean).join('\n');
}

// ============================== Validación ==============================

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

  const incorrectas = p.incorrectas.map((o) => String(o ?? '').trim());
  const todas = [correcta, ...incorrectas];

  if (todas.some((o) => o.length === 0)) push('hay una alternativa vacía');
  if (todas.some((o) => o.length > 220)) push('hay una alternativa demasiado larga');
  if (new Set(todas.map(normalizar)).size !== 4) push('hay alternativas repetidas');

  for (const o of todas) {
    if (/\b(todas|ninguna) las anteriores\b/i.test(o)) push('usa «todas/ninguna las anteriores»');
    // El modelo a veces enumera él mismo y la pantalla le agrega su propia letra,
    // así que el alumno lee «a) a) Es un método…». Salió en el quiz de Base64.
    if (CON_VINETA.test(o)) push('una alternativa viene con su propia letra o viñeta');
  }

  // El delator: «la más larga es la correcta». Antes se rechazaba solo cuando
  // pasaba 1,6 veces el promedio de las otras, y esa holgura dejaba pasar una
  // correcta un 40% más larga que las demás: justo lo que los alumnos detectan.
  // Ahora el tope es un 10% sobre la **más larga** de las incorrectas. La
  // comprobación es determinista; la consigna de «a veces la más corta» la pone
  // el prompt, pero acá no se confía en que el modelo la cumpla.
  const sesgo = sesgoDeLargo(correcta, incorrectas);
  if (sesgo) push(sesgo);

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
