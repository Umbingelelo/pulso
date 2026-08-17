/**
 * El laboratorio en un navegador de verdad, con el alumno de prueba.
 *
 * `probar-laboratorio.mjs` ya cubre la base. Esto cubre lo único que aquella no
 * puede: que el HTTP, la sesión por cookie y la pantalla hagan lo suyo. En
 * particular el guardado automático, que es la parte del producto donde una
 * falla silenciosa le cuesta al alumno dos horas de trabajo —escribe, se ve
 * bien, y no viajó nada—.
 *
 * Va contra la URL directa del despliegue y no contra el dominio: demasiadas
 * sesiones sin cabeza seguidas hacen que la protección de Vercel bloquee la IP
 * de casa, y esa ya nos pasó.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-laboratorio-navegador.mjs https://…vercel.app [--codigo L1]
 */
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const BASE = process.argv[2] ?? 'https://pulso-rust.vercel.app';
const CODIGO = process.argv.includes('--codigo')
  ? process.argv[process.argv.indexOf('--codigo') + 1] : 'L1';
/** `--foto ruta.png` deja el enunciado entero en una imagen, para mirarlo con ojos. */
const FOTO = process.argv.includes('--foto')
  ? process.argv[process.argv.indexOf('--foto') + 1] : null;

let chrome = null;
for (const c of [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                 '/usr/bin/google-chrome'].filter(Boolean)) {
  try { await access(c); chrome = c; break; } catch {}
}
if (!chrome) { console.error('No encontré Chrome'); process.exit(2); }
const puppeteer = (await import('puppeteer-core')).default;

const d = neon(process.env.DATABASE_URL_OWNER);
let f = 0;
const rev = (e, r, x) => { const ok = JSON.stringify(r) === JSON.stringify(x);
  if (!ok) f++; console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(r)}` +
    (ok ? '' : ` ← esperaba ${JSON.stringify(x)}`)); };
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- Dejar la pizarra limpia ----------

const [m] = await d`
  select mt.id as matricula, a.id as actividad, a.titulo
    from public.matriculas mt
    join public.perfiles   p on p.id = mt.perfil_id
    join public.usuarios   u on u.id = p.id
    join public.secciones  s on s.id = mt.seccion_id
    join public.actividades a on a.asignatura_id = s.asignatura_id
                             and a.periodo_id    = s.periodo_id
    join public.laboratorios l on l.actividad_id = a.id
   where lower(u.correo) = 'alumno.prueba@duocuc.cl' and a.codigo = ${CODIGO}`;
if (!m) throw new Error(`El alumno de prueba no tiene el laboratorio ${CODIGO}`);

// Por marca de agua **y** por motivo. La marca sola no alcanza: una corrida que
// se muera después de entregar deja sus puntos ahí, y la siguiente toma su marca
// por encima de ellos, con lo que quedan sumando para siempre sin que ninguna
// limpieza los vea. Y por motivo sola tampoco: el trigger escribe el título de
// la actividad, no su código. Ver la nota larga en `probar-laboratorio.mjs`.
const marca = async () => {
  const [r] = await d`select coalesce(max(id),0) as id
     from public.movimientos_puntos where matricula_id = ${m.matricula}`;
  return r.id;
};
let piso = await marca();
const limpiar = async () => {
  await d`delete from public.laboratorio_avance
           where matricula_id = ${m.matricula} and actividad_id = ${m.actividad}`;
  await d`delete from public.resultados_actividad
           where matricula_id = ${m.matricula} and actividad_id = ${m.actividad}`;
  await d`delete from public.movimientos_puntos
           where matricula_id = ${m.matricula}
             and (id > ${piso} or motivo = ${m.titulo})`;
};
await limpiar();
piso = await marca();

const perfil = await mkdtemp(join(tmpdir(), 'pulso-'));
const nav = await puppeteer.launch({ executablePath: chrome, headless: true,
  userDataDir: perfil, args: ['--no-first-run'] });
try {
  const p = await nav.newPage();
  await p.setViewport({ width: 1400, height: 1100 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));

  console.log(`Laboratorio ${CODIGO} en ${BASE}`);

  await p.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('input[type=email]');
  await p.type('input[type=email]', 'alumno.prueba@duocuc.cl');
  await p.type('input[type=password]', 'pulso-prueba-2026');
  await p.click('button[type=submit]');
  await p.waitForFunction(() => location.pathname !== '/ingresar', { timeout: 30000 });

  // ══════════ Llegar desde Actividades ══════════
  // Se entra por donde entra el alumno y no por la URL directa: si el enlace de
  // la tarjeta apuntara mal, escribir la dirección a mano lo taparía.
  console.log('\nLlegar');
  await p.goto(`${BASE}/actividades`, { waitUntil: 'networkidle2' });
  // Por el enlace y no por `.tarjeta`: la tarjeta de «Cargando…» también lleva
  // esa clase, así que esperarla devolvía una página todavía vacía.
  await p.waitForSelector('a[href*="/laboratorio/"]', { timeout: 30000 });
  const fueDesdeLaTarjeta = await p.evaluate((cod) => {
    const t = [...document.querySelectorAll('.tarjeta')]
      .find(x => x.textContent.includes(cod) || x.querySelector(`a[href*="${cod}"]`));
    const a = t?.querySelector('a[href*="/laboratorio/"]');
    if (!a) return false; a.click(); return true;
  }, CODIGO);
  rev('la tarjeta lleva al laboratorio', fueDesdeLaTarjeta, true);
  await p.waitForSelector('.caja textarea', { timeout: 30000 });
  rev('la dirección es /laboratorio/' + CODIGO,
    new URL(p.url()).pathname, `/laboratorio/${CODIGO}`);

  // ══════════ El enunciado se ve ══════════
  console.log('\nEl enunciado');
  const vista = await p.evaluate(() => {
    const enunciado = document.querySelector('.enunciado');
    return {
      cajas: document.querySelectorAll('.caja textarea').length,
      notas: document.querySelectorAll('.nota').length,
      controles: document.querySelectorAll('.control').length,
      // Que el Markdown se haya convertido: si llegara crudo no habría ni un h2.
      titulos: document.querySelectorAll('.enunciado h2').length > 0,
      codigo: document.querySelectorAll('.enunciado pre').length > 0,
      tablas: document.querySelectorAll('.enunciado table').length,
      listas: document.querySelectorAll('.enunciado ul, .enunciado ol').length,
      enlaces: document.querySelectorAll('.enunciado a').length,
      // Lo que se le queda pegado a un enunciado mal compilado. Se busca en el
      // texto que ve el alumno, no en el HTML: dentro de un <pre> el ::: puede
      // ser legítimo —hay laboratorios que enseñan esta misma sintaxis—.
      crudo: (() => {
        const c = enunciado.cloneNode(true);
        c.querySelectorAll('pre, code').forEach((x) => x.remove());
        return (c.textContent.match(/:::\S*/g) ?? []).slice(0, 5);
      })(),
      // Las clases y los formatos que el navegador de verdad supo dibujar: si
      // llegara uno que no conoce, la nota queda sin color y la caja de código
      // sin su textarea ancha, y nadie se entera.
      clases: [...new Set([...document.querySelectorAll('.nota')]
        .map((x) => [...x.classList].filter((c) => c !== 'nota').join('')))].sort(),
      anchas: document.querySelectorAll('.caja textarea.codigo').length,
    };
  });
  const [enBase] = await d`select cajas, controles, bloques from public.laboratorios
     where actividad_id = ${m.actividad}`;
  rev('tantas cajas como dice la base', vista.cajas, enBase.cajas);
  rev('tantos controles como dice la base', vista.controles, enBase.controles);
  rev('los avisos se dibujan', vista.notas > 0, true);
  rev('el Markdown quedó convertido', vista.titulos && vista.codigo, true);
  rev('las tablas y las listas también', vista.tablas > 0 && vista.listas > 0, true);
  // Condicional a propósito: no todo laboratorio tiene enlaces —L1 se reescribió
  // sin ninguno— y exigirlos siempre convierte una prueba en un ruido que se
  // aprende a ignorar. Lo que importa es que **si** el enunciado trae enlaces,
  // lleguen como enlaces y no como texto.
  const conEnlaces = JSON.stringify(enBase.bloques).includes('<a href');
  if (conEnlaces) rev('los enlaces quedaron enlaces', vista.enlaces > 0, true);
  else console.log('  · este enunciado no tiene enlaces, no hay nada que comprobar');
  // La falla que motivó todo esto: un marcador que el compilador no entendió se
  // va de paseo como prosa y se le imprime tal cual al alumno.
  rev('no hay ningún ::: escrito en la pantalla', vista.crudo, []);
  rev('las clases de aviso son las que el navegador conoce',
    vista.clases.filter((c) => !['alerta', 'pista', 'ojo'].includes(c)), []);
  rev('las cajas de código salen anchas', vista.anchas,
    enBase.bloques.filter((b) => b.tipo === 'caja' && b.formato === 'codigo').length);

  // Que el enunciado esté bien compilado no sirve de nada si se dibuja mal, y
  // eso ninguna prueba de las de arriba lo nota: las cajas se cuentan igual, el
  // guardado viaja igual, la consola no dice nada. Esto pasó de verdad —una
  // regla global de `.enunciado`, pensada para las preguntas de alternativa, le
  // ganaba a los estilos del componente y dejaba el laboratorio de costado— y
  // estuvo así desde que se publicó el primero.
  const ancho = await p.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: document.documentElement.clientWidth,
    enunciado: getComputedStyle(document.querySelector('.enunciado')).display,
  }));
  rev('el enunciado se apila hacia abajo, no de lado', ancho.enunciado, 'block');
  rev('la página no se desplaza de lado',
    ancho.documento <= ancho.ventana + 1 ? 'cabe' : `${ancho.documento}px en ${ancho.ventana}px`,
    'cabe');

  if (FOTO) {
    await p.screenshot({ path: FOTO, fullPage: true });
    console.log(`  · enunciado completo en ${FOTO}`);
  }

  // ══════════ Se guarda solo ══════════
  console.log('\nSe guarda solo');
  const primera = await p.evaluate(() =>
    document.querySelector('.caja textarea')?.getAttribute('aria-label'));
  await p.click('.caja textarea');
  await p.type('.caja textarea', 'Escrito desde el navegador', { delay: 12 });
  rev('avisa que hay algo sin guardar',
    await p.evaluate(() => document.body.textContent.includes('Sin guardar')), true);

  // Se espera **a que llegue**, no una cantidad fija de segundos.
  //
  // Antes eran cinco segundos secos: dos del temporizador más el viaje a São
  // Paulo. Alcanzaba casi siempre, y cuando no, la prueba decía que el guardado
  // automático estaba roto cuando lo único lento era la red. Una prueba que falla
  // por azar es peor que no tenerla: se aprende a ignorarla y el día que la falla
  // es de verdad, nadie la mira.
  const llave = primera?.replace('Respuesta ', '');
  let g1 = null;
  for (let i = 0; i < 30 && g1?.respuestas?.[llave] !== 'Escrito desde el navegador'; i++) {
    await pausa(1000);
    [g1] = await d`select respuestas from public.laboratorio_avance
       where matricula_id = ${m.matricula} and actividad_id = ${m.actividad}`;
  }
  rev('llegó a la base sin apretar nada', g1?.respuestas?.[llave], 'Escrito desde el navegador');
  rev('la pantalla dice guardado',
    await p.evaluate(() => document.body.textContent.includes('Guardado')), true);
  rev('la caja se marca como llena',
    await p.evaluate(() => document.querySelector('.caja')?.classList.contains('llena')), true);
  rev('el contador va en 1',
    await p.evaluate(() => /\b1 de \d+ respuestas/.test(document.body.textContent)), true);

  // ══════════ No se pierde lo último escrito ══════════
  // Escribir y salir de inmediato, antes de que corra el temporizador: es la
  // ventana donde de verdad se pierde texto.
  console.log('\nSalir con algo recién escrito');
  await p.evaluate(() => {
    const t = [...document.querySelectorAll('.caja textarea')][1];
    t.focus();
  });
  await p.keyboard.type('Justo antes de salir', { delay: 8 });
  await p.evaluate(() => {
    const a = [...document.querySelectorAll('.menu a')]
      .find(x => x.textContent.includes('Actividades'));
    a?.click();
  });
  await pausa(4000);
  const [g2] = await d`select respuestas from public.laboratorio_avance
     where matricula_id = ${m.matricula} and actividad_id = ${m.actividad}`;
  rev('lo alcanzó a guardar al salir',
    Object.values(g2?.respuestas ?? {}).includes('Justo antes de salir'), true);

  // ══════════ Vuelve como lo dejó ══════════
  console.log('\nVolver');
  await p.goto(`${BASE}/laboratorio/${CODIGO}`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.caja textarea');
  rev('recupera lo escrito',
    await p.evaluate(() => document.querySelector('.caja textarea')?.value),
    'Escrito desde el navegador');
  rev('el contador va en 2',
    await p.evaluate(() => /\b2 de \d+ respuestas/.test(document.body.textContent)), true);

  // ══════════ Punto de control ══════════
  console.log('\nPunto de control');
  const marco = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.control button')]
      .find(x => x.textContent.trim() === 'Llegué hasta acá');
    if (!b) return false; b.click(); return true;
  });
  rev('se puede marcar', marco, true);
  await pausa(2500);
  const [t1] = await d`select tramo from public.laboratorio_avance
     where matricula_id = ${m.matricula} and actividad_id = ${m.actividad}`;
  rev('el tramo quedó guardado', t1?.tramo >= 1, true);
  rev('la pantalla lo marca alcanzado',
    await p.evaluate(() => !!document.querySelector('.control.alcanzado')), true);

  // ══════════ La sugerencia por IA ══════════
  // Lo que se prueba acá no es que el modelo acierte —eso lo hace
  // `probar-revision.mjs`— sino que la sugerencia **no impida nada**: que aparezca
  // sin bloquear la caja, y que con una sugerencia puesta se pueda entregar igual.
  console.log('\nLa sugerencia por IA');
  const hayBoton = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.caja .sugerir button')]
      .find((x) => !x.disabled);
    if (!b) return false; b.click(); return true;
  });
  rev('hay un botón por caja y se puede apretar', hayBoton, true);

  if (hayBoton) {
    // El modelo se demora; y si no llega, tiene que quedar el aviso gris.
    const llego = await p.waitForFunction(
      () => !!document.querySelector('.caja .sugerencia, .caja .aviso.dato.chico'),
      { timeout: 60000 }).then(() => true).catch(() => false);
    rev('responde con una sugerencia o con un aviso, nunca en silencio', llego, true);

    const est = await p.evaluate(() => {
      const s = document.querySelector('.caja .sugerencia');
      return {
        hay: !!s,
        veredicto: s ? [...s.classList].find((c) => c !== 'sugerencia') : null,
        dice: s?.textContent?.includes('no cambia tus puntos') ?? false,
        // La garantía: la caja se sigue escribiendo y el botón de entregar sigue vivo.
        cajaEditable: ![...document.querySelectorAll('.caja textarea')].some((t) => t.disabled),
        puedeEntregar: [...document.querySelectorAll('button')]
          .some((x) => x.textContent.trim().startsWith('Entregar') && !x.disabled),
      };
    });
    if (est.hay) {
      rev('el veredicto es uno de los tres',
        ['logrado', 'parcial', 'incompleto'].includes(est.veredicto), true);
      rev('y dice que no cambia los puntos', est.dice, true);
    }
    rev('la caja sigue editable después de la sugerencia', est.cajaEditable, true);
    rev('y el botón de entregar sigue habilitado', est.puedeEntregar, true);
  }

  // ══════════ Entregar ══════════
  console.log('\nEntregar');
  const [{ p: antes }] = await d`select coalesce(sum(puntos),0)::int as p
     from public.movimientos_puntos where matricula_id = ${m.matricula}`;
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => x.textContent.trim() === 'Entregar laboratorio');
    b?.click();
  });
  await pausa(900);
  rev('pide confirmación',
    await p.evaluate(() => document.body.textContent.includes('¿Lo entregas así?')), true);
  rev('avisa cuántas quedan en blanco',
    await p.evaluate(() => /Te quedan\s+\d+/.test(document.body.textContent)), true);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => x.textContent.trim() === 'Sí, entregar');
    b?.click();
  });
  await pausa(5000);
  const [{ p: despues }] = await d`select coalesce(sum(puntos),0)::int as p
     from public.movimientos_puntos where matricula_id = ${m.matricula}`;
  const [act] = await d`select puntos from public.actividades where id = ${m.actividad}`;
  rev('pagó los puntos', despues - antes, act.puntos);
  rev('la pantalla lo confirma',
    await p.evaluate(() => document.body.textContent.includes('Ganaste')), true);
  rev('las cajas quedan bloqueadas',
    await p.evaluate(() => [...document.querySelectorAll('.caja textarea')].every(t => t.disabled)),
    true);
  rev('ya no hay botón de entregar',
    await p.evaluate(() => ![...document.querySelectorAll('button')]
      .some(x => x.textContent.trim().startsWith('Entregar'))), true);

  // ══════════ Aparece completada ══════════
  await p.goto(`${BASE}/actividades`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('a[href*="/laboratorio/"]', { timeout: 30000 });
  rev('sale como completada en Actividades', await p.evaluate((cod) => {
    const t = [...document.querySelectorAll('.tarjeta')]
      .find(x => x.querySelector(`a[href*="${cod}"]`));
    return !!t && t.textContent.includes('Completada');
  }, CODIGO), true);

  rev('sin errores en consola', errs, []);
} finally {
  await nav.close();
  await rm(perfil, { recursive: true, force: true });
  await limpiar();
}

console.log(f === 0 ? '\nTodo bien.' : `\n${f} fallos.`);
process.exit(f === 0 ? 0 : 1);
