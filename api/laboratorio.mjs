/**
 * El laboratorio del alumno: leerlo, ir guardando y entregarlo.
 *
 *   POST /api/laboratorio  { accion: 'ver' | 'guardar' | 'entregar', … }
 *
 * Va por conexión directa y no por la Data API por lo mismo que el panel del
 * docente: PostgREST cachea el esquema y una función recién creada tarda un rato
 * impredecible en aparecer —acá se midieron veinte segundos una vez y más de
 * quince minutos otra—. Un alumno que abre su laboratorio y ve un error que no
 * puede resolver ni entender es peor que un despliegue lento.
 *
 * La seguridad no cambia: cada llamada pasa por `comoUsuario`, que adopta el rol
 * `pulso_app` con la identidad del alumno, y las funciones de la base comprueban
 * que la matrícula sea suya.
 */
import { cuerpo, json, mensajeDeError } from '../lib/db.mjs';
import { comoUsuario } from '../lib/identidad.mjs';
import { parsearCookies, leerRefresco } from '../lib/sesion.mjs';

const ACCIONES = {
  ver: (s, d) =>
    s`select public.mi_laboratorio(${d.matricula}::uuid, ${d.codigo}) as r`,

  guardar: (s, d) =>
    s`select public.laboratorio_guardar(
        ${d.matricula}::uuid, ${d.codigo},
        ${JSON.stringify(d.respuestas ?? {})}::jsonb,
        ${Number(d.tramo) || 0}::integer) as r`,

  entregar: (s, d) =>
    s`select public.laboratorio_entregar(${d.matricula}::uuid, ${d.codigo}) as r`,

  // Para el docente: cómo va el curso en este laboratorio.
  avances: (s, d) =>
    s`select * from public.laboratorio_avances(
        ${d.asignatura}::uuid, ${d.periodo}::uuid, ${d.codigo})`,
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
