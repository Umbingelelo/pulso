/**
 * Token para el visitante sin sesión.
 *
 * La Data API exige un JWT en toda petición, pero el desplegable del registro
 * —periodos, asignaturas y secciones— se llena antes de que exista cuenta. Este
 * endpoint entrega un token con un `sub` que a propósito no corresponde a nadie:
 * el uuid de ceros.
 *
 * Con eso `usuario_actual()` devuelve un id que no calza con ninguna fila, así
 * que de las 19 políticas solo pasan las tres del catálogo, que son `using
 * (true)`. Todo lo demás —perfiles, matrículas, actividades, preguntas, puntos,
 * canjes— queda fuera, y `usuarios` no tiene ni permiso ni política.
 *
 * Es el equivalente exacto de la clave anónima que publicaba Supabase: pública
 * por diseño, y limitada por el RLS y no por el secreto.
 */
import { json } from '../../lib/db.mjs';
import { firmarAcceso, minutosAcceso } from '../../lib/sesion.mjs';

const NADIE = '00000000-0000-0000-0000-000000000000';

export default async function handler(req, res) {
  return json(res, 200, {
    token: await firmarAcceso(NADIE),
    expira_en: minutosAcceso * 60,
  });
}
