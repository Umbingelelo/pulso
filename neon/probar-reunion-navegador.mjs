/**
 * El modo reunión en un navegador de verdad, con el alumno de prueba.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-reunion-navegador.mjs https://…vercel.app
 *
 * `probar-reunion.mjs` ya cubre la lógica y el cobro. Esto cubre lo único que
 * aquella no puede: que el alumno **lo vea**. Un descuento que se cobra pero no se
 * muestra no compensa nada, y un aviso que no aparece en la barra no avisa.
 *
 * La reunión se enciende y se apaga desde la base con la identidad del docente
 * —las mismas funciones que llama el botón del panel— porque acá no tenemos su
 * contraseña. Lo que se prueba en el navegador es la mitad del alumno, que es la
 * que tiene pantalla.
 *
 * Va contra la URL directa del despliegue y no contra el dominio: demasiadas
 * sesiones sin cabeza seguidas hacen que la protección de Vercel bloquee la IP de
 * casa, y esa ya nos pasó.
 */
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const BASE = process.argv[2] ?? 'https://pulso-rust.vercel.app';
const CORREO = 'alumno.prueba@duocuc.cl';
const CLAVE = 'pulso-prueba-2026';
const CORREO_DOCENTE = 'cr.calderons@profesor.duoc.cl';
const DESCUENTO = 30;

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

const [docente] = await d`select id from public.usuarios where lower(correo) = ${CORREO_DOCENTE}`;
if (!docente) throw new Error(`No existe ${CORREO_DOCENTE}`);

const [m] = await d`
  select mt.id as matricula, s.id as seccion, s.codigo as seccion_codigo, a.sigla
    from public.matriculas  mt
    join public.perfiles    p on p.id = mt.perfil_id
    join public.usuarios    u on u.id = p.id
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
   where lower(u.correo) = ${CORREO} and mt.activa
     and exists (select 1 from public.articulos ar
                  where ar.asignatura_id = s.asignatura_id and ar.periodo_id = s.periodo_id
                    and ar.activo and ar.precio is not null)
   limit 1`;
if (!m) throw new Error('El alumno de prueba no tiene un ramo con tienda con precios.');

const apagar = async () => {
  await d`update public.reuniones set fin = now()
           where seccion_id = ${m.seccion} and fin is null`;
};
await apagar();

console.log(`Modo reunión en ${BASE}`);
console.log(`${m.sigla} · sección ${m.seccion_codigo}`);

const perfil = await mkdtemp(join(tmpdir(), 'pulso-'));
const nav = await puppeteer.launch({ executablePath: chrome, headless: true,
  userDataDir: perfil, args: ['--no-first-run'] });
try {
  const p = await nav.newPage();
  await p.setViewport({ width: 1400, height: 1100 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));

  await p.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('input[type=email]');
  await p.type('input[type=email]', CORREO);
  await p.type('input[type=password]', CLAVE);
  await p.click('button[type=submit]');
  await p.waitForFunction(() => location.pathname !== '/ingresar', { timeout: 30000 });

  // El alumno puede tener varios ramos; hay que dejar elegido el de la sección
  // que vamos a poner en reunión, o el aviso no aparecería y no sabríamos por qué.
  await p.evaluate((mat) => {
    try { localStorage.setItem('pulso.ramo', mat); } catch {}
  }, m.matricula);

  // ══════════ Sin reunión ══════════
  console.log('\nSin reunión');
  await p.goto(`${BASE}/tienda`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.articulo', { timeout: 30000 });
  await pausa(1200);

  const precioDe = () => p.evaluate(() => {
    const a = [...document.querySelectorAll('.articulo')]
      .find(x => x.querySelector('.precio'));
    if (!a) return null;
    const pr = a.querySelector('.precio');
    return {
      nombre: a.querySelector('h3')?.textContent?.trim(),
      texto: pr.textContent.replace(/\s+/g, ' ').trim(),
      antes: pr.querySelector('s')?.textContent?.trim() ?? null,
    };
  });

  rev('la barra no dice nada de reunión',
    await p.evaluate(() => !!document.querySelector('.en-reunion')), false);
  rev('la tienda no anuncia descuento',
    await p.evaluate(() => document.body.textContent.includes('mientras el profe está en reunión')),
    false);
  const antes = await precioDe();
  rev('y los precios no traen nada tachado', antes?.antes, null);
  console.log(`  · «${antes?.nombre}» a ${antes?.texto}`);

  // ══════════ Encenderla ══════════
  // Con la pestaña abierta, sin recargar: es lo que de verdad pasa en la sala.
  console.log('\nSe enciende mientras el alumno tiene la pantalla abierta');
  const [{ r: encendida }] = await como(docente.id, (s) =>
    s`select public.reunion_iniciar(${m.seccion}::uuid, ${DESCUENTO}::integer) as r`);
  rev('el docente la encendió', encendida?.en_reunion, true);

  // El store pregunta cada 60s. Se espera eso más el viaje.
  await p.waitForFunction(() => !!document.querySelector('.en-reunion'), { timeout: 90000 })
    .then(() => rev('el aviso aparece solo, sin recargar', true, true))
    .catch(() => rev('el aviso aparece solo, sin recargar', false, true));

  rev('y dice que está en reunión',
    await p.evaluate(() => document.querySelector('.en-reunion')?.textContent?.includes('en reunión')),
    true);
  rev('con el enlace a la tienda y su porcentaje',
    await p.evaluate((pc) => {
      const a = document.querySelector('.en-reunion .premio');
      return !!a && a.getAttribute('href') === '/tienda' && a.textContent.includes(`${pc}%`);
    }, DESCUENTO), true);

  // ══════════ La tienda con descuento ══════════
  console.log('\nLa tienda con descuento');
  await p.goto(`${BASE}/tienda`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.articulo', { timeout: 30000 });
  await pausa(1500);

  rev('anuncia el descuento',
    await p.evaluate(() => document.body.textContent.includes('de descuento mientras el profe está en reunión')),
    true);
  const conDesc = await precioDe();
  rev('muestra el precio de lista tachado', conDesc?.antes, antes?.texto.replace('pts', '').trim());

  // Que el número de la pantalla sea el que cobra la base, no uno parecido.
  const [enBase] = await d`
    select public.precio_con_descuento(ar.precio, ${DESCUENTO}::integer) as v, ar.precio
      from public.articulos ar
      join public.secciones s on s.asignatura_id = ar.asignatura_id
                             and s.periodo_id    = ar.periodo_id
     where s.id = ${m.seccion} and ar.activo and ar.precio is not null
     order by ar.orden, ar.precio limit 1`;
  const mostrado = Number((conDesc?.texto ?? '').replace(/[^\d]/g, '').slice(
    String(enBase.precio).length));
  rev('y el precio rebajado es el que cobra la base',
    (conDesc?.texto ?? '').includes(String(enBase.v)), true);
  if (Number.isFinite(mostrado)) console.log(`  · pantalla ${conDesc?.texto} · base ${enBase.v}`);

  // ══════════ Apagarla ══════════
  console.log('\nSe apaga');
  const [{ r: apagada }] = await como(docente.id, (s) =>
    s`select public.reunion_terminar(${m.seccion}::uuid) as r`);
  rev('el docente la terminó', apagada?.en_reunion, false);

  await p.waitForFunction(() => !document.querySelector('.en-reunion'), { timeout: 90000 })
    .then(() => rev('el aviso desaparece solo', true, true))
    .catch(() => rev('el aviso desaparece solo', false, true));

  await p.goto(`${BASE}/tienda`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.articulo', { timeout: 30000 });
  await pausa(1500);
  rev('la tienda deja de anunciar descuento',
    await p.evaluate(() => document.body.textContent.includes('mientras el profe está en reunión')),
    false);
  const despues = await precioDe();
  rev('y los precios vuelven a lo normal', despues?.texto, antes?.texto);
  rev('sin nada tachado', despues?.antes, null);

  rev('sin errores en consola', errs, []);
} finally {
  await nav.close();
  await rm(perfil, { recursive: true, force: true });
  await apagar();
}

console.log(f === 0 ? '\nTodo bien.' : `\n${f} fallos.`);
process.exit(f === 0 ? 0 : 1);
