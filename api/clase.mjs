/**
 * Sirve el deck de una clase, detrás de la sesión, y anota que se abrió.
 *
 *   GET /api/clase?id=<uuid de la clase>
 *
 * Por qué pasa por una función y no es un archivo estático: el repositorio es
 * público y el material no tiene por qué estarlo. El deck vive en un store de
 * Blob **privado**, cuya ruta `pulso_app` no puede ni leer (grant por columna en
 * la migración 0007). El único camino al archivo es esta función, y esta función
 * exige cookie de sesión y matrícula vigente en el ramo.
 *
 * La identidad sale de la cookie `httpOnly`, no del token de acceso, y eso es
 * deliberado: el alumno abre la clase en una pestaña nueva, con un enlace normal.
 * Una pestaña nueva no lleva cabeceras que le pongamos desde JavaScript, pero sí
 * lleva la cookie. Por eso el enlace funciona con un clic y sin intermediarios.
 *
 * El HTML se sirve **tal cual está subido**, más un script al final del `body`.
 * El archivo en la carpeta de la asignatura no se toca nunca: la instrumentación
 * ocurre al pasar, así que rehacer un deck no obliga a reinstrumentarlo.
 */
import { get } from '@vercel/blob';
import { json, mensajeDeError } from '../lib/db.mjs';
import { comoUsuario } from '../lib/identidad.mjs';
import { parsearCookies, leerRefresco } from '../lib/sesion.mjs';
import { instrumentar, VERSION_RASTREO } from '../lib/rastreo-clase.mjs';

/** Una página de error legible: esto se ve en una pestaña, no en una consola. */
function pagina(res, estado, titulo, detalle) {
  res.statusCode = estado;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo} · Pulso</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1117;
       color:#e6edf3;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}
  .caja{max-width:30rem;text-align:center}
  h1{font-size:1.4rem;margin:0 0 12px}
  p{color:#9aa6b2;margin:0 0 22px}
  a{display:inline-block;padding:10px 18px;border-radius:10px;background:#2f81f7;
    color:#fff;text-decoration:none;font-weight:600}
</style></head><body><div class="caja">
<h1>${titulo}</h1><p>${detalle}</p>
<a href="/clases">Volver a mis clases</a>
</div></body></html>`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'Método no permitido' });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const claseId = url.searchParams.get('id');
  if (!claseId) return pagina(res, 400, 'Falta la clase', 'El enlace no dice qué clase abrir.');

  const usuarioId = await leerRefresco(parsearCookies(req));
  if (!usuarioId) {
    return pagina(res, 401, 'Necesitas iniciar sesión',
      'Entra a Pulso y vuelve a abrir la clase desde tu lista.');
  }

  // Anota la apertura y devuelve la ruta del archivo. Si el alumno no cursa el
  // ramo, o la clase no está publicada, la función revienta con un mensaje en
  // español y no llegamos a tocar el Blob.
  let apertura;
  try {
    const filas = await comoUsuario(usuarioId, (s) =>
      s`select public.abrir_clase(${claseId}::uuid) as r`);
    apertura = filas[0]?.r;
  } catch (e) {
    return pagina(res, 403, 'No puedes abrir esta clase', mensajeDeError(e));
  }
  if (!apertura?.archivo) {
    return pagina(res, 404, 'Clase no encontrada', 'Esa clase ya no está disponible.');
  }

  // Con `no-cache` el navegador revalida siempre: así cada apertura pasa por acá
  // —y queda anotada— pero el cuerpo se manda una sola vez. Un deck son ~400 KB
  // que no vale la pena reenviar en cada repaso.
  res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');

  let blob;
  try {
    blob = await get(apertura.archivo, { access: 'private' });
  } catch (e) {
    console.error('Blob no disponible', apertura.archivo, e?.message);
    return pagina(res, 502, 'No pude traer el material',
      'El archivo de la clase no respondió. Inténtalo de nuevo en un momento.');
  }
  if (!blob?.stream) {
    return pagina(res, 404, 'Falta el archivo',
      'La clase está registrada pero su archivo no está subido. Avísale al docente.');
  }

  // El ETag incluye la versión del inyector: si cambio el script de rastreo, los
  // navegadores que tenían el deck en caché se traen el nuevo en vez de quedarse
  // con uno que ya no reporta igual.
  const etag = `W/"${blob.blob.etag}-${VERSION_RASTREO}"`;
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    return res.end();
  }
  if (req.method === 'HEAD') {
    res.statusCode = 200;
    return res.end();
  }

  const html = await new Response(blob.stream).text();
  const salida = instrumentar(html, {
    claseId,
    docente: apertura.docente === true,
    slides: apertura.slides ?? 0,
  });

  res.statusCode = 200;
  res.end(salida);
}
