/**
 * Sesión: dos tokens con oficios distintos.
 *
 * El **de acceso** es un JWT ES256 corto (15 minutos) que el navegador guarda en
 * memoria y manda a la Data API en la cabecera. Neon lo valida contra el JWKS
 * público, y de su `sub` sale `auth.user_id()`, que es lo que alimenta el RLS.
 *
 * El **de refresco** es una cookie `httpOnly` firmada con un secreto simétrico
 * que nunca sale del servidor. Vive un mes y solo sirve para pedir un token de
 * acceso nuevo.
 *
 * Por qué así y no el JWT en la cookie: la Data API lo necesita en una cabecera,
 * y una cookie `httpOnly` —justamente— no se puede leer desde JavaScript. Y por
 * qué no dejarlo en localStorage: ahí cualquier XSS se lo lleva. En memoria muere
 * al cerrar la pestaña, y el refresco vive en una cookie que el script no ve.
 */
import { SignJWT, jwtVerify, importJWK } from 'jose';

const ACCESO_MINUTOS = 15;
const REFRESCO_DIAS = 30;

/** El rol de Postgres al que PostgREST cambia. Es el que tiene el RLS aplicado. */
const ROL = 'pulso_app';

let llaveFirma;

async function llavePrivada() {
  if (!llaveFirma) {
    const jwk = JSON.parse(process.env.JWK_PRIVADA);
    llaveFirma = await importJWK(jwk, 'ES256');
  }
  return llaveFirma;
}

function secretoRefresco() {
  const s = process.env.SESION_SECRETO;
  if (!s) throw new Error('Falta SESION_SECRETO');
  return new TextEncoder().encode(s);
}

/** El token que viaja a la Data API. `sub` es de donde el RLS saca la identidad. */
export async function firmarAcceso(usuarioId) {
  return new SignJWT({ role: ROL })
    .setProtectedHeader({ alg: 'ES256', kid: 'pulso-1' })
    .setSubject(usuarioId)
    .setIssuedAt()
    .setIssuer('pulso')
    .setExpirationTime(`${ACCESO_MINUTOS}m`)
    .sign(await llavePrivada());
}

export async function firmarRefresco(usuarioId) {
  return new SignJWT({ typ: 'refresco' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(usuarioId)
    .setIssuedAt()
    .setIssuer('pulso')
    .setExpirationTime(`${REFRESCO_DIAS}d`)
    .sign(secretoRefresco());
}

export async function leerRefresco(cookies) {
  const token = cookies?.pulso_sesion;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretoRefresco(), { issuer: 'pulso' });
    return payload.typ === 'refresco' ? payload.sub : null;
  } catch {
    return null; // expirado o manipulado: se trata igual que no tener sesión
  }
}

export function parsearCookies(req) {
  const crudo = req.headers.cookie || '';
  const salida = {};
  for (const parte of crudo.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) salida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return salida;
}

export function ponerCookie(res, token) {
  res.setHeader('Set-Cookie', [
    `pulso_sesion=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${REFRESCO_DIAS * 24 * 60 * 60}`,
  ].join('; '));
}

export function borrarCookie(res) {
  res.setHeader('Set-Cookie',
    'pulso_sesion=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

export const minutosAcceso = ACCESO_MINUTOS;
