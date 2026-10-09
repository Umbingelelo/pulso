/**
 * La ruleta en un navegador de verdad: el modal, la rueda, el giro y el resultado.
 *
 *   set -a; . ./.env.local; set +a
 *   npx ng build --configuration development --output-path /tmp/pulso-dist
 *   node neon/probar-ruleta-navegador.mjs [/tmp/pulso-dist/browser] [carpeta-de-capturas]
 *
 * ── Por qué no es como los otros `probar-*-navegador` ──
 *
 * Los demás apuntan al sitio desplegado y entran con la clave del alumno de
 * prueba. Acá no se puede: la ruleta es del **docente**, cuya clave no está en el
 * repositorio, y `/api` de producción no tiene todavía `tirar-ruleta`. Tampoco
 * sirve `ng serve` con el proxy a producción, por lo mismo.
 *
 * Así que esto sirve el `dist` recién compilado desde un servidor mínimo y
 * **intercepta** `/api/*` y `/db/*` desde puppeteer:
 *
 *   - la sesión es falsa (un docente que existe, sin pasar por la clave);
 *   - las lecturas de `/db` (`canjes_detalle`, `docente_asignaturas`…) salen de la
 *     base **de verdad**, filtradas a los canjes que crea esta prueba para no
 *     mostrar alumnos reales en las capturas;
 *   - `/api/docente` con `tirar-ruleta` y `ruleta-tramos` ejecuta **las mismas
 *     consultas** que `api/docente.mjs`, con la identidad del docente y el rol
 *     `pulso_app`: el sorteo es el real, el de la función de la base.
 *
 * Lo único que no se ejerce es el handler HTTP de `api/docente.mjs` (necesita la
 * cookie firmada). Para ver la rueda frenar en cada tramo —incluida la franja del
 * 7,0, que casi nunca sale— hay una primera tanda donde `tirar-ruleta` responde con
 * una nota **forzada**, sin tocar la base. Esa tanda prueba la geometría; la
 * segunda, con el sorteo real, prueba el camino completo.
 *
 * Cada giro se verifica **leyendo el ángulo final de la rueda** y calculando qué
 * tramo quedó bajo el puntero: tiene que ser el que dice la pantalla.
 */
import { access, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const DIST = process.argv[2] ?? '/tmp/pulso-dist/browser';
const CAPTURAS = process.argv[3] ?? '/tmp/pulso-ruleta';
const CORREO_ALUMNO = 'alumno.prueba@duocuc.cl';
const CORREO_DOCENTE = 'cr.calderons@profesor.duoc.cl';
const NOTA = 'prueba de ruleta en navegador';
const PUERTO = 4317;

let chrome = null;
for (const c of [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                 '/usr/bin/google-chrome'].filter(Boolean)) {
  try { await access(c); chrome = c; break; } catch {}
}
if (!chrome) { console.error('No encontré Chrome'); process.exit(2); }
const puppeteer = (await import('puppeteer-core')).default;
await mkdir(CAPTURAS, { recursive: true });

const d = neon(process.env.DATABASE_URL_OWNER);
let f = 0;
const rev = (e, r, x) => {
  const ok = JSON.stringify(r) === JSON.stringify(x);
  if (!ok) f++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(r)}` + (ok ? '' : ` ← esperaba ${JSON.stringify(x)}`));
};
const verdad = (e, c, det = '') => { if (!c) f++; console.log(`  ${c ? '✓' : '✗'} ${e}${det ? `: ${det}` : ''}`); };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Igual que `lib/identidad.mjs`: identidad a mano, local a la transacción. */
async function como(usuarioId, consulta) {
  const r = await d.transaction([
    d`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    d`set local role pulso_app`,
    consulta(d),
  ]);
  return r[2] ?? [];
}

// ---------- Preparación ----------

const [alumno] = await d`select id from public.usuarios where lower(correo) = ${CORREO_ALUMNO}`;
const [docente] = await d`select id from public.usuarios where lower(correo) = ${CORREO_DOCENTE}`;
if (!alumno || !docente) throw new Error('Faltan el alumno o el docente de prueba.');

const [m] = await d`
  select mt.id as matricula, ar.id as ruleta, ar.precio, ar.asignatura_id, ar.periodo_id,
         a.sigla, a.nombre as asignatura, p.codigo as periodo
    from public.matriculas  mt
    join public.secciones   s  on s.id = mt.seccion_id
    join public.asignaturas a  on a.id = s.asignatura_id
    join public.periodos    p  on p.id = s.periodo_id
    join public.articulos   ar on ar.asignatura_id = a.id and ar.periodo_id = s.periodo_id
   where mt.perfil_id = ${alumno.id} and mt.activa and ar.codigo = 'ruleta-nota' and ar.activo
   limit 1`;
if (!m) throw new Error('El alumno de prueba no tiene la ruleta en un ramo.');

const fixture = async () => (await d`
  insert into public.canjes (articulo_id, matricula_id, estado, precio_pagado, nota_alumno)
  values (${m.ruleta}, ${m.matricula}, 'solicitado', ${m.precio}, ${NOTA}) returning id`)[0].id;
const limpiar = async () => {
  await d`delete from public.canjes where matricula_id = ${m.matricula} and nota_alumno = ${NOTA}`;
};
await limpiar();

const tramos = (await d`select nota::float8 as nota, peso from public.ruleta_tramos order by orden`);
const total = tramos.reduce((n, t) => n + t.peso, 0);
let acum = 0;
const geometria = tramos.map((t) => {
  const grados = (t.peso / total) * 360;
  const s = { ...t, ini: acum, fin: acum + grados };
  acum += grados;
  return s;
});

// ---------- El servidor y las intercepciones ----------

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
                '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const servidor = createServer(async (req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const archivo = ruta === '/' || !extname(ruta) ? 'index.html' : ruta.slice(1);
    const cuerpo = await readFile(join(DIST, archivo));
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
    res.end(cuerpo);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((ok) => servidor.listen(PUERTO, ok));
const BASE = `http://localhost:${PUERTO}`;

/** Si no es null, `tirar-ruleta` contesta esta nota sin tocar la base. */
let forzada = null;
let llamadasTirar = 0;

const json = (r, cuerpo, estado = 200) =>
  r.respond({ status: estado, contentType: 'application/json', body: JSON.stringify(cuerpo) });

async function atender(r) {
  const url = new URL(r.url());
  if (url.origin !== BASE) return r.abort();            // fuentes de Google, etc.
  const ruta = url.pathname;

  if (ruta === '/api/auth/sesion') {
    return json(r, { usuario_id: docente.id, token: 'a.b.c', expira_en: 3600 });
  }
  if (ruta === '/api/docente') {
    const cuerpo = JSON.parse(r.postData() ?? '{}');
    if (cuerpo.accion === 'ruleta-tramos') {
      return json(r, { filas: await como(docente.id, (s) =>
        s`select nota::float8 as nota, peso from public.ruleta_tramos order by orden`) });
    }
    if (cuerpo.accion === 'tirar-ruleta') {
      llamadasTirar++;
      if (forzada !== null) {
        return json(r, { filas: [{ r: { nota: forzada, tramos, canje: { id: cuerpo.canje, estado: 'entregado',
          ruleta_nota: forzada, comentario_docente: 'forzada' } } }] });
      }
      try {
        const filas = await como(docente.id, (s) =>
          s`select public.tirar_ruleta(${Number(cuerpo.canje)}::bigint) as r`);
        return json(r, { filas });
      } catch (e) {
        return json(r, { error: e.message }, 400);
      }
    }
    return json(r, { filas: [] });                       // reunion-secciones, secciones…
  }
  if (ruta.startsWith('/db/')) {
    const tabla = ruta.slice(4);
    const unico = (r.headers().accept ?? '').includes('vnd.pgrst.object');
    let filas = [];
    if (tabla === 'docentes') filas = [{ id: docente.id }];
    else if (tabla === 'docente_asignaturas') {
      filas = [{ asignatura_id: m.asignatura_id, periodo_id: m.periodo_id,
                 asignaturas: { sigla: m.sigla, nombre: m.asignatura }, periodos: { codigo: m.periodo } }];
    } else if (tabla === 'canjes_detalle') {
      // Solo los de esta prueba: nada de alumnos reales en las capturas.
      filas = (await como(docente.id, (s) =>
        s`select to_json(x) as j from public.canjes_detalle x
           where x.matricula_id = ${m.matricula} and x.nota_alumno = ${NOTA} and x.estado = 'solicitado'
           order by x.id`)).map((x) => x.j);
    }
    return json(r, unico ? (filas[0] ?? null) : filas, unico && !filas[0] ? 406 : 200);
  }
  return r.continue();
}

// ---------- El navegador ----------

const nav = await puppeteer.launch({ executablePath: chrome, headless: true,
  args: ['--no-first-run', '--window-size=1440,900'] });

/** El ángulo con que quedó la rueda y qué tramo cayó bajo el puntero (a las 12). */
const tramoBajoElPuntero = async (pagina) => {
  const grados = await pagina.$eval('.gira', (g) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(g).transform);
    return Math.atan2(m.b, m.a) * 180 / Math.PI;
  });
  const enLaRueda = (((-grados) % 360) + 360) % 360;
  return { grados, enLaRueda, tramo: geometria.find((t) => enLaRueda >= t.ini && enLaRueda < t.fin) };
};

const abrirPagina = async (reducido = false, tema = null) => {
  const p = await nav.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  if (reducido) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (tema) await p.evaluateOnNewDocument((t) => localStorage.setItem('pulso.tema', t), tema);
  await p.setRequestInterception(true);
  p.on('request', (r) => { atender(r).catch((e) => { console.error('intercepción:', e.message); r.abort().catch(() => {}); }); });
  p.on('pageerror', (e) => { f++; console.log(`  ✗ error en la página: ${e.message}`); });
  await p.goto(`${BASE}/curso`, { waitUntil: 'networkidle0' });
  await p.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Tirar la ruleta')), { timeout: 15000 });
  return p;
};

const abrirModal = async (p) => {
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Tirar la ruleta')).click());
  await p.waitForSelector('app-ruleta .panel svg .sector', { timeout: 10000 });
  await p.waitForFunction(() => [...document.querySelectorAll('app-ruleta button')].some((b) => b.textContent.includes('Girar') && !b.disabled), { timeout: 5000 });
};

const girar = async (p) => {
  const t0 = Date.now();
  await p.evaluate(() => [...document.querySelectorAll('app-ruleta button')].find((b) => b.textContent.includes('Girar')).click());
  await p.waitForSelector('app-ruleta .resultado', { timeout: 15000 });
  return Date.now() - t0;
};

const cerrar = async (p) => {
  await p.evaluate(() => [...document.querySelectorAll('app-ruleta .lado button')].find((b) => b.textContent.trim() === 'Cerrar').click());
  await p.waitForFunction(() => !document.querySelector('app-ruleta'), { timeout: 5000 });
};

const fmt = (n) => n.toFixed(1).replace('.', ',');

try {
  console.log(`Ruleta en el navegador (${DIST}) · ${m.sigla}`);

  // ---------- Tanda 1: notas forzadas, para ver el frenado en cada tramo ----------
  console.log('\nGeometría: la rueda frena dentro del tramo que dijo el servidor');
  const fixtures = [await fixture()];
  let p = await abrirPagina();
  await p.screenshot({ path: join(CAPTURAS, '0-bandeja.png') });
  let primera = true;
  for (const nota of [1, 4, 5, 6, 7]) {
    forzada = nota;
    await abrirModal(p);
    if (primera) await p.screenshot({ path: join(CAPTURAS, '1-antes.png') });
    const t0 = Date.now();
    await p.evaluate(() => [...document.querySelectorAll('app-ruleta button')].find((b) => b.textContent.includes('Girar')).click());
    if (primera) {
      await pausa(2200);
      await p.screenshot({ path: join(CAPTURAS, '2-girando.png') });
    }
    await p.waitForSelector('app-ruleta .resultado', { timeout: 15000 });
    const ms = Date.now() - t0;
    const { enLaRueda, tramo } = await tramoBajoElPuntero(p);
    const mostrado = await p.$eval('app-ruleta .cifra-grande', (e) => e.textContent.trim());
    rev(`forzada ${fmt(nota)}: la pantalla dice`, mostrado, fmt(nota));
    rev(`  y el puntero quedó sobre (a ${enLaRueda.toFixed(2)}° de la rueda)`, tramo?.nota, nota);
    verdad('  tardó lo de la animación', ms >= 4500 && ms <= 7500, `${ms} ms`);
    await pausa(600); // que termine de aparecer el resultado: a mitad del fundido se ve desteñido
    await p.screenshot({ path: join(CAPTURAS, `3-resultado-${nota}.png`) });
    primera = false;
    await cerrar(p);
  }
  rev('la bandeja sigue con el canje (era forzado: la base no se tocó)',
    (await d`select estado from public.canjes where id = ${fixtures[0]}`)[0].estado, 'solicitado');
  rev('y se llamó 5 veces a tirar-ruleta', llamadasTirar, 5);
  await p.close();

  // ---------- Tanda 2: el sorteo real ----------
  console.log('\nSorteo real: tirar_ruleta de la base, con la identidad del docente');
  forzada = null;
  for (let i = 0; i < 2; i++) fixtures.push(await fixture());
  p = await abrirPagina();
  const salieron = [];
  for (let i = 0; i < 3; i++) {
    await abrirModal(p);
    await girar(p);
    const { tramo } = await tramoBajoElPuntero(p);
    const mostrado = await p.$eval('app-ruleta .cifra-grande', (e) => e.textContent.trim());
    const id = fixtures[i];
    const [c] = await d`select estado, ruleta_nota::float8 as n, comentario_docente, resuelto_por
                          from public.canjes where id = ${id}`;
    salieron.push(c.n);
    rev(`giro real ${i + 1}: la base guardó la nota que muestra la pantalla`, [c.estado, fmt(c.n)], ['entregado', mostrado]);
    rev('  y el puntero quedó sobre ese tramo', tramo?.nota, c.n);
    rev('  firmado por el docente', c.resuelto_por, docente.id);
    if (i === 0) await p.screenshot({ path: join(CAPTURAS, '4-real.png') });
    await cerrar(p);
    // Al cerrar se recarga la bandeja: el canje resuelto ya no está.
    await pausa(600);
    const quedan = await p.$$eval('table tr td button', (bs) => bs.filter((b) => b.textContent.includes('Tirar la ruleta')).length);
    rev('  la bandeja ya no lo muestra; quedan por resolver', quedan, 2 - i);
  }
  console.log(`  (salieron ${salieron.map((n) => fmt(n)).join(', ')})`);
  await p.close();

  // ---------- Tanda 3: sin movimiento ----------
  console.log('\nprefers-reduced-motion: no gira, muestra la nota de una vez');
  forzada = 5;
  await fixture();
  p = await abrirPagina(true);
  await abrirModal(p);
  const ms = await girar(p);
  verdad('el resultado aparece sin esperar el giro', ms < 2500, `${ms} ms`);
  const transicion = await p.$eval('.gira', (g) => getComputedStyle(g).transitionDuration);
  rev('y la rueda no tiene transición', transicion, '0s');
  const { tramo } = await tramoBajoElPuntero(p);
  rev('pero el puntero igual queda en el tramo', tramo?.nota, 5);
  await p.screenshot({ path: join(CAPTURAS, '5-sin-movimiento.png') });
  await cerrar(p);
  await p.close();

  // ---------- Tanda 4: los dos temas ----------
  // La rueda pinta con tokens: la misma pantalla tiene que verse bien en claro y en oscuro.
  console.log('\nTemas claro y oscuro');
  forzada = 6;
  for (const tema of ['claro', 'oscuro']) {
    p = await abrirPagina(false, tema);
    rev(`tema ${tema} puesto`, await p.$eval('html', (h) => h.getAttribute('data-tema')), tema);
    await abrirModal(p);
    await p.screenshot({ path: join(CAPTURAS, `6-${tema}-antes.png`) });
    await girar(p);
    const { tramo } = await tramoBajoElPuntero(p);
    rev(`  la franja del 6,0 con el tema ${tema}`, tramo?.nota, 6);
    await pausa(600);
    await p.screenshot({ path: join(CAPTURAS, `6-${tema}-resultado.png`) });
    await cerrar(p);
    await p.close();
  }
} finally {
  await nav.close();
  servidor.close();
  await limpiar();
}

const [{ n: restos }] = await d`select count(*)::int as n from public.canjes
   where matricula_id = ${m.matricula} and nota_alumno = ${NOTA}`;
console.log('\nLo que queda');
rev('ningún canje de la prueba', restos, 0);
console.log(`Capturas en ${CAPTURAS}`);
console.log(f === 0 ? '\nTodo bien.' : `\n${f} fallos.`);
process.exit(f === 0 ? 0 : 1);
