/**
 * Que el deck se pueda leer y navegar en un teléfono.
 *
 * A diferencia de las otras tres pruebas de clase, ésta **no toca la base ni la
 * red**: coge un deck de la carpeta de la asignatura, le pega lo que `/api/clase`
 * le pegaría al pasar, y lo sirve desde un servidor local. Puede correr sin
 * desplegar y sin credenciales, que es justo lo que hace falta cuando se está
 * peleando con una transformación CSS.
 *
 * Lo que comprueba, en un teléfono emulado de 390x750:
 *
 *   1. que el escenario quede girado y el texto crezca 1,78 veces —medido en la
 *      diapositiva más densa, que es la que decide, no en la portada—;
 *   2. que se pueda **avanzar**, que es lo que de verdad estaba roto —el deck
 *      solo se navega con el teclado y en un teléfono no hay teclado—;
 *   3. que acostado no gire, porque ahí el escalado del propio deck ya sirve;
 *   4. que la copia descargable no traiga el rastreo y sí venga en modo estudio.
 *
 * Y deja capturas en `/tmp/pulso-movil/` para mirarlas: el «se ve bien» de una
 * diapositiva no lo decide un número.
 *
 *   node neon/probar-clase-movil.mjs [--archivo ruta/al/deck.html]
 */
import { readFile, access, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename } from 'node:path';
import { instrumentar, paraLlevar } from '../lib/rastreo-clase.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const ARCHIVO = args.archivo ??
  '../Desarrollo_Cloud_Native/Clases/decks/D1-Peticion-HTTP-y-API-Gateway.html';
const CAPTURAS = args.capturas ?? '/tmp/pulso-movil';

// El teléfono de referencia: un iPhone reciente con la barra del navegador ya
// descontada. Los números que persigue esta prueba salen de acá.
const TELEFONO = { width: 390, height: 750 };
const ACOSTADO = { width: 844, height: 345 };

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

let fallos = 0;
function revisar(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`));
}

function informar(etiqueta, valor) {
  console.log(`    ${etiqueta}: ${valor}`);
}

// ---------- El deck, en sus tres versiones ----------

const crudo = await readFile(ARCHIVO, 'utf8');
const servido = instrumentar(crudo, { claseId: 'prueba', docente: false, slides: 0 });
const descargado = paraLlevar(crudo);

const paginas = {
  '/servido': servido,     // lo que ve el alumno
  '/crudo': crudo,         // la referencia: cómo estaba antes
  '/descargado': descargado,
};

const chrome = await buscarChrome();
if (!chrome) {
  console.error('No encontré Chrome. Pásalo con la variable CHROME=/ruta/al/binario');
  process.exit(2);
}

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('Falta puppeteer-core. Instálalo con:  npm i -D puppeteer-core');
  process.exit(2);
}

const servidor = createServer((req, res) => {
  const cuerpo = paginas[req.url.split('?')[0]];
  if (!cuerpo) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(cuerpo);
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

await mkdir(CAPTURAS, { recursive: true });

console.log(`Deck      ${basename(ARCHIVO)} (${(crudo.length / 1024).toFixed(0)} KB)`);
console.log(`Teléfono  ${TELEFONO.width}x${TELEFONO.height}`);
console.log(`Capturas  ${CAPTURAS}\n`);

const navegador = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
});

/** Abre una de las tres versiones en un teléfono emulado. */
async function abrir(ruta, medidas) {
  const pagina = await navegador.newPage();
  // `hasTouch` es lo que hace que `(pointer: coarse)` sea cierta, que es la
  // consulta de la que cuelga todo lo del celular. Se comprueba en el primer
  // paso, porque si dejara de valer esta prueba pasaría en verde sin probar nada.
  await pagina.setViewport({ ...medidas, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 400));
  return pagina;
}

/**
 * El tamaño con que el cuerpo de texto llega de verdad a la pantalla.
 *
 * El factor sale de la matriz de la transformación y no de medir el rectángulo
 * del párrafo: girado noventa grados, el alto del rectángulo envolvente es el
 * ancho del párrafo y la cuenta saldría mal sin que nada se queje.
 *
 * Y el tamaño se toma del **mayor** de los párrafos con texto de verdad, no del
 * primero que aparezca. Los decks tienen bajadas, pies de fuente y etiquetas más
 * chicas; midiendo la primera que toque, el número cambia de diapositiva en
 * diapositiva y deja de significar «se lee o no se lee».
 */
const tamanoEnPantalla = (pagina) => pagina.evaluate(() => {
  const escenario = document.getElementById('escenario');
  const m = new DOMMatrix(getComputedStyle(escenario).transform);
  const factor = Math.hypot(m.a, m.b);
  const tallas = [...document.querySelectorAll('.slide.activa p, .slide.activa li')]
    .filter((el) => el.textContent.trim().length > 20)
    .map((el) => parseFloat(getComputedStyle(el).fontSize));
  if (!tallas.length) tallas.push(parseFloat(getComputedStyle(document.body).fontSize));
  return {
    factor: +factor.toFixed(3),
    px: +(Math.max(...tallas) * factor).toFixed(1),
    menor: +(Math.min(...tallas) * factor).toFixed(1),
  };
});

/**
 * Cuánto ha avanzado el deck: diapositiva **y** pasos revelados.
 *
 * Con el contador solo no basta. La flecha del deck primero revela los pasos de
 * la diapositiva y recién cuando se acaban pasa a la siguiente, así que en un
 * deck cuya primera diapositiva tiene pasos —D9, por ejemplo— una flecha que
 * funciona perfectamente deja el contador quieto. Comprobando solo el contador,
 * la prueba acusaba de rota la navegación que acababa de hacer justo lo suyo.
 */
const avance = (pagina) => pagina.evaluate(() =>
  (document.getElementById('contador')?.textContent ?? '') +
  ' +' + document.querySelectorAll('.slide.activa .paso.visible').length);

/** Va a una diapositiva con todos sus pasos a la vista. */
async function irASlide(pagina, i) {
  await pagina.evaluate((n) => {
    irA(n);
    document.querySelectorAll('.slide.activa .paso').forEach((p) => p.classList.add('visible'));
  }, i);
  await new Promise((r) => setTimeout(r, 300));
}

/**
 * Las diapositivas más densas: código, tablas y widgets pesan más que el texto.
 * Son las que deciden si el deck se puede leer en un teléfono —la portada son
 * tres líneas y aire, y en la portada todo se ve bien—.
 */
const masDensas = (pagina, cuantas) => pagina.evaluate((total) => {
  const peso = (s) => (s.querySelector('pre') ? 3 : 0) +
    (s.querySelector('table') ? 3 : 0) +
    (s.querySelector('[data-widget]') ? 2 : 0) +
    s.textContent.trim().length / 400;
  return [...document.querySelectorAll('.slide')]
    .map((s, i) => ({ i, peso: peso(s) }))
    .sort((a, b) => b.peso - a.peso)
    .slice(0, total)
    .map((x) => x.i);
}, cuantas);

/** Un deslizamiento de verdad, en tres eventos táctiles como los de un dedo. */
async function deslizar(pagina, desde, hasta) {
  await pagina.touchscreen.touchStart(desde.x, desde.y);
  await pagina.touchscreen.touchMove((desde.x + hasta.x) / 2, (desde.y + hasta.y) / 2);
  await pagina.touchscreen.touchMove(hasta.x, hasta.y);
  await pagina.touchscreen.touchEnd();
  await new Promise((r) => setTimeout(r, 250));
}

try {
  // ---------- 1. La referencia: cómo se veía antes ----------

  console.log('1. El deck sin nada, en vertical — la referencia');
  const antes = await abrir('/crudo', TELEFONO);
  revisar('el navegador emulado se declara táctil',
    await antes.evaluate(() => matchMedia('(pointer: coarse)').matches), true);

  // Se mide en la diapositiva más densa y no en la portada, y las dos versiones
  // se miden en la misma, para que la comparación sea de lo mismo contra lo mismo.
  const [densa, ...otrasDensas] = await masDensas(antes, 3);
  await irASlide(antes, densa);
  const medidaAntes = await tamanoEnPantalla(antes);
  informar('diapositiva medida', densa + 1);
  informar('factor', medidaAntes.factor);
  informar('texto en pantalla', `${medidaAntes.px} px (el más chico, ${medidaAntes.menor} px)`);
  revisar('es ilegible, que es el problema', medidaAntes.px < 8, true);
  await antes.screenshot({ path: `${CAPTURAS}/1-antes-vertical.png` });

  console.log('\n   Y no se puede navegar: no hay teclado en un teléfono');
  const antesAvance = await avance(antes);
  await deslizar(antes, { x: 300, y: 400 }, { x: 80, y: 400 });
  revisar('deslizar no hace nada', await avance(antes), antesAvance);
  await antes.close();

  // ---------- 2. Con lo inyectado ----------

  console.log('\n2. El mismo deck servido por Pulso, en vertical');
  const movil = await abrir('/servido', TELEFONO);
  revisar('giró el escenario',
    await movil.evaluate(() => document.body.classList.contains('pulso-girado')), true);

  await irASlide(movil, densa);
  const medida = await tamanoEnPantalla(movil);
  informar('factor', medida.factor);
  informar('texto en pantalla', `${medida.px} px (el más chico, ${medida.menor} px)`);
  // Lo que el giro garantiza es la proporción: 0,361 contra 0,203, que son 1,78
  // veces. El piso absoluto es más bajo de lo que uno querría a propósito —las
  // diapositivas densas escriben el cuerpo en 22 px y no en 31, así que caen a
  // unos 8 px— y está puesto donde caza una regresión, no donde uno firmaría el
  // resultado. Subirlo de verdad exige remaquetar, que es otro trabajo.
  informar('mejora', `${(medida.px / medidaAntes.px).toFixed(2)}×`);
  revisar('el texto crece lo que da la geometría', medida.px / medidaAntes.px > 1.7, true);
  revisar('deja de ser microscópico', medida.px >= 7.5, true);

  // Que quepa: girado mal, el escenario se sale de la pantalla y media
  // diapositiva queda fuera sin que ninguna otra comprobación se entere.
  const caja = await movil.evaluate(() => {
    const r = document.getElementById('escenario').getBoundingClientRect();
    return { izq: Math.round(r.left), arr: Math.round(r.top),
             der: Math.round(r.right), aba: Math.round(r.bottom) };
  });
  informar('recuadro', JSON.stringify(caja));
  revisar('entra entero en la pantalla',
    caja.izq >= -1 && caja.arr >= -1 &&
    caja.der <= TELEFONO.width + 1 && caja.aba <= TELEFONO.height + 1, true);

  await movil.screenshot({ path: `${CAPTURAS}/2-despues-vertical.png` });

  // Se vuelve a la portada: los pasos de las pruebas de navegación cuentan desde
  // el principio, y la diapositiva medida quedó con todos sus pasos revelados.
  await movil.evaluate(() => irA(0));
  await new Promise((r) => setTimeout(r, 250));

  // ---------- 3. Avanzar ----------

  console.log('\n3. Avanzar con los botones');
  revisar('hay dos botones',
    await movil.evaluate(() => document.querySelectorAll('[data-pulso="nav"] button').length), 2);
  revisar('son del tamaño de un dedo',
    await movil.evaluate(() => {
      const b = document.querySelector('[data-pulso="nav"] button');
      const r = b.getBoundingClientRect();
      return Math.min(r.width, r.height) >= 44;
    }), true);

  const c0 = await avance(movil);
  await movil.evaluate(() =>
    document.querySelector('[data-pulso="nav"] button[aria-label*="siguiente"]').click());
  await new Promise((r) => setTimeout(r, 250));
  const c1 = await avance(movil);
  informar('avance', `${c0} → ${c1}`);
  revisar('el botón avanzó', c1 !== c0, true);

  await movil.evaluate(() =>
    document.querySelector('[data-pulso="nav"] button[aria-label*="anterior"]').click());
  await new Promise((r) => setTimeout(r, 250));
  revisar('y el otro retrocede', await avance(movil), c0);

  console.log('\n4. Avanzar deslizando');
  // Girado, el eje de lectura corre de arriba abajo: se pasa la página hacia
  // arriba. Con un deslizamiento horizontal no tiene que pasar nada.
  const c2 = await avance(movil);
  await deslizar(movil, { x: 195, y: 520 }, { x: 195, y: 240 });
  const c3 = await avance(movil);
  informar('avance', `${c2} → ${c3}`);
  revisar('deslizar hacia arriba avanza', c3 !== c2, true);

  await deslizar(movil, { x: 195, y: 240 }, { x: 195, y: 520 });
  revisar('y hacia abajo retrocede', await avance(movil), c2);

  const c4 = await avance(movil);
  await deslizar(movil, { x: 320, y: 380 }, { x: 70, y: 380 });
  revisar('el deslizamiento cruzado se ignora', await avance(movil), c4);

  // ---------- Capturas de diapositivas con contenido ----------

  // La portada es el caso fácil: tres líneas y aire. Lo que decide si esto sirve
  // o si hace falta remaquetar de verdad son las densas —código, tabla, quiz—, y
  // eso no lo dice ningún número. Se revelan todos los pasos de cada una, porque
  // media diapositiva oculta se ve estupenda y no prueba nada.
  console.log('\n   Capturas de diapositivas densas, para mirarlas');
  await movil.evaluate(() =>
    document.querySelector('[data-pulso="pista"]')?.remove()); // se va sola a los 6 s
  for (const i of [densa, ...otrasDensas]) {
    await irASlide(movil, i);
    await movil.screenshot({ path: `${CAPTURAS}/4-densa-${i + 1}.png` });
  }
  informar('diapositivas capturadas', [densa, ...otrasDensas].map((i) => i + 1).join(', '));

  await movil.close();

  // ---------- 5. Acostado ----------

  console.log('\n5. El teléfono acostado no se gira');
  const horizontal = await abrir('/servido', ACOSTADO);
  revisar('no gira',
    await horizontal.evaluate(() => document.body.classList.contains('pulso-girado')), false);
  const medidaH = await tamanoEnPantalla(horizontal);
  informar('texto en pantalla', `${medidaH.px} px`);

  const h0 = await avance(horizontal);
  await deslizar(horizontal, { x: 700, y: 170 }, { x: 220, y: 170 });
  revisar('acostado se desliza hacia la izquierda', await avance(horizontal) !== h0, true);
  await horizontal.screenshot({ path: `${CAPTURAS}/3-acostado.png` });
  await horizontal.close();

  // ---------- 6. La copia descargable ----------

  console.log('\n6. La copia que se lleva el alumno');
  revisar('no trae el rastreo', descargado.includes('data-pulso="rastreo"'), false);
  revisar('no llama a /api/clase-avance', descargado.includes('/api/clase-avance'), false);
  revisar('es el deck completo', descargado.length >= crudo.length, true);

  const llevado = await abrir('/descargado', TELEFONO);
  revisar('arranca en modo estudio',
    await llevado.evaluate(() => document.body.dataset.modo), 'estudio');
  revisar('sin errores de JavaScript',
    await llevado.evaluate(() => document.querySelectorAll('.slide').length > 0), true);
  await llevado.close();

  // ---------- 7. Que en la sala no cambie nada ----------

  // Lo más caro que podría romper este cambio no es un teléfono: es el deck
  // proyectado en clase, que se sirve por la misma ruta y ahora lleva lo mismo
  // inyectado. Tiene que ser un no-op exacto con puntero fino.
  console.log('\n7. En el notebook, proyectando, no cambia nada');
  const sala = await navegador.newPage();
  await sala.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  const erroresSala = [];
  sala.on('pageerror', (e) => erroresSala.push(e.message));
  await sala.goto(`${BASE}/servido`, { waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 400));

  revisar('el navegador no se declara táctil',
    await sala.evaluate(() => matchMedia('(pointer: coarse)').matches), false);
  revisar('no gira', await sala.evaluate(() => document.body.className), '');
  revisar('no aparecen botones',
    await sala.evaluate(() => document.querySelectorAll('[data-pulso="nav"]').length), 0);
  revisar('el HUD del deck sigue ahí',
    await sala.evaluate(() => {
      const h = document.querySelector('.hud');
      return !!h && getComputedStyle(h).display !== 'none';
    }), true);
  revisar('el escalado es el del propio deck',
    await sala.evaluate(() => {
      const m = new DOMMatrix(getComputedStyle(document.getElementById('escenario')).transform);
      return Math.abs(Math.hypot(m.a, m.b) - Math.min(1440 / 1920, 900 / 1080)) < 0.001;
    }), true);
  revisar('sin errores de JavaScript', erroresSala, []);

  const sala0 = await avance(sala);
  await sala.keyboard.press('ArrowRight');
  await new Promise((r) => setTimeout(r, 200));
  revisar('la flecha sigue avanzando', await avance(sala) !== sala0, true);
  await sala.close();

  console.log(fallos === 0
    ? `\nTodo bien: de ${medidaAntes.px} px a ${medida.px} px, y se puede avanzar.`
    : `\n${fallos} comprobación(es) fallaron.`);
} finally {
  await navegador.close();
  servidor.close();
}

process.exit(fallos === 0 ? 0 : 1);
