/**
 * Devuelve un token de acceso nuevo a partir de la cookie de refresco.
 *
 * Lo llama la app al arrancar —para recuperar la sesión tras una recarga— y cada
 * vez que el token en memoria está por vencer. Sin cookie válida responde 401 y
 * la app se comporta como si no hubiera sesión.
 */
import { json } from '../../lib/db.mjs';
import { parsearCookies, leerRefresco, firmarAcceso, minutosAcceso } from '../../lib/sesion.mjs';

export default async function handler(req, res) {
  const id = await leerRefresco(parsearCookies(req));
  if (!id) return json(res, 401, { error: 'Sin sesión' });
  return json(res, 200, {
    usuario_id: id,
    token: await firmarAcceso(id),
    expira_en: minutosAcceso * 60,
  });
}
