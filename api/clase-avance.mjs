/**
 * Recibe el avance de un alumno dentro de un deck y le paga lo que corresponda.
 *
 *   POST /api/clase-avance   { clase, slide, respuestas }
 *
 * Lo llama el script que `/api/clase` inyecta al servir el deck. Va por cookie y
 * no por token de acceso porque el deck es una página suelta, fuera de la
 * aplicación de Angular: no tiene de dónde sacar el token, pero la cookie viaja
 * sola.
 *
 * La corrección la hace `progreso_clase_guardar()` contra la pauta guardada en la
 * base. Acá no se decide nada: si esta función confiara en un `correctas: 3` que
 * manda el navegador, los puntos los pondría el alumno.
 *
 * Aun así, y para que quede dicho: el avance lo reporta el navegador, así que
 * quien abra las herramientas de desarrollo puede mentir. La base se defiende de
 * lo que puede —paga una sola vez cada cosa, y exige un mínimo de tiempo antes de
 * dar una clase por terminada— pero estos puntos son un empujón para repasar, no
 * una evaluación. Lo que evalúa son el diagnóstico y los laboratorios.
 */
import { cuerpo, json, mensajeDeError } from '../lib/db.mjs';
import { comoUsuario } from '../lib/identidad.mjs';
import { parsearCookies, leerRefresco } from '../lib/sesion.mjs';

const MAX_RESPUESTAS = 200;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });

  const usuarioId = await leerRefresco(parsearCookies(req));
  if (!usuarioId) return json(res, 401, { error: 'Sin sesión' });

  const datos = await cuerpo(req);
  const clase = typeof datos.clase === 'string' ? datos.clase : null;
  if (!clase) return json(res, 400, { error: 'Falta la clase' });

  const slide = Number.isFinite(datos.slide) ? Math.max(0, Math.trunc(datos.slide)) : 0;

  // Se limpia lo que llega: solo llaves numéricas y valores cortos. La función de
  // Postgres ya se defiende sola, pero no hay razón para mandarle basura ni para
  // aceptar un objeto de diez mil llaves.
  const respuestas = {};
  const crudas = datos.respuestas;
  if (crudas && typeof crudas === 'object' && !Array.isArray(crudas)) {
    for (const [llave, valor] of Object.entries(crudas).slice(0, MAX_RESPUESTAS)) {
      if (!/^\d{1,4}$/.test(llave)) continue;
      if (typeof valor !== 'string' || valor.length > 16) continue;
      respuestas[llave] = valor;
    }
  }

  try {
    const filas = await comoUsuario(usuarioId, (s) =>
      s`select public.progreso_clase_guardar(
                 ${clase}::uuid, ${slide}::integer, ${JSON.stringify(respuestas)}::jsonb) as r`);
    const r = filas[0]?.r ?? { puntos_nuevos: 0, aciertos: 0, terminada: false };
    return json(res, 200, r);
  } catch (e) {
    return json(res, 400, { error: mensajeDeError(e) });
  }
}
