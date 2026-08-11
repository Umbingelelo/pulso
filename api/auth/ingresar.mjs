/**
 * Iniciar sesión.
 *
 * La contraseña se compara dentro de Postgres: `autenticar()` devuelve un id o
 * nada, y el hash nunca llega hasta acá. Si calza, se entrega un token de acceso
 * corto —que el navegador guarda en memoria— y una cookie de refresco httpOnly.
 */
import { sql, cuerpo, json, mensajeDeError } from '../../lib/db.mjs';
import { firmarAcceso, firmarRefresco, ponerCookie, minutosAcceso } from '../../lib/sesion.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
  try {
    const { correo, clave } = await cuerpo(req);
    if (!correo || !clave) return json(res, 400, { error: 'Faltan el correo o la contraseña' });

    const filas = await sql()`select public.autenticar(${correo}, ${clave}) as id`;
    const id = filas[0]?.id;
    // Mismo mensaje para correo inexistente y clave incorrecta: no se le dice a
    // nadie qué correos están registrados.
    if (!id) return json(res, 401, { error: 'Correo o contraseña incorrectos.' });

    ponerCookie(res, await firmarRefresco(id));
    return json(res, 200, {
      usuario_id: id,
      token: await firmarAcceso(id),
      expira_en: minutosAcceso * 60,
    });
  } catch (e) {
    return json(res, 500, { error: mensajeDeError(e) });
  }
}
