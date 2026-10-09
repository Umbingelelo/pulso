/**
 * Sirve `/api/mision` y `/api/mision-responder` **con el código del árbol de
 * trabajo**, para probar en el navegador lo que todavía no se despliega.
 *
 * `ng serve --proxy-config` manda `/api` a producción, así que un cambio en
 * `api/` no se ejercita por ahí. Esto levanta esas dos funciones en local y el
 * proxy les desvía solo ellas (las demás rutas siguen yendo a producción):
 *
 *   cat > /tmp/proxy.json <<'JSON'
 *   { "/api/mision": { "target": "http://localhost:3999" },
 *     "/api":        { "target": "https://pulso-rust.vercel.app", "changeOrigin": true },
 *     "/db":         { "target": "https://pulso-rust.vercel.app", "changeOrigin": true } }
 *   JSON
 *   set -a; . ./.env.local; set +a
 *   node neon/servir-api-local.mjs &
 *   npx ng serve --proxy-config /tmp/proxy.json
 *   BASE=http://localhost:4200 node neon/probar-misiones-variadas-navegador.mjs
 *
 * ── Lo que hace distinto de producción, y por qué ──
 *
 * La cookie de sesión la firma producción con un secreto que no se puede leer
 * (variable Sensitive), así que este servidor **no la verifica**: lee de ella el
 * usuario y la vuelve a firmar con un secreto local antes de llamar al handler.
 * Es una herramienta de desarrollo y solo escucha en localhost. Tampoco usa el
 * rol `pulso_app`: entra con el dueño y la identidad puesta, igual que las
 * pruebas de `neon/probar-*.mjs`; las funciones de las misiones son
 * `security definer` y deciden por `usuario_actual()`.
 */
import http from 'node:http';

process.env.SESION_SECRETO = 'secreto-de-prueba-solo-local';
if (!process.env.DATABASE_URL_OWNER) throw new Error('Falta DATABASE_URL_OWNER (set -a; . ./.env.local; set +a)');
process.env.DATABASE_URL = process.env.DATABASE_URL_OWNER;

const { firmarRefresco } = await import('../lib/sesion.mjs');
const rutas = {
  '/api/mision': (await import('../api/mision.mjs')).default,
  '/api/mision-responder': (await import('../api/mision-responder.mjs')).default,
};

const PUERTO = Number(process.env.PUERTO ?? 3999);

http.createServer(async (req, res) => {
  const ruta = req.url.split('?')[0];
  const handler = rutas[ruta];
  if (!handler) { res.statusCode = 404; return res.end('solo /api/mision y /api/mision-responder'); }

  // De la cookie de producción solo se lee quién es; se firma de nuevo en local.
  const cruda = /(?:^|;\s*)pulso_sesion=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  try {
    const sub = JSON.parse(Buffer.from(decodeURIComponent(cruda).split('.')[1], 'base64url').toString()).sub;
    req.headers.cookie = `pulso_sesion=${encodeURIComponent(await firmarRefresco(sub))}`;
  } catch { req.headers.cookie = ''; }

  try { await handler(req, res); }
  catch (e) { console.error(ruta, e); res.statusCode = 500; res.end(JSON.stringify({ error: 'Error interno' })); }
}).listen(PUERTO, 'localhost', () => console.log(`API local en http://localhost:${PUERTO}`));
