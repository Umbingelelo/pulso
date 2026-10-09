/**
 * Mecánica «verdadero_falso»: cuatro afirmaciones, cada una verdadera o falsa.
 *
 * Existe por una queja concreta de los alumnos: en el quiz «gana la más larga».
 * Acá no hay alternativas que comparar entre sí, así que ese vicio no tiene de
 * dónde agarrarse. Cada afirmación se juzga sola.
 *
 * ── Qué sí puede delatar, y cómo se cierra ──
 *
 * Los verdadero/falso tienen sus propias pistas, y los alumnos las conocen:
 *
 *   * las falsas llevan «siempre», «nunca», «solo», «únicamente»;
 *   * las verdaderas son más largas y matizadas, las falsas cortas y tajantes;
 *   * siempre son dos y dos.
 *
 * Cada una tiene su defensa. Las palabras absolutas: si aparecen en dos o más
 * falsas y en ninguna verdadera, el validador rechaza (una sola suelta no es un
 * patrón, y exigir cero rechazaba la mitad de las generaciones: cada rechazo es
 * una segunda llamada que se paga). El largo: el promedio de las
 * verdaderas no puede alejarse mucho del de las falsas. El reparto: **lo decide
 * el servidor** —entre una y tres verdaderas, con el dos más frecuente— y se le
 * dice al modelo cuántas escribir; no se confía en que él varíe.
 *
 * Se corrige todo o nada, igual que el quiz: las cuatro bien o no hay XP. Con
 * una sola respuesta que adivinar, el azar paga 1/2; con cuatro, 1/16.
 *
 * El orden lo baraja el servidor y se guarda la pauta como arreglo posicional
 * (`respuestas[i]` es la clave de la afirmación `i`), sin pedirle índices al
 * modelo, por la misma razón que en `quiz.mjs`.
 */
import { apertura, ESTILO, barajar, normalizar, tieneAbsoluto, uno } from './comun.mjs';

export const codigo = 'verdadero_falso';
export const nombre = 'Verdadero o falso';
export const mecanica = 'verdadero_falso';
export const banda = 'contenido';
export const xp = 75;
export const usaModelo = true;
/** Cuatro afirmaciones con su porqué pesan ~230 tokens. */
export const maxTokens = 500;

export const esquema = {
  type: 'object',
  additionalProperties: false,
  required: ['afirmaciones'],
  properties: {
    afirmaciones: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['texto', 'verdadera', 'porque'],
        properties: {
          texto: { type: 'string', description: 'Una afirmación de una sola oración.' },
          verdadera: { type: 'boolean' },
          porque: {
            type: 'string',
            description: 'Una frase dirigida al alumno que dice por qué es verdadera o falsa.',
          },
        },
      },
    },
  },
};

/** Cuántas verdaderas, decidido por el servidor: el dos más seguido, pero no siempre. */
export function preparar(ctx, azar = Math.random) {
  return { ...ctx, n_verdaderas: uno([1, 2, 2, 3], azar) };
}

export function instruccion(ctx) {
  const v = ctx.n_verdaderas ?? 2;
  return [
    ...apertura(ctx, 'ligero'),
    '',
    `Escribe 4 afirmaciones cortas sobre este concepto: exactamente ${v} verdadera${v === 1 ? '' : 's'}`,
    `y ${4 - v} falsa${4 - v === 1 ? '' : 's'}. Básate SOLO en la definición del docente.`,
    '',
    'Reglas:',
    '- Una oración de 8 a 20 palabras cada una, todas de largo parecido (las falsas no',
    '  más cortas que las verdaderas).',
    '- Las falsas son confusiones creíbles de quien estudió a medias —cambiar un detalle',
    '  clave—, no negaciones de una verdadera ni disparates. Tienen que ser falsas también en',
    '  el mundo real, no solo según la definición: si algo es cierto en general, no lo des por falso.',
    '- Nada de «siempre», «nunca», «solo», «únicamente» ni «todos» para delatar las falsas.',
    '- No copies la definición palabra por palabra en las verdaderas.',
    '- «porque»: una frase al alumno, en segunda persona, que explique el veredicto.',
    ...ESTILO,
  ].filter(Boolean).join('\n');
}

// ============================== Validación ==============================

const media = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function validar(p) {
  const motivos = [];
  const push = (m) => motivos.push(m);

  if (!p || !Array.isArray(p.afirmaciones)) return { ok: false, motivos: ['no hay afirmaciones'] };
  const a = p.afirmaciones;
  if (a.length !== 4) return { ok: false, motivos: ['no son exactamente cuatro afirmaciones'] };

  const textos = a.map((x) => String(x?.texto ?? '').trim());
  const porques = a.map((x) => String(x?.porque ?? '').trim());

  if (a.some((x) => typeof x?.verdadera !== 'boolean')) push('una afirmación no dice si es verdadera o falsa');
  const verdaderas = a.filter((x) => x?.verdadera === true);
  const falsas = a.filter((x) => x?.verdadera === false);
  if (verdaderas.length < 1) push('no hay ninguna afirmación verdadera');
  if (falsas.length < 1) push('no hay ninguna afirmación falsa');

  if (textos.some((t) => t.length < 20)) push('hay una afirmación demasiado corta');
  if (textos.some((t) => t.length > 180)) push('hay una afirmación demasiado larga');
  if (new Set(textos.map(normalizar)).size !== 4) push('hay afirmaciones repetidas');
  if (porques.some((t) => t.length < 10)) push('falta el porqué de una afirmación');
  if (porques.some((t) => t.length > 260)) push('un porqué es demasiado largo');

  if (verdaderas.length && falsas.length) {
    // Las palabras absolutas concentradas en las falsas son un regalo. Una sola
    // «solo» suelta no delata nada —el español la usa para todo—; dos o más en las
    // falsas y ninguna en las verdaderas sí es un patrón que se aprende.
    const absEnFalsas = falsas.filter((x) => tieneAbsoluto(x.texto)).length;
    const absEnVerdaderas = verdaderas.filter((x) => tieneAbsoluto(x.texto)).length;
    if (absEnFalsas >= 2 && absEnVerdaderas === 0) {
      push('las falsas llevan «siempre/nunca/solo» y las verdaderas no: se delatan');
    }
    // Y el largo: las verdaderas no pueden ser mucho más largas que las falsas.
    const r = media(verdaderas.map((x) => String(x.texto).length))
            / media(falsas.map((x) => String(x.texto).length));
    if (r > 1.45 || r < 0.65) {
      push('las verdaderas y las falsas tienen largos muy distintos: se delatan');
    }
  }

  return { ok: motivos.length === 0, motivos: [...new Set(motivos)] };
}

// ============================== Armado ==============================

export function armar(p, { termino, fuente } = {}) {
  const orden = barajar(p.afirmaciones.map((x) => ({
    texto: String(x.texto).trim(),
    v: x.verdadera === true,
    porque: String(x.porque).trim(),
  })));

  return {
    enunciado: {
      mecanica: 'verdadero_falso',
      termino: termino ?? null,
      fuente: fuente ?? null,
      pregunta: `Marca cada afirmación sobre «${termino}» como verdadera o falsa.`,
      afirmaciones: orden.map((x) => x.texto),
    },
    solucion: {
      tipo: 'verdadero_falso',
      respuestas: orden.map((x) => (x.v ? 'v' : 'f')),
      porques: orden.map((x) => x.porque),
    },
  };
}
