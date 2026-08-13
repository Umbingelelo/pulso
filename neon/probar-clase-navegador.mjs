/**
 * La tercera prueba: un navegador de verdad ejecutando el deck.
 *
 * Las otras dos no pueden ver lo que más importa. `probar-clase.mjs` comprueba la
 * lógica de Postgres; `probar-clase-http.mjs` comprueba que el script inyectado
 * **está** en el HTML que sale por el cable. Ninguna comprueba que se **ejecute**.
 *
 * Y ahí está lo frágil: el script alcanza `cambiarModo` porque en JavaScript una
 * declaración de función en el nivel superior de un script clásico queda en el
 * objeto global; e intercepta el guardado del deck envolviendo
 * `Storage.prototype.setItem`. Las dos cosas son ciertas hasta que la plantilla
 * de los decks cambie —a un módulo ES, por ejemplo— y entonces dejarían de ser
 * ciertas **en silencio**: el alumno vería su clase igual de bien y no sumaría un
 * solo punto. Esta prueba es la que se daría cuenta.
 *
 * Necesita `puppeteer-core` (devDependency, sin descargar navegador) y un Chrome
 * instalado. No usa tu perfil: arma uno temporal y lo borra al terminar.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-clase-navegador.mjs [--sigla DSY1107] [--codigo S01]
 */
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const BASE = process.env.BASE ?? 'https://pulso-rust.vercel.app';
const CORREO = 'alumno.prueba@duocuc.cl';
const CLAVE = process.env.CLAVE_PRUEBA ?? 'pulso-prueba-2026';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const SIGLA = args.sigla ?? 'DSY1107';
const CODIGO = args.codigo ?? 'S01';

const CANDIDATOS = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

async function buscarChrome() {
  for (const ruta of CANDIDATOS) {
    try { await access(ruta); return ruta; } catch { /* siguiente */ }
  }
  return null;
}

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('Falta puppeteer-core. Instálalo con:  npm i -D puppeteer-core');
  process.exit(2);
}

const chrome = await buscarChrome();
if (!chrome) {
  console.error('No encontré Chrome. Pásalo con la variable CHROME=/ruta/al/binario');
  process.exit(2);
}

let fallos = 0;
function revisar(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`));
}

// ---------- Estado limpio ----------

const dueno = neon(process.env.DATABASE_URL_OWNER);
const [clase] = await dueno`
  select c.id, c.slides, c.titulo, c.actividades, c.puntos_actividad
    from public.clases c join public.asignaturas a on a.id = c.asignatura_id
   where a.sigla = ${SIGLA} and c.codigo = ${CODIGO}`;
if (!clase) throw new Error(`No existe la clase ${SIGLA}/${CODIGO}.`);

const [mat] = await dueno`
  select mt.id from public.matriculas mt
    join public.usuarios    u on u.id = mt.perfil_id
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
   where lower(u.correo) = ${CORREO} and a.sigla = ${SIGLA}`;
if (!mat) throw new Error(`${CORREO} no está matriculado en ${SIGLA}.`);

await dueno`delete from public.progreso_clase
             where matricula_id = ${mat.id} and clase_id = ${clase.id}`;
await dueno`delete from public.movimientos_puntos
             where matricula_id = ${mat.id}
               and (motivo like ${'%clase ' + CODIGO + '%'} or motivo like ${'%de ' + CODIGO})`;

console.log(`Chrome  ${chrome}`);
console.log(`Contra  ${BASE}`);
console.log(`Clase   ${SIGLA}/${CODIGO} · ${clase.titulo} · ${clase.slides} slides\n`);

const perfil = await mkdtemp(join(tmpdir(), 'pulso-chrome-'));
const navegador = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  userDataDir: perfil,
  args: ['--no-first-run', '--no-default-browser-check'],
});

try {
  const pagina = await navegador.newPage();

  console.log('1. Iniciar sesión');
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await pagina.waitForSelector('input[type=email]', { timeout: 20000 });
  await pagina.type('input[type=email]', CORREO);
  await pagina.type('input[type=password]', CLAVE);
  await pagina.click('button[type=submit]');
  // Por condición y no por reloj: el ingreso es un cambio de ruta del lado del
  // cliente y tarda lo que tarde la red. Con una espera fija la prueba falla por
  // lenta y no por rota, que es peor que no tenerla.
  let dentro = false;
  for (let i = 0; i < 30; i++) {
    if (!/\/ingresar\/?$/.test(pagina.url())) { dentro = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  revisar('quedó dentro', dentro, true);

  console.log('\n2. La lista de clases');
  // La página muestra las clases del ramo **seleccionado**, y el alumno de prueba
  // cursa dos asignaturas. Sin elegir el ramo de la clase que estamos probando,
  // la lista sale correcta pero de la otra asignatura, y la prueba acusa un fallo
  // que no existe. Se deja elegido el que corresponde, igual que si el alumno lo
  // hubiera cambiado en el selector.
  await pagina.evaluate((id) => localStorage.setItem('pulso.ramo', id), mat.id);
  await pagina.goto(`${BASE}/clases`, { waitUntil: 'networkidle2' });
  // Se espera el contenido y no un tiempo fijo: Angular pide perfil, ramos y
  // clases en cadena, y con un sleep la prueba falla por lenta, no por rota.
  let texto = '';
  for (let i = 0; i < 30; i++) {
    texto = await pagina.evaluate(() => document.body.innerText);
    if (texto.includes(clase.titulo) || /no hay clases publicadas/i.test(texto)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  revisar('aparece la clase', texto.includes(clase.titulo), true);
  revisar('muestra los puntos por ganar', /puntos por ganar/i.test(texto), true);

  console.log('\n3. Abrir el deck');
  const deck = await navegador.newPage();
  const avances = [];
  deck.on('response', async (r) => {
    if (!r.url().includes('/api/clase-avance')) return;
    let cuerpo = null;
    try { cuerpo = await r.json(); } catch { /* respuesta vacía */ }
    avances.push({ estado: r.status(), cuerpo });
  });
  const errores = [];
  deck.on('pageerror', (e) => errores.push(e.message));

  await deck.goto(`${BASE}/api/clase?id=${clase.id}`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2000));

  revisar('cargaron las diapositivas',
    await deck.evaluate(() => document.querySelectorAll('.slide').length), clase.slides);
  revisar('sin errores de JavaScript', errores, []);
  // Las dos apuestas del inyector, comprobadas de verdad:
  revisar('alcanzó cambiarModo y forzó el modo estudio',
    await deck.evaluate(() => document.body.dataset.modo), 'estudio');
  revisar('el script está en la página',
    await deck.evaluate(() => !!document.querySelector('script[data-pulso="rastreo"]')), true);

  console.log('\n4. Recorrer el deck con la flecha derecha');
  for (let i = 0; i < clase.slides * 3; i++) {
    await deck.keyboard.press('ArrowRight');
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 3000)); // vence el debounce de 1,5 s
  revisar('llegó al final',
    await deck.evaluate(() => document.getElementById('contador')?.textContent),
    `${clase.slides} / ${clase.slides}`);
  revisar('la intercepción reportó al navegar', avances.length > 0, true);
  revisar('todos los reportes fueron 200', avances.every((a) => a.estado === 200), true);

  console.log('\n5. Responder un quiz correctamente');
  const antes = avances.length;
  revisar('pudo responder', await deck.evaluate(() => {
    const w = document.querySelector('[data-widget="quiz"]');
    if (!w) return 'sin quiz';
    const op = w.querySelector(`.opcion[data-op="${w.dataset.correcta}"]`);
    if (!op) return 'sin la alternativa correcta';
    op.click();
    return 'ok';
  }), 'ok');
  await new Promise((r) => setTimeout(r, 3500));
  const nuevos = avances.slice(antes);
  revisar('reportó tras responder', nuevos.length > 0, true);
  revisar('pagó la actividad',
    nuevos.reduce((s, a) => s + (a.cuerpo?.puntos_nuevos ?? 0), 0), clase.puntos_actividad);
  revisar('avisó al alumno',
    await deck.evaluate(() => document.querySelector('[data-pulso="aviso"]')?.textContent ?? null),
    `+${clase.puntos_actividad} puntos`);

  console.log(fallos === 0
    ? '\nTodo bien en el navegador: el inyector se ejecuta y los puntos llegan.'
    : `\n${fallos} comprobación(es) fallaron.`);
} finally {
  await navegador.close();
  await rm(perfil, { recursive: true, force: true });
}

process.exit(fallos === 0 ? 0 : 1);
