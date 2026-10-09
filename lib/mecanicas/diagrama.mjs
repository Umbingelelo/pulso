/**
 * Mecánica «diagrama»: una cadena de 4 o 5 pasos con uno oculto.
 *
 * Es la forma de preguntar por **estructura y orden**, que en alternativas de
 * texto se pregunta mal: «¿qué viene después de validar el token?» exige una
 * pregunta larga, mientras que un diagrama con un hueco lo enseña de un vistazo.
 * La pantalla lo dibuja como SVG (`diagrama-mision.component.ts`); acá solo se
 * entrega datos: pasos, etiquetas de flecha y cuál falta.
 *
 * ── Qué decide el servidor y qué el modelo ──
 *
 * El modelo escribe los pasos y tres distractores **para el paso que se
 * oculta**. Pero para que pueda escribirlos tiene que saber cuál es, y para que
 * no escoja siempre uno que se adivine por el contexto, tampoco lo elige él:
 * el servidor sortea cuántos pasos y cuál queda oculto *antes* de llamarlo y se
 * lo dice por posición («el paso 3 de 5»). Nunca el primero ni el último: sin
 * un vecino a cada lado, el hueco no se puede deducir y deja de ser un puzle.
 *
 * ── `apto` ──
 *
 * No todo concepto es un flujo. «Idempotencia» es una propiedad, no una cadena.
 * En vez de obligar al modelo a inventar pasos —y a que un alumno estudie una
 * estructura inventada—, se le deja decir que no se presta (`apto: false`). Eso
 * no se reintenta (otro intento daría lo mismo): quien llama cae a otra
 * mecánica con el mismo término.
 *
 * ── Largo de las opciones ──
 *
 * Las cuatro opciones son etiquetas cortas, así que el sesgo es más sutil que en
 * el quiz, pero existe: la correcta sale más específica y por eso más larga. Rige
 * la misma regla del 10% y se exige que ninguna sea el doble de larga que otra.
 */
import { apertura, ESTILO, barajar, normalizar, sesgoDeLargo, uno } from './comun.mjs';

export const codigo = 'diagrama';
export const nombre = 'Completa el diagrama';
export const mecanica = 'diagrama';
export const banda = 'ingenio';
export const xp = 75;
export const usaModelo = true;
export const maxTokens = 500;

export const esquema = {
  type: 'object',
  additionalProperties: false,
  required: ['apto', 'titulo', 'pasos', 'flechas', 'distractores', 'explicacion'],
  properties: {
    apto: {
      type: 'boolean',
      description: 'false si el concepto no se presta a un diagrama lineal de pasos o componentes.',
    },
    titulo: { type: 'string', description: 'Título del diagrama, máximo 50 caracteres.' },
    pasos: {
      type: 'array',
      minItems: 4,
      maxItems: 5,
      items: { type: 'string' },
      description: 'Etiquetas cortas, máximo 30 caracteres, en el orden del diagrama.',
    },
    flechas: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: { type: 'string' },
      description: 'Etiqueta de cada flecha entre pasos (máximo 18 caracteres), o texto vacío.',
    },
    distractores: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string' },
      description: 'Tres etiquetas incorrectas pero plausibles para el paso oculto.',
    },
    explicacion: {
      type: 'string',
      description: 'Por qué ese paso va ahí, al alumno. Máximo dos oraciones.',
    },
  },
};

/** Cuántos pasos y cuál se oculta (índice desde 0, siempre uno interior). */
export function preparar(ctx, azar = Math.random) {
  const n = uno([4, 5, 5], azar);
  const oculto = 1 + Math.floor(azar() * (n - 2));
  return { ...ctx, n_pasos: n, oculto };
}

export function instruccion(ctx) {
  const n = ctx.n_pasos ?? 4;
  const k = (ctx.oculto ?? 1) + 1;
  return [
    ...apertura(ctx, 'completo'),
    '',
    `Arma un diagrama LINEAL de exactamente ${n} pasos o componentes para este concepto (por`,
    'ejemplo el recorrido de una petición, las etapas de un proceso o las capas de una',
    'arquitectura). Apóyate en la definición del docente y en el curso, sin contradecirla.',
    '',
    'Reglas:',
    '- Cada paso es una etiqueta corta (máx. 30 caracteres), sin numerar.',
    `- «flechas»: ${n - 1} etiquetas de máx. 18 caracteres con lo que pasa entre un paso y el`,
    '  siguiente, o texto vacío si no aporta.',
    `- Al alumno se le oculta el paso ${k} de ${n}: da 3 distractores plausibles para ESE paso,`,
    '  de largo parecido al real, distintos entre sí y distintos de los demás pasos.',
    '- Si el concepto no se presta a un diagrama de pasos, pon apto en false y rellena el resto',
    '  como sea.',
    ...ESTILO,
  ].filter(Boolean).join('\n');
}

// ============================== Validación ==============================

export function validar(p, ctx = {}) {
  if (!p || typeof p !== 'object') return { ok: false, motivos: ['no es un objeto'] };
  if (p.apto === false) {
    return { ok: false, descartar: true, motivos: ['el concepto no se presta a un diagrama'] };
  }

  const motivos = [];
  const push = (m) => motivos.push(m);

  const pasos = (Array.isArray(p.pasos) ? p.pasos : []).map((x) => String(x ?? '').trim());
  const dist = (Array.isArray(p.distractores) ? p.distractores : []).map((x) => String(x ?? '').trim());

  // Se pide un largo exacto para variar, pero 4 o 5 sirven igual: rechazar un
  // diagrama bueno por traer un paso de más es pagar otra llamada por nada.
  if (pasos.length < 4 || pasos.length > 5) push('el diagrama no tiene 4 o 5 pasos');
  // …salvo que el paso oculto quede fuera: los distractores se escribieron para él.
  else if (ctx.oculto != null && ctx.oculto > pasos.length - 2) {
    push(`el diagrama debe tener ${ctx.n_pasos} pasos`);
  }
  if (dist.length !== 3) push('no son exactamente tres distractores');
  if (motivos.length) return { ok: false, motivos };

  if (pasos.some((s) => s.length < 2 || s.length > 40)) push('un paso queda vacío o pasa de 40 caracteres');
  if (dist.some((s) => s.length < 2 || s.length > 40)) push('un distractor queda vacío o pasa de 40 caracteres');
  if (String(p.titulo ?? '').trim().length < 3) push('falta el título');
  if (String(p.titulo ?? '').trim().length > 80) push('el título es demasiado largo');
  if (new Set(pasos.map(normalizar)).size !== pasos.length) push('hay pasos repetidos');

  const k = interior(ctx.oculto, pasos.length);
  const real = pasos[k];
  const opciones = [real, ...dist];
  if (new Set(opciones.map(normalizar)).size !== 4) push('las opciones del paso oculto se repiten');

  // Un distractor igual a un paso que ya se ve no es plausible: es descartable a ojo.
  const visibles = new Set(pasos.filter((_, i) => i !== k).map(normalizar));
  if (dist.some((d) => visibles.has(normalizar(d)))) push('un distractor repite un paso que ya está en el diagrama');

  const sesgo = sesgoDeLargo(real, dist);
  if (sesgo) push(sesgo);
  const largos = opciones.map((o) => o.length);
  if (Math.max(...largos) > 14 && Math.max(...largos) > Math.min(...largos) * 2.5) {
    push('las opciones tienen largos muy distintos');
  }

  // Una explicación larga se recorta en `armar`; solo falta si no hay.
  if (String(p.explicacion ?? '').trim().length < 15) push('falta la explicación');

  return { ok: motivos.length === 0, motivos: [...new Set(motivos)] };
}

// ============================== Armado ==============================

/**
 * Las etiquetas de flecha son adorno: no deciden nada del puzle. Por eso, en vez
 * de rechazar una generación entera —y pagar otra llamada— porque trajo una de
 * más, una de menos o una de 40 caracteres, se normalizan acá: siempre una menos
 * que los pasos, y vacía la que no cabe en el dibujo.
 */
function flechasDe(flechas, nPasos) {
  return Array.from({ length: nPasos - 1 }, (_, i) => {
    const t = String(flechas?.[i] ?? '').trim();
    return t.length > 28 ? '' : t;
  });
}

/** El paso oculto siempre es interior, aunque el modelo haya traído menos pasos. */
function interior(oculto, n) {
  return Math.min(Math.max(oculto ?? 1, 1), n - 2);
}

/** Dos oraciones y 400 caracteres a lo más: es lo que cabe bajo el diagrama. */
function recortar(texto) {
  const dos = String(texto).trim().split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return dos.length > 400 ? `${dos.slice(0, 399).trimEnd()}…` : dos;
}

export function armar(p, { termino, fuente, oculto } = {}) {
  const pasos = p.pasos.map((x) => String(x).trim());
  const k = interior(oculto, pasos.length);
  const real = pasos[k];
  const opciones = barajar([real, ...p.distractores.map((x) => String(x).trim())]);

  return {
    enunciado: {
      mecanica: 'diagrama',
      termino: termino ?? null,
      fuente: fuente ?? null,
      pregunta: `¿Qué va en el paso «?» del diagrama de ${termino}?`,
      titulo: String(p.titulo).trim(),
      nodos: pasos.map((x, i) => (i === k ? null : x)),
      flechas: flechasDe(p.flechas, pasos.length),
      opciones,
    },
    solucion: {
      tipo: 'diagrama',
      correcta: String(opciones.findIndex((o) => o === real)),
      paso: real,
      posicion: k,
      explicacion: recortar(p.explicacion),
    },
  };
}
