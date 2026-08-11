/**
 * Crear cuenta.
 *
 * `registrar_alumno()` hace las tres inserciones —usuario, perfil y primera
 * matrícula— en una transacción, valida el correo y la largura de la clave, y
 * calcula el hash con bcrypt dentro de la base. Al terminar deja la sesión
 * abierta: sin confirmación por correo, que es lo que reventaba con el 429.
 */
import { sql, cuerpo, json, mensajeDeError } from '../../lib/db.mjs';
import { firmarAcceso, firmarRefresco, ponerCookie, minutosAcceso } from '../../lib/sesion.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
  try {
    const { correo, clave, nombre, seccion_id } = await cuerpo(req);
    const filas = await sql()`
      select public.registrar_alumno(${correo}, ${clave}, ${nombre}, ${seccion_id ?? null}) as id`;
    const id = filas[0]?.id;
    if (!id) return json(res, 400, { error: 'No se pudo crear la cuenta.' });

    ponerCookie(res, await firmarRefresco(id));
    return json(res, 201, {
      usuario_id: id,
      token: await firmarAcceso(id),
      expira_en: minutosAcceso * 60,
    });
  } catch (e) {
    return json(res, 400, { error: mensajeDeError(e) });
  }
}
