/**
 * Las cinco mecánicas de la misión del día en un navegador real: dibujarlas,
 * responder mal y bien, y recargar. Deja capturas en /tmp/misiones-*.png.
 *
 * Las misiones se **siembran** con datos armados a mano (las mismas funciones
 * `armar` que usa el generador), no se piden al modelo: así la prueba es
 * determinista y no gasta tokens. Lo único que llama al modelo es corregir la
 * respuesta de `desarrollo`, que es justamente lo que se quiere ver andando.
 *
 * Necesita la API **local** (`neon/servir-api-local.mjs`) si hay `desarrollo`, porque
 * esa corrección todavía no está desplegada. Ver el encabezado de ese archivo.
 *
 *   set -a; . ./.env.local; set +a
 *   BASE=http://localhost:4200 node neon/probar-misiones-variadas-navegador.mjs
 */
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { MECANICAS } from '../lib/misiones.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4200';
const SOLO = process.env.SOLO?.split(',');
// `TEMA=claro|oscuro` fija el tema; sin él, el navegador sigue al sistema.
const TEMA = process.env.TEMA;
const CANDIDATOS = [process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'].filter(Boolean);
let chrome = null;
for (const c of CANDIDATOS) { try { await access(c); chrome = c; break; } catch {} }
if (!chrome) { console.error('No encontré Chrome'); process.exit(2); }
const puppeteer = (await import('puppeteer-core')).default;

const d = neon(process.env.DATABASE_URL_OWNER);
const g = neon(process.env.DATABASE_URL_MISIONES);
let f = 0;
const rev = (e, r, x) => { const ok = JSON.stringify(r) === JSON.stringify(x);
  if (!ok) f++; console.log(`  ${ok?'✓':'✗'} ${e}: ${JSON.stringify(r)}${ok?'':' ← esperaba '+JSON.stringify(x)}`); };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const [mat] = await d`select mt.id from public.matriculas mt
   join public.usuarios u on u.id=mt.perfil_id
   join public.secciones s on s.id=mt.seccion_id
   join public.asignaturas a on a.id=s.asignatura_id
  where lower(u.correo)='alumno.prueba@duocuc.cl' and a.sigla='DSY1107'`;
const limpiar = async () => {
  await d`delete from public.misiones where matricula_id=${mat.id}`;
  await d`delete from public.movimientos_experiencia where matricula_id=${mat.id}`;
};

// ============================== Las misiones de siembra ==============================

const FIXTURES = {
  emparejar: () => MECANICAS.emparejar.armar(null, { pares: [
    { termino: 'autenticación', definicion: 'responde quién eres: comprobar la identidad de quien llama.' },
    { termino: 'autorización', definicion: 'responde qué puedes hacer una vez que se sabe quién eres.' },
    { termino: 'JWT', definicion: 'es un token firmado que lleva la identidad y los permisos adentro.' },
    { termino: 'TLS', definicion: 'es el protocolo que cifra la conexión entre el cliente y el servidor.' }] }),

  verdadero_falso: () => MECANICAS.verdadero_falso.armar({ afirmaciones: [
    { texto: 'Un JWT lleva la información de la identidad dentro del propio token.', verdadera: true, porque: 'Por eso se puede validar sin consultar una base de datos.' },
    { texto: 'La firma de un JWT sirve para ocultar el contenido del payload.', verdadera: false, porque: 'La firma protege la integridad; el payload solo va codificado en Base64.' },
    { texto: 'El servidor puede comprobar un JWT con la clave pública del emisor.', verdadera: true, porque: 'Con la firma asimétrica basta la pública, y eso es lo que publica JWKS.' },
    { texto: 'Un JWT expirado se sigue aceptando mientras la firma sea correcta.', verdadera: false, porque: 'La expiración (exp) se valida aparte de la firma, y vencido se rechaza.' }] },
    { termino: 'JWT', fuente: 'D2' }),

  diagrama: () => MECANICAS.diagrama.armar({
    apto: true, titulo: 'Recorrido de una petición autenticada',
    pasos: ['Cliente con token', 'API Gateway', 'Valida firma y exp', 'BFF', 'Microservicio'],
    flechas: ['Bearer', 'enruta', 'confía', ''],
    distractores: ['Genera el token', 'Consulta el log', 'Reintenta la petición'],
    explicacion: 'Antes de pasarle la petición al BFF, el gateway valida la firma y la expiración del token.',
  }, { termino: 'API Gateway', fuente: 'D1', oculto: 2 }),

  quiz: () => MECANICAS.quiz.armar({
    pregunta: '¿Para qué sirve la firma de un JWT?',
    respuesta_correcta: 'Para comprobar que nadie lo modificó',
    incorrectas: ['Para ocultar su contenido', 'Para que expire antes', 'Para ahorrar un viaje al log'],
    explicacion: 'La firma asegura la integridad: si alguien cambia el payload, deja de calzar.',
  }, { termino: 'JWT', fuente: 'D2' }),

  desarrollo: () => MECANICAS.desarrollo.armar({
    pregunta: '¿Por qué un servidor puede confiar en un JWT sin consultar una base de datos?',
    criterios: ['El token lleva la identidad y los permisos dentro.',
      'La firma permite comprobar que no fue modificado.',
      'Se valida la firma con la clave del emisor.'],
  }, { termino: 'JWT', fuente: 'D2',
       definicion: 'es un token firmado que lleva la identidad y los permisos adentro.' }),
};

async function sembrar(codigo) {
  await limpiar();
  const h = FIXTURES[codigo]();
  await g`select public.mision_registrar(${mat.id}::uuid, ${codigo}, 'diaria',
            ${JSON.stringify(h.enunciado)}::jsonb, ${JSON.stringify(h.solucion)}::jsonb, 'modelo', 0, 0)`;
  const [m] = await d`select id, solucion from public.misiones where matricula_id=${mat.id}`;
  return m;
}

// ============================== El navegador ==============================

const perfil = await mkdtemp(join(tmpdir(), 'pulso-'));
const nav = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: perfil,
  args: ['--no-first-run'] });
try {
  const p = await nav.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await p.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('input[type=email]');
  await p.type('input[type=email]', 'alumno.prueba@duocuc.cl');
  await p.type('input[type=password]', 'pulso-prueba-2026');
  await p.click('button[type=submit]');
  for (let i = 0; i < 40 && /ingresar/.test(p.url()); i++) await esperar(500);
  errs.length = 0;   // el 401 de «¿hay sesión?» antes de ingresar no es un error de la pantalla
  await p.evaluate((id, tema) => {
    localStorage.setItem('pulso.ramo', id);
    if (tema) localStorage.setItem('pulso.tema', tema);
  }, mat.id, TEMA ?? null);

  const abrir = async (esperaSel) => {
    await p.goto(`${BASE}/misiones`, { waitUntil: 'networkidle2' });
    await p.waitForSelector(esperaSel, { timeout: 20000 });
    await esperar(600);
  };
  const clic = (sel, i = 0) => p.evaluate((s, k) => document.querySelectorAll(s)[k].click(), sel, i);
  const clicTexto = (t) => p.evaluate((x) => [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === x)?.click(), t);
  const foto = async (nombre) => p.screenshot({ path: `/tmp/misiones-${TEMA ? TEMA + '-' : ''}${nombre}.png`, fullPage: true });
  const texto = () => p.evaluate(() => document.body.innerText);
  const insignia = () => p.evaluate(() => document.querySelector('.insignia:not(.celeste)')?.textContent?.trim() ?? null);
  const esperarResultado = async (ms = 60000) => {
    for (let i = 0; i < ms / 500; i++) {
      if (await insignia()) return true;
      await esperar(500);
    }
    return false;
  };

  /** Cómo se responde cada mecánica: `mala` y `buena` a partir de la pauta. */
  const jugadas = {
    emparejar: {
      sel: '.par',
      async responder(sol, bien) {
        for (let j = 0; j < sol.solucion.pares.length; j++) {
          const k = bien ? Number(sol.solucion.pares[j]) : (Number(sol.solucion.pares[j]) + 1) % 4;
          await p.evaluate((jj, kk) => document.querySelectorAll('.par')[jj].querySelectorAll('.ficha')[kk].click(), j, k);
        }
      },
    },
    verdadero_falso: {
      sel: '.afirmacion',
      async responder(sol, bien) {
        for (let i = 0; i < sol.solucion.respuestas.length; i++) {
          const v = sol.solucion.respuestas[i];
          const marca = bien || i > 0 ? v : (v === 'v' ? 'f' : 'v');
          await p.evaluate((ii, k) => document.querySelectorAll('.afirmacion')[ii].querySelectorAll('.vf-boton')[k].click(), i, marca === 'v' ? 0 : 1);
        }
      },
    },
    diagrama: {
      sel: 'app-diagrama-mision svg',
      async responder(sol, bien) {
        const c = Number(sol.solucion.correcta);
        await clic('.opcion-mision', bien ? c : (c + 1) % 4);
      },
    },
    quiz: {
      sel: '.opcion-mision',
      async responder(sol, bien) {
        const c = Number(sol.solucion.correcta);
        await clic('.opcion-mision', bien ? c : (c + 1) % 4);
      },
    },
    desarrollo: {
      sel: 'textarea.desarrollo',
      async responder(sol, bien) {
        const t = bien
          ? 'Porque el token ya lleva la identidad y los permisos adentro, y la firma permite comprobar con la clave del emisor que nadie lo modificó, así que no hace falta preguntarle a una base de datos.'
          : 'asdf qwer el perro come pasto en la plaza y hoy hace mucho calor en santiago de chile';
        await p.type('textarea.desarrollo', t);
      },
    },
  };

  let n = 0;
  for (const codigo of Object.keys(jugadas)) {
    if (SOLO && !SOLO.includes(codigo)) continue;
    const j = jugadas[codigo];
    n++;
    console.log(`\n${n}. ${codigo}`);

    for (const bien of [false, true]) {
      const etq = bien ? 'bien' : 'mal';
      const sol = await sembrar(codigo);
      await p.setViewport({ width: 1280, height: 900 });
      await abrir(j.sel);
      if (!bien) await foto(`${codigo}-1-pendiente`);
      rev(`${etq}: se dibuja sin errores`, errs.splice(0), []);
      rev(`${etq}: el botón Responder arranca deshabilitado`,
        await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Responder')?.disabled), true);

      await j.responder(sol, bien);
      await esperar(300);
      if (!bien) await foto(`${codigo}-2-marcada`);
      rev(`${etq}: con todo marcado se habilita`,
        await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Responder')?.disabled), false);
      await clicTexto('Responder');
      rev(`${etq}: aparece el resultado`, await esperarResultado(), true);
      const ins = await insignia();
      console.log(`     insignia: ${ins}`);
      if (codigo === 'desarrollo') {
        rev(`${etq}: dice cuánto ganó`, bien ? /^\+(75|37) de experiencia/.test(ins) : /Sin puntos/.test(ins), true);
        rev(`${etq}: muestra lo que define el docente`, /Lo que define el docente/i.test(await texto()), true);
      } else {
        rev(`${etq}: insignia`, bien ? /^\+75 de experiencia$/.test(ins) : /Sin puntos/.test(ins), true);
      }
      await esperar(2500);   // lo corregido aguanta el refresco del perfil
      if (!bien) await foto(`${codigo}-3-corregida`);
      else await foto(`${codigo}-4-acertada`);
      rev(`${etq}: sin errores de JavaScript`, errs.splice(0), []);

      // Al recargar, sigue resuelta y con lo que contestó.
      await p.reload({ waitUntil: 'networkidle2' });
      await p.waitForSelector(j.sel, { timeout: 20000 });
      await esperar(1200);
      const t = await texto();
      rev(`${etq}: al recargar no ofrece otra`, /Generar mi misión/.test(t), false);
      rev(`${etq}: al recargar sigue la insignia`, (await insignia()) === ins, true);
      if (!bien) await foto(`${codigo}-5-recargada`);

      const marcas = await p.evaluate(() => ({
        buenas: document.querySelectorAll('.correcta, .par.ok, .afirmacion.ok').length,
        malas: document.querySelectorAll('.incorrecta, .par.mal, .afirmacion.mal').length,
      }));
      if (codigo !== 'desarrollo') {
        rev(`${etq}: al recargar marca lo correcto`, marcas.buenas > 0, true);
        // El quiz no guarda lo que se eligió (su rama de `mision_responder` no cambió
        // con la 0043): al recargar muestra la correcta, pero no puede marcar el error.
        if (codigo !== 'quiz' || bien) {
          rev(`${etq}: al recargar ${bien ? 'no marca errores' : 'marca los errores'}`, bien ? marcas.malas === 0 : marcas.malas > 0, true);
        }
      }
      rev(`${etq}: sin errores de JavaScript tras recargar`, errs.splice(0), []);
    }

    // El mismo estado, en un celular.
    await sembrar(codigo);
    await p.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
    await abrir(j.sel);
    await foto(`${codigo}-6-celular`);
    const desborde = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    rev('celular: sin scroll horizontal', desborde, false);
  }

} finally { await nav.close(); await rm(perfil, { recursive: true, force: true }); }

await limpiar();
console.log(f === 0 ? '\nTodo bien en el navegador.' : `\n${f} fallaron.`);
process.exit(f === 0 ? 0 : 1);
