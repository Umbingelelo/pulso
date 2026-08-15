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

/** El registro. Agregar una mecánica es sumar una línea acá. */
export const MECANICAS = Object.fromEntries([quiz].map((m) => [m.codigo, m]));

export function mecanica(codigo) {
  const m = MECANICAS[codigo];
  if (!m) throw new Error(`No conozco la mecánica «${codigo}»`);
  return m;
}

/**
 * @param {string} codigo   qué mecánica generar
 * @param {object} contexto { termino, definicion, asignatura, fuente }
 * @param {object} opciones { intentos, modelo }
 * @returns {Promise<{ enunciado, solucion, uso, costo, intentos, rechazos }>}
 */
export async function generar(codigo, contexto, { intentos = 2, modelo } = {}) {
  const m = mecanica(codigo);
  const rechazos = [];
  let uso = {}, gasto = 0;

  for (let n = 1; n <= intentos; n++) {
    let instruccion = m.instruccion(contexto);

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

    const veredicto = m.validar(r.datos, contexto);
    if (veredicto.ok) {
      // `armar` devuelve el par junto porque el índice de la correcta solo existe
      // después de barajar, y separarlo invitaría al desajuste que evitamos.
      const { enunciado, solucion } = m.armar(r.datos, contexto);
      return { enunciado, solucion, uso, costo: gasto, intentos: n, rechazos };
    }
    rechazos.push(veredicto.motivos);
  }

  throw new ErrorModelo(
    `El modelo no logró un ${codigo} válido en ${intentos} intentos`,
    rechazos.map((r, i) => `intento ${i + 1}: ${r.join('; ')}`).join(' | '));
}
