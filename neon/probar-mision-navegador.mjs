/**
 * La misión del día en un navegador real: apretar el botón, elegir y responder.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-mision-navegador.mjs
 */
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const BASE = process.env.BASE ?? 'https://pulso-rust.vercel.app';
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

  /**
   * Lo corregido tiene que quedarse quieto.
   *
   * `responder()` refresca el perfil al terminar —el encabezado muestra el saldo—
   * y ese refresco reescribe la señal del ramo. Si la pantalla está reaccionando
   * al **objeto** del ramo y no a su matrícula, el refresco parece un cambio de
   * ramo, la misión se vuelve a leer del servidor y la corrección se pierde: la
   * alternativa que acababa de pintarse verde pasa a roja y la insignia baja a
   * «+0 de experiencia», aunque en la base la experiencia sí se abonó.
   *
   * Por eso se mira **después** de que el refresco alcanzó a volver, y no en el
   * instante siguiente al clic: en ese instante todavía está bien.
   */
  console.log('\n4. La corrección aguanta el refresco del perfil');
  await new Promise(r => setTimeout(r, 4000));
  const tras = await p.evaluate((k) => {
    const ops = [...document.querySelectorAll('.opcion-mision')];
    return {
      verde: ops.filter(o => o.classList.contains('correcta')).length,
      elegidaEnRojo: ops[k].classList.contains('incorrecta'),
      texto: document.body.innerText,
      explicacion: (document.querySelector('.aviso')?.textContent ?? '').trim().length > 0,
    };
  }, i);
  rev('la correcta sigue en verde', tras.verde, 1);
  rev('la que eligió no se pinta de roja', tras.elegidaEnRojo, false);
  rev('sigue avisando la experiencia ganada', /\+25 de experiencia/.test(tras.texto), true);
  rev('sigue mostrando la explicación', tras.explicacion, true);
  rev('sin errores de JavaScript', errs, []);

  /**
   * Al recargar, la corrección tiene que seguir ahí.
   *
   * `mi_mision` baja la pauta de una misión ya respondida desde la 0033. Antes no,
   * y el alumno que recargaba la página se quedaba con la insignia, un recuadro de
   * color en blanco y ninguna alternativa marcada: la corrección que acababa de
   * leer desaparecía sin que nada avisara.
   */
  console.log('\n5. Al recargar sigue resuelta, y con su pauta');
  await p.reload({ waitUntil: 'networkidle2' });
  for (let j=0;j<40;j++){ if (await p.evaluate(()=>document.querySelectorAll('.opcion-mision').length)) break;
    await new Promise(r=>setTimeout(r,500)); }
  await new Promise(r=>setTimeout(r,1500));
  const recargada = await p.evaluate(() => ({
    verde: document.querySelectorAll('.opcion-mision.correcta').length,
    roja: document.querySelectorAll('.opcion-mision.incorrecta').length,
    explicacion: (document.querySelector('.aviso')?.textContent ?? '').trim().length > 0,
    texto: document.body.innerText,
  }));
  rev('no ofrece generar otra', /Generar mi misión/.test(recargada.texto), false);
  rev('marca cuál era la correcta', recargada.verde, 1);
  rev('no marca ninguna como equivocada', recargada.roja, 0);
  rev('vuelve a mostrar la explicación', recargada.explicacion, true);
  rev('sigue diciendo la experiencia ganada', /\+25 de experiencia/.test(recargada.texto), true);
  rev('sin errores de JavaScript', errs, []);

  const [xp] = await d`select coalesce(sum(xp),0)::int x from public.movimientos_experiencia where matricula_id=${mat.id}`;
  rev('experiencia en la base', xp.x, 25);
} finally { await nav.close(); await rm(perfil,{recursive:true,force:true}); }

await d`delete from public.misiones where matricula_id=${mat.id}`;
await d`delete from public.movimientos_experiencia where matricula_id=${mat.id}`;
console.log(f===0 ? '\nTodo bien en el navegador.' : `\n${f} fallaron.`);
process.exit(f===0?0:1);
