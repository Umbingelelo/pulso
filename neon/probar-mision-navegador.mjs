/**
 * La misión del día en un navegador real: apretar el botón, elegir y responder.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-mision-navegador.mjs
 */
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const BASE = 'https://pulso-rust.vercel.app';
const CANDIDATOS = [process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'].filter(Boolean);
let chrome = null;
for (const c of CANDIDATOS) { try { await access(c); chrome = c; break; } catch {} }
if (!chrome) { console.error('No encontré Chrome'); process.exit(2); }
const puppeteer = (await import('puppeteer-core')).default;

const d = neon(process.env.DATABASE_URL_OWNER);
let f = 0;
const rev = (e, r, x) => { const ok = JSON.stringify(r) === JSON.stringify(x);
  if (!ok) f++; console.log(`  ${ok?'✓':'✗'} ${e}: ${JSON.stringify(r)}${ok?'':' ← esperaba '+JSON.stringify(x)}`); };

const [mat] = await d`select mt.id from public.matriculas mt
   join public.usuarios u on u.id=mt.perfil_id
   join public.secciones s on s.id=mt.seccion_id
   join public.asignaturas a on a.id=s.asignatura_id
  where lower(u.correo)='alumno.prueba@duocuc.cl' and a.sigla='DSY1107'`;
await d`delete from public.misiones where matricula_id=${mat.id}`;
await d`delete from public.movimientos_experiencia where matricula_id=${mat.id}`;

const perfil = await mkdtemp(join(tmpdir(), 'pulso-'));
const nav = await puppeteer.launch({ executablePath: chrome, headless: true,
  userDataDir: perfil, args: ['--no-first-run'] });
try {
  const p = await nav.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));

  await p.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('input[type=email]');
  await p.type('input[type=email]', 'alumno.prueba@duocuc.cl');
  await p.type('input[type=password]', 'pulso-prueba-2026');
  await p.click('button[type=submit]');
  for (let i=0;i<40 && /ingresar/.test(p.url());i++) await new Promise(r=>setTimeout(r,500));
  await p.evaluate((id) => localStorage.setItem('pulso.ramo', id), mat.id);

  console.log('1. La pantalla');
  await p.goto(`${BASE}/misiones`, { waitUntil: 'networkidle2' });
  let txt = '';
  for (let i=0;i<40;i++){ txt = await p.evaluate(()=>document.body.innerText);
    if (/Generar mi misión|Ya hiciste/.test(txt)) break; await new Promise(r=>setTimeout(r,500)); }
  rev('ofrece generar', /Generar mi misión/.test(txt), true);
  rev('sin errores de JavaScript', errs, []);

  console.log('\n2. Apretar el botón');
  const t0 = Date.now();
  await p.evaluate(()=>[...document.querySelectorAll('button')]
    .find(b=>b.textContent.trim()==='Generar mi misión')?.click());
  let ops = 0;
  for (let i=0;i<90;i++){ ops = await p.evaluate(()=>document.querySelectorAll('.opcion-mision').length);
    if (ops) break; await new Promise(r=>setTimeout(r,1000)); }
  console.log(`   tardó ${((Date.now()-t0)/1000).toFixed(1)}s`);
  rev('aparecieron las cuatro alternativas', ops, 4);
  rev('sin errores de JavaScript', errs, []);
  const preg = await p.evaluate(()=>document.querySelector('h2')?.textContent?.trim());
  console.log(`   ${preg}`);

  console.log('\n3. Elegir y responder');
  const [sol] = await d`select m.solucion from public.misiones m
     where m.matricula_id=${mat.id} and m.fecha = public.dia_mision()`;
  const i = Number(sol.solucion.correcta);
  await p.evaluate((k)=>document.querySelectorAll('.opcion-mision')[k].click(), i);
  rev('queda marcada', await p.evaluate((k)=>document.querySelectorAll('.opcion-mision')[k].classList.contains('elegida'), i), true);
  await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Responder')?.click());
  for (let j=0;j<40;j++){ if (await p.evaluate(()=>!!document.querySelector('.opcion-mision.correcta'))) break;
    await new Promise(r=>setTimeout(r,500)); }
  rev('se pinta la correcta', await p.evaluate(()=>!!document.querySelector('.opcion-mision.correcta')), true);
  const fin = await p.evaluate(()=>document.body.innerText);
  rev('avisa la experiencia ganada', /\+25 de experiencia/.test(fin), true);
  rev('muestra la explicación', /aviso/.test(await p.evaluate(()=>document.querySelector('.aviso')?.className ?? '')), true);
  rev('sin errores de JavaScript', errs, []);

  console.log('\n4. Al recargar sigue resuelta');
  await p.reload({ waitUntil: 'networkidle2' });
  for (let j=0;j<40;j++){ if (await p.evaluate(()=>document.querySelectorAll('.opcion-mision').length)) break;
    await new Promise(r=>setTimeout(r,500)); }
  rev('no ofrece generar otra',
    /Generar mi misión/.test(await p.evaluate(()=>document.body.innerText)), false);

  const [xp] = await d`select coalesce(sum(xp),0)::int x from public.movimientos_experiencia where matricula_id=${mat.id}`;
  rev('experiencia en la base', xp.x, 25);
} finally { await nav.close(); await rm(perfil,{recursive:true,force:true}); }

await d`delete from public.misiones where matricula_id=${mat.id}`;
await d`delete from public.movimientos_experiencia where matricula_id=${mat.id}`;
console.log(f===0 ? '\nTodo bien en el navegador.' : `\n${f} fallaron.`);
process.exit(f===0?0:1);
