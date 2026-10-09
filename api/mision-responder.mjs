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
 *
 * ── La excepción: `desarrollo` ──
 *
 * Es la única mecánica que no corrige Postgres sino un modelo, y por eso va por
 * otro camino. Se reconoce porque trae `respuesta.texto`; para todas las demás el
 * límite de 240 caracteres por valor sigue igual. El camino es:
 *
 *   1. con el rol `pulso_misiones`, `mision_pauta()` entrega la definición del
 *      docente y las ideas clave —que el alumno no puede leer— y de paso comprueba
 *      que la misión es de este usuario, de hoy, sin resolver y de desarrollo;
 *   2. el modelo da un veredicto;
 *   3. `mision_calificar()` lo anota y paga: logrado todo, parcial la mitad,
 *      incompleto nada. **Solo `pulso_misiones` puede ejecutarla**: si la
 *      ejecutara la app, un alumno se pondría «logrado» con su propio token.
 *
 * Si el modelo falla, no se anota nada: la misión sigue sin responder y el alumno
 * puede reenviar. Un corte del proveedor no se paga con una misión perdida.
 */
import { cuerpo, json, mensajeDeError, sqlMisiones } from '../lib/db.mjs';
import { comoUsuario } from '../lib/identidad.mjs';
import { parsearCookies, leerRefresco } from '../lib/sesion.mjs';
import { calificar, limpiarRespuesta, MIN_RESPUESTA } from '../lib/mecanicas/desarrollo.mjs';
import { ErrorModelo } from '../lib/openrouter.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });

  const usuarioId = await leerRefresco(parsearCookies(req));
  if (!usuarioId) return json(res, 401, { error: 'Sin sesión' });

  const datos = await cuerpo(req);
  const mision = typeof datos.mision === 'string' ? datos.mision : null;
  if (!mision) return json(res, 400, { error: 'Falta la misión' });

  // `desarrollo`: respuesta abierta, la corrige el modelo en este servidor.
  if (typeof datos.respuesta?.texto === 'string') {
    return await responderDesarrollo(res, usuarioId, mision, datos.respuesta.texto);
  }

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

async function responderDesarrollo(res, usuarioId, mision, bruto) {
  const texto = limpiarRespuesta(bruto);
  if (texto.length < MIN_RESPUESTA) {
    return json(res, 400, { error: `Escribe al menos ${MIN_RESPUESTA} caracteres: con una frase suelta no hay qué corregir.` });
  }

  const g = sqlMisiones();
  let pauta, v;
  try {
    // Antes de gastar un token: ¿es suya, de hoy, de desarrollo y sin resolver?
    const [fila] = await g`select public.mision_pauta(${mision}::uuid, ${usuarioId}::uuid) as p`;
    pauta = fila.p;
    v = await calificar({
      pregunta: pauta.enunciado.pregunta,
      definicion: pauta.solucion.definicion,
      criterios: pauta.solucion.criterios,
      texto,
      asignatura: pauta.asignatura,
    });
  } catch (e) {
    if (e instanceof ErrorModelo) {
      console.error('mision-responder: falló la corrección', e.message, e.detalle ?? '');
      return json(res, 503, {
        error: 'No pudimos corregir tu respuesta ahora. No perdiste nada: tu misión sigue pendiente, inténtalo de nuevo en un momento.',
        reintentable: true,
      });
    }
    return json(res, 400, { error: mensajeDeError(e) });
  }

  try {
    const [fila] = await g`select public.mision_calificar(
        ${mision}::uuid, ${usuarioId}::uuid, ${v.veredicto}, ${v.mensaje}, ${texto},
        ${v.tokens}::integer, ${v.costo}::numeric) as r`;
    console.log('mision-responder', JSON.stringify({ veredicto: v.veredicto, tokens: v.tokens, costo_usd: +v.costo.toFixed(6) }));
    return json(res, 200, fila.r);
  } catch (e) {
    return json(res, 400, { error: mensajeDeError(e) });
  }
}
