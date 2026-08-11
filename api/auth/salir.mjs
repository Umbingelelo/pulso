import { json } from '../../lib/db.mjs';
import { borrarCookie } from '../../lib/sesion.mjs';

export default async function handler(req, res) {
  borrarCookie(res);
  return json(res, 200, { ok: true });
}
