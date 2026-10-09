/**
 * Conexión a Neon para las funciones de autenticación.
 *
 * Es el **único** lugar del backend que habla SQL: todo lo demás va directo del
 * navegador a la Data API. Acá solo se llaman las tres funciones que tocan
 * credenciales —`autenticar`, `registrar_alumno`, `cambiar_clave`—, porque la
 * tabla `usuarios` no tiene permisos ni políticas y no se puede alcanzar de otra
 * forma. Ese es el punto: el hash de una contraseña no sale de Postgres.
 *
 * La inicialización es diferida a propósito. `neon()` revienta si falta
 * `DATABASE_URL`, y evaluarlo al importar el módulo haría fallar el build antes
 * de que las variables existan.
 */
import { neon } from '@neondatabase/serverless';

let _sql = null;

export function sql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

let _misiones = null;

/**
 * El cliente con el rol `pulso_misiones`: registrar misiones, leer la pauta de una
 * de desarrollo y anotar su calificación. Nada más (ver `0010` y `0043`). Lo usan
 * `/api/mision` y `/api/mision-responder`, que son las dos que corren con la key
 * del modelo.
 */
export function sqlMisiones() {
  if (!_misiones) {
    if (!process.env.DATABASE_URL_MISIONES) throw new Error('Falta DATABASE_URL_MISIONES');
    _misiones = neon(process.env.DATABASE_URL_MISIONES);
  }
  return _misiones;
}

/** Lee el cuerpo JSON de la petición sin depender del parser del entorno. */
export async function cuerpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let crudo = '';
  for await (const trozo of req) crudo += trozo;
  try {
    return crudo ? JSON.parse(crudo) : {};
  } catch {
    return {};
  }
}

/**
 * Traduce un error de Postgres a algo que el alumno pueda leer.
 * Los `raise exception` de nuestras funciones ya vienen en español y se pasan
 * tal cual; lo demás se esconde, para no filtrar detalles del esquema.
 */
export function mensajeDeError(e) {
  const m = e?.message ?? '';
  const propio = /^[A-ZÁÉÍÓÚÑ¿].{3,180}$/u.test(m) && !m.includes('relation ') && !m.includes('column ');
  return propio ? m : 'No se pudo completar la operación.';
}

export function json(res, estado, cuerpo) {
  res.statusCode = estado;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(cuerpo));
}
