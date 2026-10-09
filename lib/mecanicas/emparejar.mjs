/**
 * Mecánica «emparejar»: cuatro términos y sus cuatro definiciones, revueltas.
 *
 * **No gasta ni un token.** Las definiciones son las del banco del docente, tal
 * cual: no hay nada que pedirle al modelo. Es la mecánica barata de la rotación
 * y la que sirve de red de seguridad cuando el modelo no responde o el concepto
 * del día no se presta a otra cosa (`api/mision.mjs` cae acá).
 *
 * ── Qué hay que cuidar, sin modelo ──
 *
 * Con cuatro definiciones de verdad, los problemas son del banco, no del modelo:
 *
 *   * **La definición que nombra su término.** «TLS es el protocolo que cifra…»
 *     se empareja sola. Se tapa el término dentro de su propia definición.
 *   * **La que menciona a otro de los cuatro.** «Autorización responde qué
 *     puedes hacer, no confundir con autenticación» deja la pareja resuelta por
 *     descarte. Esas combinaciones no se arman: se piden más candidatos de los
 *     necesarios y se eligen cuatro que no se pisen.
 *   * **La definición que no se sostiene sola.** Hay entradas del banco que son
 *     un fragmento («se confunden todo el tiempo…») que sin su término no dice
 *     nada. El SQL filtra por largo y por forma; la selección final, por no
 *     repetirse.
 *
 * Se corrige todo o nada —las cuatro parejas— y al azar paga 1/24.
 *
 * Lo que se guarda: `enunciado.terminos` y `enunciado.definiciones` (revueltas
 * por separado) y `solucion.pares[j]` = índice del término de la definición `j`.
 * `enunciado.terminos` además le sirve a `contexto_mision()` para no repetir
 * esos términos en los días siguientes.
 */
import { barajar, normalizar } from './comun.mjs';

export const codigo = 'emparejar';
export const nombre = 'Une cada término con su definición';
export const mecanica = 'emparejar';
export const banda = 'contenido';
export const xp = 75;
/** Sin modelo: `generar()` salta la llamada y arma directo. */
export const usaModelo = false;
/** Sale del banco curado, no de un modelo: es la categoría de respaldo de `origen`. */
export const origen = 'pozo';
export const maxTokens = 0;
export const esquema = {};
export const PARES = 4;

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** La definición sin su propio término, y con mayúscula inicial para leerse sola. */
export function taparTermino(definicion, termino) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapar(termino)}(?![\\p{L}\\p{N}])`, 'giu');
  const d = String(definicion).trim().replace(re, '…').replace(/\s+/g, ' ');
  return d.charAt(0).toUpperCase() + d.slice(1);
}

const menciona = (definicion, termino) =>
  ` ${normalizar(definicion)} `.includes(` ${normalizar(termino)} `);

/**
 * De los candidatos que devuelve el SQL (los menos usados primero), elige cuatro
 * que no se pisen. Devuelve `null` si no se puede armar, y quien llama cae a otra
 * mecánica.
 */
export function elegirPares(candidatos, n = PARES) {
  const elegidos = [];
  for (const c of candidatos ?? []) {
    if (!c?.termino || !c?.definicion) continue;
    const choca = elegidos.some((e) =>
      normalizar(e.termino) === normalizar(c.termino)
      || normalizar(e.definicion) === normalizar(c.definicion)
      || menciona(e.definicion, c.termino)
      || menciona(c.definicion, e.termino));
    if (!choca) elegidos.push(c);
    if (elegidos.length === n) return elegidos;
  }
  return null;
}

/** Deja en el contexto los cuatro pares elegidos, o `pares: null`. */
export function preparar(ctx) {
  return { ...ctx, pares: elegirPares(ctx.candidatos) };
}

export function instruccion() {
  return 'Sin modelo: las definiciones salen del banco de términos del docente.';
}

export function validar(_p, ctx = {}) {
  const pares = ctx.pares;
  if (!Array.isArray(pares) || pares.length !== PARES) {
    return { ok: false, motivos: ['no hay cuatro pares disponibles'] };
  }
  const defs = pares.map((x) => normalizar(taparTermino(x.definicion, x.termino)));
  if (new Set(defs).size !== PARES) return { ok: false, motivos: ['hay definiciones repetidas'] };
  return { ok: true, motivos: [] };
}

export function armar(_p, { pares }) {
  // `terminos` y `definiciones` se barajan por separado: si compartieran orden,
  // la columna de la izquierda sería la solución de la de la derecha.
  const t = barajar(pares);
  const d = barajar(pares);
  return {
    enunciado: {
      mecanica: 'emparejar',
      fuente: null,
      pregunta: 'Une cada definición con el término que describe.',
      terminos: t.map((x) => x.termino),
      definiciones: d.map((x) => taparTermino(x.definicion, x.termino)),
    },
    solucion: {
      tipo: 'emparejar',
      // para la definición j, el índice de su término en `terminos`
      pares: d.map((x) => String(t.findIndex((y) => y.termino === x.termino))),
    },
  };
}
