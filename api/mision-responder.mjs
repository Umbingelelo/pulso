/**
 * Responder la misión del día.
 *
 *   POST /api/mision-responder  { mision, respuesta }
 *
 * Corrige `mision_responder()` en Postgres, contra una solución que nunca bajó
 * al navegador. Acá no se decide nada: si esta función confiara en un
 * «acerté» del cliente, la experiencia la repartiría el alumno.
 *
 * La respuesta incluye la solución **recién después de contestar**, que es
 * cuando el alumno ya tiene derecho a verla.
 */
import { cuerpo, json, mensajeDeError } from '../lib/db.mjs';
import { comoUsuario } from '../lib/identidad.mjs';
import { parsearCookies, leerRefresco } from '../lib/sesion.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });

  const usuarioId = await leerRefresco(parsearCookies(req));
  if (!usuarioId) return json(res, 401, { error: 'Sin sesión' });

  const datos = await cuerpo(req);
  const mision = typeof datos.mision === 'string' ? datos.mision : null;
  if (!mision) return json(res, 400, { error: 'Falta la misión' });

  // Se limpia lo que llega: la corrección la hace Postgres, pero no hay razón
  // para mandarle un objeto arbitrario del navegador.
  const respuesta = {};
  if (datos.respuesta && typeof datos.respuesta === 'object') {
    for (const [k, v] of Object.entries(datos.respuesta).slice(0, 20)) {
      if (typeof k === 'string' && k.length <= 24 && ['string', 'number'].includes(typeof v)) {
        respuesta[k] = String(v).slice(0, 240);
      }
    }
  }

  try {
    const filas = await comoUsuario(usuarioId, (s) =>
      s`select public.mision_responder(${mision}::uuid, ${JSON.stringify(respuesta)}::jsonb) as r`);
    return json(res, 200, filas[0]?.r ?? {});
  } catch (e) {
    return json(res, 400, { error: mensajeDeError(e) });
  }
}
