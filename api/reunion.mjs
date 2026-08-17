/**
 * El modo reunión: encenderlo, apagarlo y saber si está encendido.
 *
 *   POST /api/reunion  { accion: 'ver' | 'secciones' | 'iniciar' | 'terminar', … }
 *
 * Las dos puntas del mismo concepto viven en un archivo: `ver` la pide el alumno
 * —para la barra y para la tienda— y las otras tres el docente. Separarlas por
 * quién las llama habría dejado el estado de una reunión en dos lugares.
 *
 * ── Por qué por conexión directa y no por la Data API ──
 *
 * Por lo mismo que el panel del docente y el laboratorio: PostgREST cachea el
 * esquema y una función recién creada tarda un rato impredecible en aparecer
 * —acá se midieron veinte segundos una vez y más de quince minutos otra—. Este
 * endpoint es todo funciones nuevas, así que por la Data API no funcionaría
 * hasta que a Neon se le ocurriera refrescar.
 *
 * Eso además explica una decisión de la tienda: `vitrina` se sigue leyendo por la
 * Data API sin tocarla, y el precio con descuento se calcula en el navegador. Es
 * el precio que se **muestra**; el que se **cobra** lo calcula la base dentro de
 * `solicitar_canje`. La pantalla nunca es la autoridad.
 *
 * ── Quién puede qué ──
 *
 * Cada llamada pasa por `comoUsuario`, que adopta `pulso_app` con la identidad de
 * quien llama. `mi_reunion` exige que la matrícula sea suya; `reunion_iniciar` y
 * `reunion_terminar` exigen `docente_ve_seccion`. Acá no se decide nada de eso.
 */
import { cuerpo, json, mensajeDeError } from '../lib/db.mjs';
import { comoUsuario } from '../lib/identidad.mjs';
import { parsearCookies, leerRefresco } from '../lib/sesion.mjs';

const ACCIONES = {
  // Alumno: ¿está mi profe en reunión, y con cuánto descuento?
  ver: (s, d) =>
    s`select public.mi_reunion(${d.matricula}::uuid) as r`,

  // Docente: sus secciones con el estado de cada una.
  secciones: (s, d) =>
    s`select * from public.reuniones_que_dicto(${d.asignatura}::uuid, ${d.periodo}::uuid)`,

  iniciar: (s, d) =>
    s`select public.reunion_iniciar(
        ${d.seccion}::uuid, ${d.descuento == null ? 30 : Number(d.descuento)}::integer) as r`,

  terminar: (s, d) =>
    s`select public.reunion_terminar(${d.seccion}::uuid) as r`,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });

  const usuarioId = await leerRefresco(parsearCookies(req));
  if (!usuarioId) return json(res, 401, { error: 'Sin sesión' });

  const datos = await cuerpo(req);
  const consulta = ACCIONES[datos.accion];
  if (!consulta) return json(res, 400, { error: 'Acción desconocida' });

  try {
    const filas = await comoUsuario(usuarioId, (s) => consulta(s, datos));
    return json(res, 200, { filas });
  } catch (e) {
    return json(res, 400, { error: mensajeDeError(e) });
  }
}
