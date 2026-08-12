/**
 * Ejecutar SQL en nombre de un alumno, desde el servidor.
 *
 * El navegador habla con la Data API llevando su JWT, y de ahí sale `auth.uid()`
 * y con él todo el RLS. Pero `/api/clase` no es el navegador: es una función que
 * ya validó la cookie de sesión y necesita llamar a Postgres con esa identidad
 * puesta. Para eso `usuario_actual()` tiene una segunda vía —el ajuste
 * `pulso.usuario_id`— y esto es lo que la usa.
 *
 * Va **dentro de una transacción** y con `is_local = true` a propósito. La
 * conexión sale de un pool: si el ajuste fuera de sesión, quedaría pegado en la
 * conexión y la siguiente petición —de otro alumno— heredaría la identidad
 * ajena. Con `true` muere al cerrar la transacción. Está comprobado que no se
 * filtra: fuera de la transacción `usuario_actual()` vuelve a reventar.
 *
 * Y reventar es lo correcto. Un `usuario_actual()` que devuelve null en vez de
 * fallar convierte «no pude leer tu sesión» en «no tienes nada», que es una
 * pantalla vacía que miente. Ese error ya lo cometimos una vez.
 */
import { sql } from './db.mjs';

/**
 * @param {string}   usuarioId  identidad ya verificada contra la cookie firmada
 * @param {function} consulta   recibe el cliente `sql` y devuelve UNA consulta
 * @returns {Promise<Array>}    las filas de esa consulta
 */
export async function comoUsuario(usuarioId, consulta) {
  if (!usuarioId) throw new Error('Sin sesión');
  const s = sql();
  const resultados = await s.transaction([
    s`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    consulta(s),
  ]);
  return resultados[1] ?? [];
}
