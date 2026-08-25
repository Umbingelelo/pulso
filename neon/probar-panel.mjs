/**
 * Cada operación del panel del docente, ejecutada de verdad y comprobada en la base.
 *
 * No basta con que el botón exista: la primera versión tenía todos los botones y
 * ninguno guardaba, porque los filtros eran propiedades y no señales. Acá cada
 * caso hace clic, espera, y va a mirar la fila en Postgres.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-panel.mjs [https://…]
 */
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const BASE = process.argv.find(a => a.startsWith('http')) ?? 'https://pulso-rust.vercel.app';
/**
 * La clave del docente **no** está en el código.
 *
 * Estuvo, y por eso esta prueba llevaba días fallando sin decir por qué: la clave
 * cambió, el `for` de abajo se rendía a los 20 segundos **sin fallar**, y la prueba
 * seguía corriendo sobre la pantalla de ingreso. El único síntoma era un «no abre
 * el formulario» que parecía un bug del panel.
 *
 *   PANEL_CLAVE='…' node neon/probar-panel.mjs
 */
const CLAVE = process.env.PANEL_CLAVE ?? '';
if (!CLAVE) {
  console.error('Falta la clave del docente:\n');
  console.error("  PANEL_CLAVE='…' node neon/probar-panel.mjs\n");
  process.exit(2);
}
let chrome = null;
for (const c of [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                 '/usr/bin/google-chrome'].filter(Boolean)) { try { await access(c); chrome = c; break; } catch {} }
if (!chrome) { console.error('No encontré Chrome'); process.exit(2); }
const puppeteer = (await import('puppeteer-core')).default;

const d = neon(process.env.DATABASE_URL_OWNER);
let f = 0;
const rev = (e, r, x) => { const ok = JSON.stringify(r) === JSON.stringify(x);
  if (!ok) f++; console.log(`  ${ok?'✓':'✗'} ${e}: ${JSON.stringify(r)}${ok?'':' ← esperaba '+JSON.stringify(x)}`); };

/**
 * Escribe como una persona: clic, borrar y teclear.
 *
 * Con eventos sintéticos —`dispatchEvent(new Event('input'))`— `ngModel` no
 * siempre se entera, y la prueba falla sin que el producto falle. Peor todavía:
 * en la primera versión eso hizo que los clics siguientes cayeran en la fila
 * equivocada y la prueba **editó el diagnóstico real** creyendo que tocaba su
 * propia actividad.
 */
async function escribir(p, sel, v) {
  await p.click(sel);
  await p.evaluate((s) => { const el = document.querySelector(s); el.select?.(); }, sel);
  await p.keyboard.press('Backspace');
  await p.type(sel, String(v), { delay: 15 });
}
/**
 * Clic en un botón por su texto, **esperando a que exista**.
 *
 * Antes no esperaba, y ahí estaba la carrera que hacía fallar «abre el
 * formulario»: la prueba esperaba un `.tarjeta` —que también es la tarjeta de
 * «Cargando…»— y apretaba «Crear una» antes de que el botón existiera. El clic
 * devolvía `false`, nadie lo miraba, y el fallo aparecía una línea más abajo como
 * si el formulario estuviera roto. El formulario estaba perfecto.
 *
 * Devuelve `false` solo si el botón no apareció nunca o está deshabilitado, y
 * quien llama **tiene que mirarlo**.
 */
const clic = async (p, txt) => {
  for (let i = 0; i < 40; i++) {
    const listo = await p.evaluate(t => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t);
      if (!b || b.disabled) return false; b.click(); return true; }, txt);
    if (listo) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};

/**
 * Clic en el botón de UNA fila concreta, buscada por su texto.
 *
 * `clic('Editar')` toma el primer botón del documento, que es el de la primera
 * fila de la tabla. Así fue como esta prueba editó el diagnóstico de DSY1107
 * —le puso «Título editado» y 250 puntos— en vez de su propia actividad.
 */
const clicEnFila = (p, contiene, txt) => p.evaluate((c, t) => {
  const fila = [...document.querySelectorAll('tr')].find(x => x.textContent.includes(c));
  if (!fila) return false;
  const b = [...fila.querySelectorAll('button')].find(x => x.textContent.trim() === t);
  if (!b || b.disabled) return false; b.click(); return true; }, contiene, txt);
const espera = async (p, sel) => { for (let i = 0; i < 40; i++) {
  if (await p.evaluate(s => !!document.querySelector(s), sel)) return true;
  await new Promise(r => setTimeout(r, 500)); } return false; };
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

const perfil = await mkdtemp(join(tmpdir(), 'pulso-'));
const nav = await puppeteer.launch({ executablePath: chrome, headless: true,
  userDataDir: perfil, args: ['--no-first-run'] });
try {
  const p = await nav.newPage(); await p.setViewport({ width: 1500, height: 1200 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('input[type=email]');
  await p.type('input[type=email]', 'cr.calderons@profesor.duoc.cl');
  await p.type('input[type=password]', CLAVE);
  await p.click('button[type=submit]');
  // Y si no entra, **se detiene acá**. Seguir con la sesión cerrada convierte
  // cualquier comprobación de abajo en un falso negativo sobre el producto.
  let dentro = false;
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => [...document.querySelectorAll('.menu a span')]
        .some(s => s.textContent.trim() === 'Alumnos'))) { dentro = true; break; }
    await pausa(500); }
  if (!dentro) {
    console.error('No entró al panel: revisa PANEL_CLAVE. No sigo, porque todo lo');
    console.error('que viene fallaría por la sesión y no por el panel.');
    process.exit(1);
  }
  console.log('Sesión de docente abierta');

  // ══════════ Actividades ══════════
  console.log('Actividades');
  await d`delete from public.actividades where codigo like 'TEST-%'`;
  await p.goto(`${BASE}/curso/actividades`, { waitUntil: 'networkidle2' });
  await espera(p, '.tarjeta');
  rev('el botón de crear aparece', await clic(p, 'Crear una'), true);
  rev('abre el formulario', await espera(p, 'input[name=codigo]'), true);
  await escribir(p, 'input[name=codigo]', 'TEST-1');
  await escribir(p, 'input[name=titulo]', 'Laboratorio de prueba');
  await pausa(300);
  await clic(p, 'Guardar'); await pausa(2500);
  const [c1] = await d`select titulo, puntos, tipo from public.actividades where codigo='TEST-1'`;
  rev('crear', c1 ? `${c1.tipo}/${c1.titulo}/${c1.puntos}` : 'no', 'laboratorio/Laboratorio de prueba/100');

  await clicEnFila(p, 'TEST-1', 'Editar'); await espera(p, 'input[name=titulo]'); await pausa(300);
  await escribir(p, 'input[name=titulo]', 'Título editado');
  await escribir(p, 'input[name=puntos]', '250');
  await pausa(300);
  await clic(p, 'Guardar'); await pausa(2500);
  const [c2] = await d`select titulo, puntos from public.actividades where codigo='TEST-1'`;
  rev('editar', c2 ? `${c2.titulo}/${c2.puntos}` : 'no', 'Título editado/250');

  await clicEnFila(p, 'TEST-1', 'Editar'); await espera(p, 'input[name=activa]'); await pausa(300);
  await p.evaluate(() => document.querySelector('input[name=activa]').click());
  await pausa(300);
  await clic(p, 'Guardar'); await pausa(2500);
  const [c3] = await d`select activa from public.actividades where codigo='TEST-1'`;
  rev('ocultar', c3?.activa, false);
  await d`delete from public.actividades where codigo like 'TEST-%'`;

  // ══════════ Clases ══════════
  console.log('\nClases');
  const [cl] = await d`select c.id, c.puntos_abrir, c.ventana_hasta from public.clases c
     join public.asignaturas a on a.id=c.asignatura_id where a.sigla='DSY1107' and c.codigo='D7'`;
  await p.goto(`${BASE}/curso/clases`, { waitUntil: 'networkidle2' });
  await espera(p, 'table tr');
  await clicEnFila(p, 'D7', 'Programar');
  rev('abre el formulario de D7', await espera(p, 'input[name=fAbrir]'), true);
  await pausa(300);
  await escribir(p, 'input[name=fAbrir]', '33');
  await pausa(300);
  await clic(p, 'Guardar'); await pausa(2500);
  const [cl2] = await d`select puntos_abrir from public.clases where id=${cl.id}`;
  rev('editar puntos', cl2.puntos_abrir, 33);
  await d`update public.clases set puntos_abrir=${cl.puntos_abrir} where id=${cl.id}`;

  // ══════════ Alumnos ══════════
  console.log('\nAlumnos');
  const [al] = await d`select mt.id, mt.seccion_id from public.matriculas mt
     join public.usuarios u on u.id=mt.perfil_id join public.secciones s on s.id=mt.seccion_id
     join public.asignaturas a on a.id=s.asignatura_id
    where a.sigla='DSY1107' and lower(u.correo)='alumno.prueba@duocuc.cl'`;
  const [otra] = await d`select s.id, s.codigo from public.secciones s
     join public.asignaturas a on a.id=s.asignatura_id
    where a.sigla='DSY1107' and s.id <> ${al.seccion_id} limit 1`;

  const abrirAlumno = async () => {
    await p.goto(`${BASE}/curso/alumnos`, { waitUntil: 'networkidle2' });
    await espera(p, 'table tr');
    await escribir(p, 'input[name=busca]', 'alumno.prueba');
    await pausa(700);
    const n = await p.evaluate(() => document.querySelectorAll('table tr').length);
    await clicEnFila(p, 'alumno.prueba', 'Editar');
    await espera(p, 'select[name=sec]'); await pausa(300);
    return n;
  };
  rev('el buscador filtra', await abrirAlumno(), 2);

  await p.evaluate(id => { const s = document.querySelector('select[name=sec]');
    const set = Object.getOwnPropertyDescriptor(s.constructor.prototype, 'value').set;
    set.call(s, id); s.dispatchEvent(new Event('change', { bubbles: true })); }, otra.id);
  await pausa(400);
  await clic(p, 'Mover'); await pausa(2500);
  const [m1] = await d`select seccion_id from public.matriculas where id=${al.id}`;
  rev('mover de sección', m1.seccion_id === otra.id, true);
  await d`update public.matriculas set seccion_id=${al.seccion_id} where id=${al.id}`;

  await abrirAlumno();
  await escribir(p, 'input[name=clave]', 'clavenueva123');
  await pausa(300);
  await clic(p, 'Cambiar'); await pausa(2500);
  const [ok] = await d`select public.autenticar('alumno.prueba@duocuc.cl','clavenueva123') as id`;
  rev('cambiar la contraseña', ok.id !== null, true);
  await d`update public.usuarios set clave_hash = crypt('pulso-prueba-2026', gen_salt('bf'))
           where correo='alumno.prueba@duocuc.cl'`;

  await abrirAlumno();
  await clic(p, 'Dar de baja'); await pausa(2500);
  const [b1] = await d`select activa from public.matriculas where id=${al.id}`;
  rev('dar de baja', b1.activa, false);
  await clic(p, 'Reactivar'); await pausa(2500);
  const [b2] = await d`select activa from public.matriculas where id=${al.id}`;
  rev('reactivar', b2.activa, true);
  await d`update public.matriculas set activa=true where id=${al.id}`;

  // ══════════ El ramo y la sección mandan en las cuatro pantallas ══════════
  //
  // Esta sección existe por la queja concreta: «no me salen todos los alumnos» y
  // «cuando cambio de sección no funciona bien». No era el dato —la base devolvía
  // los 71— sino que las pantallas leían el ramo **una vez al construirse** y no
  // volvían a mirar, y «Resumen» tenía además su propio selector desconectado del
  // de la barra. Cambiar el selector dejaba la tabla con los alumnos del ramo
  // anterior, sin ningún error a la vista.
  //
  // Lo que se vigila: que estén todos, que cambiar de ramo **sin navegar** recargue
  // la tabla, y que la sección elegida valga en las cuatro pantallas.

  console.log('\nEl ramo y la sección');

  const cuenta = async () => p.evaluate(() => document.querySelectorAll('table tr').length - 1);
  const secciones = await d`
    select s.codigo, count(*)::int as n
      from public.secciones s
      join public.asignaturas a on a.id = s.asignatura_id
      join public.periodos p on p.id = s.periodo_id
      join public.matriculas mt on mt.seccion_id = s.id
     where a.sigla = 'DSY1107' and p.codigo = '2026-2'
     group by s.codigo order by s.codigo`;
  const totalDsy = secciones.reduce((n, x) => n + x.n, 0);

  const elegirRamo = (sigla) => p.evaluate((sg) => {
    const sel = [...document.querySelectorAll('select')].find(s =>
      [...s.options].some(o => o.textContent.includes(sg)));
    if (!sel) return false;
    sel.value = [...sel.options].find(o => o.textContent.includes(sg)).value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, sigla);

  // Se parte en «Todas» para que la cuenta sea la del ramo entero.
  await p.goto(`${BASE}/curso/alumnos`, { waitUntil: 'networkidle2' });
  await espera(p, 'table tr');
  await clic(p, `Todas · ${totalDsy}`); await pausa(1200);
  rev('salen todos los alumnos del ramo', await cuenta(), totalDsy);

  // Una sección: la tabla se acota, y sin recargar la página.
  const una = secciones[0];
  await clic(p, `${una.codigo} · ${una.n}`); await pausa(1200);
  rev(`al elegir la sección ${una.codigo} quedan sus ${una.n}`, await cuenta(), una.n);

  // El desplegable de la barra tiene que **reflejar** la sección elegida.
  //
  // Con un [value] sobre el select se quedaba en «Todas» aunque el store tuviera
  // otra puesta: las opciones llegan después que el valor. Eso se ve exactamente
  // como «cambio de sección y no pasa nada», así que se vigila.
  rev('el desplegable de la barra muestra la sección elegida',
    await p.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find(s =>
        [...s.options].some(o => o.textContent.trim().startsWith('Todas ·')));
      return sel?.options[sel.selectedIndex]?.textContent?.trim() ?? null;
    }), `${una.codigo} · ${una.n}`);

  // Y la elección vale en «Resumen», que es la que no obedecía.
  //
  // Se comprueba contra la cifra grande de la tarjeta y **no** contando filas:
  // esa pantalla tiene cuatro tablas —reunión, diagnóstico, canjes y nómina— y
  // sumarlas todas no dice nada. La cifra es justamente el número que antes no
  // correspondía a la tabla de abajo.
  await p.goto(`${BASE}/curso`, { waitUntil: 'networkidle2' });
  /**
   * La cifra, **después** de que la pantalla termine de cargar.
   *
   * Sin esperar a que «Cargando…» desaparezca, la primera lectura devuelve 0
   * —la nómina todavía está vacía— y como 0 no es null, el bucle se quedaba con
   * ese valor y reportaba un fallo que no existía.
   */
  const cifraAlumnos = async () => {
    for (let i = 0; i < 60; i++) {
      const cargando = await p.evaluate(() => document.body.innerText.includes('Cargando'));
      if (cargando) { await pausa(500); continue; }
      const n = await p.evaluate(() => {
        // `textContent` y no `innerText`: la etiqueta lleva `text-transform:
        // uppercase`, así que `innerText` devuelve «ALUMNOS MATRICULADOS» y una
        // comparación con el texto del código no calza nunca.
        const t = [...document.querySelectorAll('.tarjeta')].find(x =>
          /alumnos (en la sección|matriculados)/i.test(x.textContent ?? ''));
        const c = t?.querySelector('.cifra');
        return c ? Number(c.textContent.trim()) : null;
      });
      if (n !== null) return n;
      await pausa(500);
    }
    return null;
  };
  rev('la sección elegida vale también en Resumen', await cifraAlumnos(), una.n);

  // Cambiar de ramo desde la barra, **sin navegar**, tiene que recargar la tabla.
  await p.goto(`${BASE}/curso/alumnos`, { waitUntil: 'networkidle2' });
  await espera(p, 'table tr');
  const [{ n: totalIty }] = await d`
    select count(*)::int as n from public.matriculas mt
      join public.secciones s on s.id = mt.seccion_id
      join public.asignaturas a on a.id = s.asignatura_id
      join public.periodos p on p.id = s.periodo_id
     where a.sigla = 'ITY1102' and p.codigo = '2026-2'`;
  rev('el selector de ramo está en la barra', await elegirRamo('ITY1102'), true);
  await pausa(2500);
  rev('cambiar de ramo sin navegar recarga la nómina', await cuenta(), totalIty);
  rev('y la sección del ramo anterior no queda pegada',
    await p.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find(s =>
        [...s.options].some(o => o.textContent.startsWith('Todas ·')));
      return sel ? sel.value === '' : true;
    }), true);

  // De vuelta, para no dejarle el panel en el otro ramo.
  await elegirRamo('DSY1107'); await pausa(2000);
  await clic(p, `Todas · ${totalDsy}`); await pausa(1200);
  rev('volver al ramo de antes lo deja completo', await cuenta(), totalDsy);

  rev('sin errores de JavaScript', errs, []);
} finally { await nav.close(); await rm(perfil, { recursive: true, force: true }); }
console.log(f === 0 ? '\nTodas las operaciones del panel funcionan.' : `\n${f} fallaron.`);
process.exit(f === 0 ? 0 : 1);
