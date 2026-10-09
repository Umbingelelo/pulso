/**
 * Generar una misión: pedirle al modelo, validarla, y no aceptar un no.
 *
 * El orden importa y es siempre el mismo:
 *
 *   1. se elige un término del banco —curado por el docente— y su definición;
 *   2. el modelo redacta con esas piezas y con salida estructurada;
 *   3. **el validador de la mecánica decide** si el puzzle sirve;
 *   4. si no sirve, se reintenta diciéndole exactamente qué estuvo mal;
 *   5. si vuelve a fallar, quien llama decide: pozo de respaldo o rendirse.
 *
 * El paso 3 es el que importa. La salida estructurada garantiza la forma del
 * JSON, no que el ejercicio sirva: un quiz con la respuesta correcta tres veces
 * más larga que las otras cumple el esquema y arruina la misión igual.
 */
import { completar, costo, ErrorModelo } from './openrouter.mjs';
import * as quiz from './mecanicas/quiz.mjs';
import * as emparejar from './mecanicas/emparejar.mjs';
import * as verdaderoFalso from './mecanicas/verdadero_falso.mjs';
import * as diagrama from './mecanicas/diagrama.mjs';
import * as desarrollo from './mecanicas/desarrollo.mjs';
import { problemasDeTono } from './mecanicas/comun.mjs';

/** El registro. Agregar una mecánica es sumar una línea acá. */
export const MECANICAS = Object.fromEntries(
  [quiz, emparejar, verdaderoFalso, diagrama, desarrollo].map((m) => [m.codigo, m]));

export function mecanica(codigo) {
  const m = MECANICAS[codigo];
  if (!m) throw new Error(`No conozco la mecánica «${codigo}»`);
  return m;
}

// ============================== La rotación ==============================
//
// Una misión por alumno y día, y que no sea siempre la misma: eso era lo que
// aburría. Cada día se sortea la mecánica con pesos que favorecen las baratas.
// `emparejar` no usa modelo y es la más frecuente; `desarrollo` gasta dos
// llamadas (redactar y corregir) y es la menos.

export const PESOS = {
  emparejar: 25,
  verdadero_falso: 20,
  diagrama: 20,
  quiz: 20,
  desarrollo: 15,
};

/**
 * Qué mecánica toca hoy.
 *
 * Nunca la misma que la misión anterior del alumno, salvo que no quede otra
 * (una sola mecánica activa). Descarta lo que hoy no se puede hacer: sin modelo
 * no hay nada que redacte, y sin cuatro pares en el banco no hay emparejar.
 *
 * @param {object} p
 * @param {string[]} p.activas    códigos de plantillas activas (el docente las puede apagar)
 * @param {string|null} p.previa  mecánica de la última misión del alumno
 * @param {boolean} p.hayModelo   hay key de OpenRouter
 * @param {boolean} p.hayPares    el banco da cuatro pares para emparejar
 * @returns {string|null} el código, o null si no hay ninguna posible
 */
export function elegirMecanica({ activas, previa = null, hayModelo = true, hayPares = true },
                               azar = Math.random) {
  const posibles = Object.keys(PESOS).filter((c) =>
    MECANICAS[c]
    && activas.includes(c)
    && (hayModelo || !MECANICAS[c].usaModelo)
    && (hayPares || c !== 'emparejar'));

  const sinRepetir = posibles.filter((c) => c !== previa);
  const pool = sinRepetir.length ? sinRepetir : posibles;
  if (!pool.length) return null;

  let t = azar() * pool.reduce((s, c) => s + PESOS[c], 0);
  for (const c of pool) {
    t -= PESOS[c];
    if (t < 0) return c;
  }
  return pool[pool.length - 1];
}

/**
 * Qué hacer cuando la mecánica sorteada falla (el modelo no responde, o el
 * concepto no se presta). Primero la que no gasta nada; después el quiz.
 */
export function respaldo({ falló, activas, hayPares = true, hayModelo = true }) {
  if (falló !== 'emparejar' && hayPares && activas.includes('emparejar')) return 'emparejar';
  if (falló !== 'quiz' && hayModelo && activas.includes('quiz')) return 'quiz';
  return null;
}

// ============================== Generar ==============================

/**
 * @param {string} codigo   qué mecánica generar
 * @param {object} contexto { termino, definicion, asignatura, fuente, … } y, para
 *                          `emparejar`, `candidatos`
 * @param {object} opciones { intentos, modelo }
 * @returns {Promise<{ mecanica, origen, enunciado, solucion, uso, tokens, costo, intentos, rechazos }>}
 */
export async function generar(codigo, contexto, { intentos = 2, modelo } = {}) {
  const m = mecanica(codigo);
  // Lo que la mecánica decide una vez por misión —cuántas verdaderas, qué paso se
  // oculta, qué cuatro pares— y que tiene que valer igual en el reintento.
  const ctx = m.preparar ? m.preparar(contexto) : contexto;
  const origen = m.origen ?? 'modelo';

  if (!m.usaModelo) {
    const v = m.validar(null, ctx);
    if (!v.ok) throw new ErrorModelo(`No se pudo armar un ${codigo}`, v.motivos.join('; '));
    const { enunciado, solucion } = m.armar(null, ctx);
    return { mecanica: codigo, origen, enunciado, solucion, uso: {}, tokens: 0,
             costo: 0, intentos: 0, rechazos: [] };
  }

  const rechazos = [];
  let uso = {}, gasto = 0, tokens = 0;

  for (let n = 1; n <= intentos; n++) {
    let instruccion = m.instruccion(ctx);

    // En el reintento se le dice qué estuvo mal. Es mucho más efectivo que
    // repetir la misma petición y esperar que salga distinta por azar.
    if (rechazos.length) {
      instruccion += [
        '',
        'Tu intento anterior fue rechazado por estas razones:',
        ...rechazos[rechazos.length - 1].map((r) => `- ${r}`),
        '',
        'Corrígelas y vuelve a intentarlo.',
      ].join('\n');
    }

    let r;
    try {
      r = await completar({
        instruccion,
        esquema: m.esquema,
        nombreEsquema: m.codigo,
        modelo,
        maxTokens: m.maxTokens,
        sinRazonamiento: true,
        // Una generación normal tarda 7-10 s. Si el proveedor se cuelga, esperar
        // 45 s dos veces deja al alumno mirando la pantalla un minuto y medio antes
        // de caer al respaldo; con 25 s el peor caso baja a la mitad.
        segundos: 25,
        // Un poco menos de temperatura en el reintento: la primera vez se busca
        // variedad, la segunda que salga bien.
        temperatura: n === 1 ? 0.9 : 0.5,
      });
    } catch (e) {
      // Un tropiezo del proveedor —«el modelo respondió vacío», un 502, un
      // corte— no es un puzzle inválido: es mala suerte, y merece el mismo
      // reintento. Pasó con el BFF en la primera tanda de pruebas.
      if (!(e instanceof ErrorModelo) || n === intentos) throw e;
      rechazos.push([`falló la llamada: ${e.message}`]);
      continue;
    }

    uso = r.uso;
    gasto += costo(r.uso);
    tokens += r.uso?.total_tokens ?? 0;

    const v = m.validar(r.datos, ctx);
    // El tono vale para toda mecánica: cualquier texto del modelo lo lee el alumno.
    const tono = problemasDeTono(JSON.stringify(r.datos ?? {}));
    const veredicto = tono.length && v.ok ? { ok: false, motivos: tono } : v;
    if (veredicto.ok) {
      // `armar` devuelve el par junto porque el índice de la correcta solo existe
      // después de barajar, y separarlo invitaría al desajuste que evitamos.
      const { enunciado, solucion } = m.armar(r.datos, ctx);
      return { mecanica: codigo, origen, enunciado, solucion, uso, tokens, costo: gasto,
               intentos: n, rechazos };
    }
    // «No se presta»: otro intento daría lo mismo y se pagaría de nuevo.
    if (veredicto.descartar) {
      const e = new ErrorModelo(`El concepto no se presta a un ${codigo}`, veredicto.motivos.join('; '));
      e.tokens = tokens; e.costo = gasto;
      throw e;
    }
    rechazos.push(veredicto.motivos);
  }

  const e = new ErrorModelo(
    `El modelo no logró un ${codigo} válido en ${intentos} intentos`,
    rechazos.map((r, i) => `intento ${i + 1}: ${r.join('; ')}`).join(' | '));
  e.tokens = tokens; e.costo = gasto;
  throw e;
}
