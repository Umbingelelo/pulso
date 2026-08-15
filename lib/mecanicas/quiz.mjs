/**
 * Mecánica «quiz»: una pregunta, cuatro alternativas, una correcta.
 *
 * La más simple de las veinte, y por eso la primera: sirve para dejar armado el
 * camino completo —generar, validar, guardar, corregir— con la menor cantidad de
 * piezas nuevas. Las que vengan después se enchufan en el mismo lugar.
 *
 * El reparto de responsabilidades es el de siempre:
 *
 *   * el modelo **redacta**, con las piezas del banco de términos;
 *   * este archivo **valida**, y es la única autoridad sobre si un puzzle sirve;
 *   * Postgres **corrige**, contra una solución que nunca baja al navegador.
 *
 * `structured_outputs` garantiza la forma del JSON. No garantiza que la pregunta
 * tenga sentido, que haya una sola respuesta correcta, ni que la correcta no se
 * delate por ser la más larga. Eso es lo que hace `validar()`.
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
  required: ['pregunta', 'opciones', 'correcta', 'explicacion'],
  properties: {
    pregunta: {
      type: 'string',
      description: 'La pregunta, en español de Chile, clara y en una sola oración.',
    },
    opciones: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: { type: 'string' },
      description: 'Cuatro alternativas de largo parecido. Las tres incorrectas deben ser plausibles.',
    },
    correcta: {
      type: 'integer',
      minimum: 0,
      maximum: 3,
      description: 'El índice de la alternativa correcta dentro de «opciones».',
    },
    explicacion: {
      type: 'string',
      description: 'Por qué esa es la correcta, en una o dos oraciones. Se muestra recién al responder.',
    },
  },
};

/**
 * La instrucción para el modelo. Recibe el término y su definición del banco,
 * así que no tiene que saber nada por su cuenta: compone con lo que se le da.
 */
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
    '- Las cuatro alternativas de largo parecido. Que la correcta NO sea la más larga.',
    '- Las tres incorrectas tienen que ser plausibles para alguien que estudió a medias:',
    '  confusiones reales, no chistes ni disparates evidentes.',
    '- Nada de «todas las anteriores» ni «ninguna de las anteriores».',
    '- No repitas la definición palabra por palabra en la alternativa correcta.',
  ].filter(Boolean).join('\n');
}

// ============================== Validación ==============================

const normalizar = (s) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Decide si el puzzle sirve. Devuelve `{ ok, motivos }`.
 *
 * Cada regla existe por un modo de falla concreto que se ha visto en modelos
 * generando este tipo de cosas. En particular la de la alternativa más larga:
 * es el delator clásico —el modelo desarrolla la correcta y despacha las otras
 * tres en tres palabras— y con eso el alumno acierta sin leer la pregunta.
 */
export function validar(p, { termino } = {}) {
  const motivos = [];
  const push = (m) => motivos.push(m);

  if (!p || typeof p !== 'object') return { ok: false, motivos: ['no es un objeto'] };

  const pregunta = String(p.pregunta ?? '').trim();
  if (pregunta.length < 15) push('la pregunta es demasiado corta');
  if (pregunta.length > 320) push('la pregunta es demasiado larga');
  if (!/[?¿]/.test(pregunta)) push('la pregunta no pregunta nada');

  if (!Array.isArray(p.opciones) || p.opciones.length !== 4) {
    push('no son exactamente cuatro alternativas');
    return { ok: false, motivos };
  }

  const ops = p.opciones.map((o) => String(o ?? '').trim());
  if (ops.some((o) => o.length === 0)) push('hay una alternativa vacía');
  if (ops.some((o) => o.length > 220)) push('hay una alternativa demasiado larga');

  const vistas = new Set(ops.map(normalizar));
  if (vistas.size !== 4) push('hay alternativas repetidas');

  for (const o of ops) {
    if (/\b(todas|ninguna) las anteriores\b/i.test(o)) push('usa «todas/ninguna las anteriores»');
  }

  const i = p.correcta;
  if (!Number.isInteger(i) || i < 0 || i > 3) {
    push('el índice de la correcta no es válido');
    return { ok: false, motivos };
  }

  // El delator: la correcta desarrollada y las otras tres en dos palabras.
  const otras = ops.filter((_, k) => k !== i);
  const promedioOtras = otras.reduce((s, o) => s + o.length, 0) / otras.length;
  if (promedioOtras > 0 && ops[i].length > promedioOtras * 1.6) {
    push('la alternativa correcta es mucho más larga que las otras: se delata');
  }

  // Que la correcta no sea la definición copiada, que también se delata.
  if (termino && normalizar(ops[i]) === normalizar(termino)) {
    push('la alternativa correcta es literalmente el término');
  }

  const explicacion = String(p.explicacion ?? '').trim();
  if (explicacion.length < 15) push('falta la explicación');
  if (explicacion.length > 500) push('la explicación es demasiado larga');

  return { ok: motivos.length === 0, motivos };
}

/** Lo que ve el alumno. Sin `correcta` ni `explicacion`, obviamente. */
export function aEnunciado(p, { termino, fuente } = {}) {
  return {
    mecanica: 'quiz',
    termino: termino ?? null,
    fuente: fuente ?? null,
    pregunta: String(p.pregunta).trim(),
    opciones: p.opciones.map((o) => String(o).trim()),
  };
}

/** La pauta. Vive en una columna sin permiso para el rol de la aplicación. */
export function aSolucion(p) {
  return {
    tipo: 'quiz',
    correcta: String(p.correcta),
    explicacion: String(p.explicacion).trim(),
  };
}
