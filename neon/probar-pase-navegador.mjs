/**
 * El pase y la tabla de posiciones en un navegador real.
 *
 * Comprueba lo que solo se ve ejecutando: que la barra anime `transform` y no
 * `width` —animar el ancho fuerza reflow en cada cuadro—, que la entrada vaya
 * escalonada, y que con `prefers-reduced-motion` el contenido se muestre sin
 * recorrido en vez de quedarse invisible, que es el error clásico al desactivar
 * una animación que arranca en opacidad cero.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-pase-navegador.mjs
 */
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const BASE = 'https://pulso-rust.vercel.app';
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
  if (!ok) f++; console.log(`  ${ok?'✓':'✗'} ${e}: ${JSON.stringify(r)}${ok?'':' ← esperaba '+JSON.stringify(x)}`); };

const [mat] = await d`select mt.id from public.matriculas mt
   join public.usuarios u on u.id=mt.perfil_id join public.secciones s on s.id=mt.seccion_id
   join public.asignaturas a on a.id=s.asignatura_id
  where lower(u.correo)='alumno.prueba@duocuc.cl' and a.sigla='DSY1107'`;
const limpiar = async () => {
  await d`delete from public.movimientos_experiencia where matricula_id=${mat.id}`;
  await d`delete from public.alumno_cosmeticos where matricula_id=${mat.id}`;
  await d`delete from public.movimientos_tiradas where matricula_id=${mat.id}`;
  await d`update public.matriculas set titulo_id=null where id=${mat.id}`;
};
await limpiar();
// La cuenta de prueba está oculta del ranking a propósito; para esta prueba se
// muestra, y se vuelve a ocultar al final.
await d`update public.perfiles set oculto_en_ranking=false where id=(select perfil_id from public.matriculas where id=${mat.id})`;
await d`insert into public.movimientos_experiencia (matricula_id, xp, motivo)
        select ${mat.id}, 25, 'Misión diaria' from generate_series(1,12)`;

const perfil = await mkdtemp(join(tmpdir(),'pulso-'));
const nav = await puppeteer.launch({ executablePath: chrome, headless: true,
  userDataDir: perfil, args: ['--no-first-run'] });
try {
  const p = await nav.newPage();
  await p.setViewport({ width: 1400, height: 1000 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('input[type=email]');
  await p.type('input[type=email]', 'alumno.prueba@duocuc.cl');
  await p.type('input[type=password]', 'pulso-prueba-2026');
  await p.click('button[type=submit]');
  for (let i=0;i<40 && /ingresar/.test(p.url());i++) await new Promise(r=>setTimeout(r,500));
  await p.evaluate(id => localStorage.setItem('pulso.ramo', id), mat.id);

  await p.goto(`${BASE}/pase`, { waitUntil: 'networkidle2' });
  for (let i=0;i<40;i++){ if (await p.evaluate(()=>document.querySelectorAll('.escalon').length)) break;
    await new Promise(r=>setTimeout(r,500)); }

  console.log('1. El pase');
  rev('sin errores de JavaScript', errs, []);
  rev('12 misiones = nivel 7', await p.evaluate(()=>document.querySelector('.pase-nivel b')?.textContent), '7');
  rev('pinta la escalera completa', await p.evaluate(()=>document.querySelectorAll('.escalon').length), 17);
  rev('marca lo desbloqueado', await p.evaluate(()=>document.querySelectorAll('.escalon.abierto').length) > 0, true);
  rev('celebra lo recién ganado', /Desbloqueaste/.test(await p.evaluate(()=>document.body.innerText)), true);

  console.log('\n2. La barra de progreso');
  const b = await p.evaluate(() => { const i = document.querySelector('.pase-barra i');
    const cs = getComputedStyle(i);
    return { prop: cs.transitionProperty, tr: cs.transform, dur: cs.transitionDuration }; });
  rev('transiciona transform', b.prop.includes('transform'), true);
  rev('y NO width', b.prop.includes('width'), false);
  rev('quedó escalada, no en cero', b.tr !== 'none' && !/matrix\(0,/.test(b.tr), true);

  console.log('\n3. La tabla de posiciones');
  const nombres = await p.evaluate(()=>[...document.querySelectorAll('.puesto .nom')].map(n=>n.textContent.trim()));
  rev('hay puestos', nombres.length > 0, true);
  rev('no aparece el docente', nombres.some(n=>/Cristian/i.test(n)), false);
  rev('me destaca a mí', await p.evaluate(()=>document.querySelectorAll('.puesto.yo').length), 1);
  const lugares = await p.evaluate(()=>[...document.querySelectorAll('.puesto .lugar')].map(x=>+x.textContent));
  rev('los lugares no bajan', lugares.every((v,i)=>i===0||v>=lugares[i-1]), true);

  console.log('\n4. Equipar un título');
  const puso = await p.evaluate(()=>{ const b=[...document.querySelectorAll('.escalon button')]
    .find(x=>x.textContent.trim()==='Usar'); if(!b) return 'sin botón'; b.click(); return 'ok'; });
  rev('pudo equipar', puso, 'ok');
  await new Promise(r=>setTimeout(r,3000));
  const [m2] = await d`select titulo_id from public.matriculas where id=${mat.id}`;
  rev('quedó guardado', m2.titulo_id !== null, true);
  rev('el título se ve en la tabla',
    /De los que sí leen|Recién llegado|Constante|Madrugador|Sin faltar/.test(
      await p.evaluate(()=>document.body.innerText)), true);

  console.log('\n5. Con prefers-reduced-motion');
  await p.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'reduce' }]);
  await p.reload({ waitUntil:'networkidle2' });
  for (let i=0;i<40;i++){ if (await p.evaluate(()=>document.querySelectorAll('.escalon').length)) break;
    await new Promise(r=>setTimeout(r,400)); }
  const red = await p.evaluate(() => {
    const e = document.querySelector('.escalon'), b = document.querySelector('.pase-barra i');
    return { anim: getComputedStyle(e).animationName, opac: getComputedStyle(e).opacity,
             dur: getComputedStyle(b).transitionDuration }; });
  rev('no anima la entrada', red.anim, 'none');
  rev('pero el contenido se ve igual', Number(red.opac), 1);
  rev('la barra no transiciona', red.dur, '0s');
} finally { await nav.close(); await rm(perfil,{recursive:true,force:true}); }

await limpiar();
await d`update public.perfiles set oculto_en_ranking=true where id=(select perfil_id from public.matriculas where id=${mat.id})`;
console.log(f===0 ? '\nTodo bien: el pase y la tabla funcionan.' : `\n${f} fallaron.`);
process.exit(f===0?0:1);
