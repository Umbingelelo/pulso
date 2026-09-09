/**
 * Los títulos en dos formas, en un navegador real.
 *
 * Lo que solo se ve ejecutando es que los cuatro lugares donde el alumno lee su título
 * —el encabezado, «Mi perfil», el pase y la colección del gacha— digan **lo mismo**
 * después de cambiar la preferencia. Cada uno sale de una función distinta de la base, y
 * la prueba de `probar-gacha.mjs` ya comprueba que las funciones coincidan; acá se
 * comprueba que las pantallas lean la que corresponde.
 *
 * Y sobre todo: que el pase siga marcando **«Puesto»**. Antes averiguaba cuál título
 * llevabas puesto comparando el *texto* de `tabla_posiciones` contra el de `mi_pase`, y
 * calzaba por casualidad. Con dos formas eso lo habría dejado viéndose como si no
 * llevaras nada —sin error en ninguna parte— para toda alumna que eligiera femenino. Esa
 * es la regresión que esta prueba existe para atrapar.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-titulos-navegador.mjs
 *   BASE=http://localhost:4321 node neon/probar-titulos-navegador.mjs
 *
 * Deja el estado como estaba: la forma, el título puesto y `oculto_en_ranking`.
 */
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const BASE = process.env.BASE ?? 'https://pulso-rust.vercel.app';
const CORREO = 'alumno.prueba@duocuc.cl';
const CLAVE = 'pulso-prueba-2026';

let chrome = null;
for (const c of [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                 '/usr/bin/google-chrome'].filter(Boolean)) {
  try { await access(c); chrome = c; break; } catch {}
}
if (!chrome) { console.error('No encontré Chrome'); process.exit(2); }
const puppeteer = (await import('puppeteer-core')).default;

const d = neon(process.env.DATABASE_URL_OWNER);
let fallos = 0;
const rev = (e, ok, detalle = '') => {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}${ok || !detalle ? '' : `\n      ${detalle}`}`);
};

const [u] = await d`select id from public.usuarios where lower(correo) = ${CORREO}`;
if (!u) throw new Error(`No existe ${CORREO}.`);

/**
 * El ramo con que se mide es el **primero que la pantalla elige**, y ese es el primero de
 * `mis_ramos` ordenado como lo pide `misRamos()`: periodo descendente y después sigla.
 * Medir contra otro daría un título que la pantalla no está mostrando.
 */
const [mat] = await d`
  select mt.id, a.sigla from public.matriculas mt
    join public.secciones s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
    join public.periodos p on p.id = s.periodo_id
   where mt.perfil_id = ${u.id} and mt.activa
   order by p.codigo desc, a.sigla limit 1`;
if (!mat) throw new Error('El alumno de prueba no tiene matrícula activa.');

/**
 * El título con que se mide, y el XP que hace falta para que se pueda comprobar «Puesto».
 *
 * Tiene que ser una recompensa **del pase vigente** de ese ramo, y además de un nivel que
 * el alumno alcance: el botón de la escalera solo se dibuja si `r.desbloqueada`, así que
 * con la cuenta de prueba en 0 XP no hay ningún botón que mirar y la comprobación de
 * «Puesto» fallaría por la razón equivocada. Eso fue exactamente lo que pasó la primera
 * vez que se corrió esto.
 *
 * Por eso se elige el título con forma femenina de **nivel más bajo**, y se le regala el
 * XP justo para llegar: mientras menos niveles se desbloqueen, menos recompensas reparte
 * `sincronizar_pase` y menos hay que limpiar después.
 */
const [{ p: pase }] = await d.transaction([
  d`select set_config('pulso.usuario_id', ${u.id}, true)`,
  d`set local role pulso_app`,
  d`select public.mi_pase(${mat.id}::uuid) as p`,
]).then((r) => r[2]);
if (!pase?.vigente) {
  console.error('El pase de ese ramo no está vigente: el XP de ahora no contaría.');
  process.exit(2);
}
const conFormaEnPase = [];
for (const r of pase.recompensas ?? []) {
  if (r.cosmetico?.tipo !== 'titulo') continue;
  const [c] = await d`select id, nombre, valor, valor_femenino from public.cosmeticos
     where id = ${r.cosmetico.id} and valor_femenino is not null`;
  if (c) conFormaEnPase.push({ ...c, nivel: r.nivel });
}
conFormaEnPase.sort((a, b) => a.nivel - b.nivel);
const titulo = conFormaEnPase[0];
if (!titulo) {
  console.error('Ninguna recompensa de título del pase vigente tiene forma femenina.');
  process.exit(2);
}
const [{ n: xpNecesario }] = await d`select public.xp_hasta_nivel(${titulo.nivel}) as n`;
console.log(`Midiendo con «${titulo.valor}» / «${titulo.valor_femenino}»` +
  ` en ${mat.sigla}, nivel ${titulo.nivel} (${xpNecesario} XP)`);

const MARCA = 'Prueba de títulos en dos formas';
const formaOriginal = (await d`select forma_titulo from public.perfiles where id = ${u.id}`)[0].forma_titulo;
const tituloOriginal = (await d`select titulo_id from public.matriculas where id = ${mat.id}`)[0].titulo_id;
const ocultoOriginal = (await d`select oculto_en_ranking from public.perfiles where id = ${u.id}`)[0].oculto_en_ranking;

/**
 * Todo lo que se cree desde acá se limpia por reloj y por marca, no contra una foto.
 *
 * `sincronizar_pase` reparte por su cuenta las recompensas de los niveles que se
 * desbloqueen, así que no alcanza con acordarse del título elegido: hay que barrer todo lo
 * que entre durante la corrida. Y por marca en vez de por foto porque una foto tomada al
 * arrancar convierte lo que dejó una corrida muerta en línea base — es la misma trampa que
 * tuvo `probar-gacha.mjs`.
 */
const DESDE = (await d`select now() as t`)[0].t;

await d`update public.perfiles set oculto_en_ranking = false, forma_titulo = 'masculino'
         where id = ${u.id}`;
await d`insert into public.movimientos_experiencia (matricula_id, xp, motivo)
        values (${mat.id}, ${xpNecesario + 10}, ${MARCA})`;
await d`insert into public.alumno_cosmeticos (matricula_id, cosmetico_id, origen)
        values (${mat.id}, ${titulo.id}, 'pase')
        on conflict (matricula_id, cosmetico_id) do nothing`;
await d`update public.matriculas set titulo_id = ${titulo.id} where id = ${mat.id}`;

const perfilChrome = await mkdtemp(join(tmpdir(), 'pulso-'));
const nav = await puppeteer.launch({ executablePath: chrome, headless: true,
  userDataDir: perfilChrome, args: ['--no-first-run'] });
try {
  const p = await nav.newPage();
  await p.setViewport({ width: 1400, height: 1100 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (e) => { if (e.type() === 'error') errs.push(e.text()); });

  await p.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('input[type=email]');
  await p.type('input[type=email]', CORREO);
  await p.type('input[type=password]', CLAVE);
  await p.click('button[type=submit]');
  for (let i = 0; i < 40 && /ingresar/.test(p.url()); i++) await new Promise((r) => setTimeout(r, 500));

  /** Lo que las cuatro pantallas dicen del título, en esta forma. */
  const leer = async () => {
    await p.goto(`${BASE}/perfil`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('.forma-titulo .boton');
    await new Promise((r) => setTimeout(r, 800));
    const enPerfil = await p.$eval('.cara-con-titulo .titulo-cara',
      (n) => n.textContent.replace(/[«»]/g, '').trim()).catch(() => null);
    const ejemplo = await p.$eval('.forma-titulo p.chico.suave',
      (n) => n.textContent.replace(/^Así se te vería:\s*/, '').replace(/[«»]/g, '').trim())
      .catch(() => null);

    await p.goto(`${BASE}/pase`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1200));
    const puesto = await p.$$eval('.boton',
      (ns) => ns.some((n) => n.textContent.trim() === 'Puesto'));
    // `.nom` es lo que la escalera dibuja de cada recompensa, y sale de
    // `cosmetico.nombre`. Ese fue el hallazgo que casi se escapa: resolver solo `valor`
    // dejaba el pase entero en masculino.
    const enPase = await p.$$eval('.nom', (ns) => ns.map((n) => n.textContent.trim()));

    await p.goto(`${BASE}/gacha`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('.pieza');
    await new Promise((r) => setTimeout(r, 1200));
    const enColeccion = await p.$$eval('.pieza .chapa', (ns) => ns.map((n) => n.textContent.trim()));

    return { enPerfil, ejemplo, puesto, enPase, enColeccion };
  };

  const apretar = async (cual) => {
    await p.goto(`${BASE}/perfil`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('.forma-titulo .boton');
    const bs = await p.$$('.forma-titulo .boton');
    await bs[cual === 'femenino' ? 1 : 0].click();
    // El botón se rehabilita cuando terminó de guardar y recargar.
    for (let i = 0; i < 40; i++) {
      const listo = await p.$$eval('.forma-titulo .boton', (ns) => ns.every((n) => !n.disabled));
      if (listo) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 600));
  };

  for (const forma of ['femenino', 'masculino']) {
    const esperado = forma === 'femenino' ? titulo.valor_femenino : titulo.valor;
    const otro = forma === 'femenino' ? titulo.valor : titulo.valor_femenino;

    console.log(`\nEn ${forma}, esperando «${esperado}»`);
    await apretar(forma);
    const v = await leer();

    rev('«Mi perfil» muestra el título en esa forma', v.enPerfil === esperado, `dice «${v.enPerfil}»`);
    rev('el ejemplo en vivo dice lo mismo', v.ejemplo === esperado, `dice «${v.ejemplo}»`);
    rev('el pase lo muestra en esa forma', v.enPase.includes(esperado),
      `en el pase vi: ${v.enPase.slice(0, 6).join(' · ')}`);
    // La regresión que esta prueba existe para atrapar.
    rev('y el pase sigue marcando «Puesto»', v.puesto === true,
      'la escalera se ve como si no llevara nada puesto');
    rev('la colección lo muestra en esa forma', v.enColeccion.includes(esperado),
      `no lo encontré entre ${v.enColeccion.length} chapas`);
    rev('y en ninguna pantalla se cuela la otra forma',
      v.enPerfil !== otro && v.ejemplo !== otro && !v.enPase.includes(otro)
        && !v.enColeccion.includes(otro),
      `se colaba «${otro}»`);
  }

  const deVerdad = errs.filter((e) => !/401|Unauthorized/.test(e));
  rev('sin errores de página', deVerdad.length === 0, deVerdad.slice(0, 3).join(' · '));
} finally {
  await nav.close();
  await rm(perfilChrome, { recursive: true, force: true });
  // Dejarlo como estaba, pase lo que pase.
  await d`update public.matriculas set titulo_id = ${tituloOriginal} where id = ${mat.id}`;
  await d`update public.perfiles set forma_titulo = ${formaOriginal},
           oculto_en_ranking = ${ocultoOriginal} where id = ${u.id}`;
  const xp = await d`delete from public.movimientos_experiencia
     where matricula_id = ${mat.id} and motivo = ${MARCA} returning id`;
  const cos = await d`delete from public.alumno_cosmeticos
     where matricula_id = ${mat.id} and obtenido_en >= ${DESDE} returning cosmetico_id`;
  const tir = await d`delete from public.movimientos_tiradas
     where matricula_id = ${mat.id} and creado_en >= ${DESDE}
       and motivo like 'Pase nivel %' returning id`;
  console.log(`\nEstado restaurado · ${xp.length} movimientos de XP,` +
    ` ${cos.length} cosméticos y ${tir.length} tiradas que repartió el pase.`);
}

console.log(fallos === 0 ? 'Todo bien.' : `${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
