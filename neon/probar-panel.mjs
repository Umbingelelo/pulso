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

const BASE = process.argv[2] ?? 'https://pulso-rust.vercel.app';
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
const clic = (p, txt) => p.evaluate(t => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t);
  if (!b || b.disabled) return false; b.click(); return true; }, txt);

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
  await p.type('input[type=password]', 'pulso-docente-2026');
  await p.click('button[type=submit]');
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => [...document.querySelectorAll('.menu a span')]
        .some(s => s.textContent.trim() === 'Alumnos'))) break;
    await pausa(500); }

  // ══════════ Actividades ══════════
  console.log('Actividades');
  await d`delete from public.actividades where codigo like 'TEST-%'`;
  await p.goto(`${BASE}/curso/actividades`, { waitUntil: 'networkidle2' });
  await espera(p, '.tarjeta');
  await clic(p, 'Crear una');
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

  rev('sin errores de JavaScript', errs, []);
} finally { await nav.close(); await rm(perfil, { recursive: true, force: true }); }
console.log(f === 0 ? '\nTodas las operaciones del panel funcionan.' : `\n${f} fallaron.`);
process.exit(f === 0 ? 0 : 1);
