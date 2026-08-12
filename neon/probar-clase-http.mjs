/**
 * La misma prueba, pero por HTTP y contra producción.
 *
 * `probar-clase.mjs` ejercita la lógica de Postgres; esto ejercita lo que la
 * lógica no puede ver: la cookie, la reescritura, el Blob leído desde la función,
 * el HTML que sale por el cable y el script inyectado dentro de él.
 *
 * Hace lo mismo que haría el alumno: inicia sesión, abre la clase con un GET
 * normal y reporta avance como lo haría el script del deck.
 *
 *   node neon/probar-clase-http.mjs [https://pulso-rust.vercel.app]
 */
import { neon } from '@neondatabase/serverless';

const BASE = process.argv[2] ?? 'https://pulso-rust.vercel.app';
const CORREO = 'alumno.prueba@duocuc.cl';
const CLAVE = 'pulso-prueba-2026';
const SIGLA = 'DSY1107';
const CODIGO = 'S01';

let fallos = 0;
function revisar(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`));
}

const dueno = neon(process.env.DATABASE_URL_OWNER);

const [clase] = await dueno`
  select c.id, c.slides, c.actividades, c.pauta, c.segundos_minimos,
         c.puntos_abrir, c.puntos_actividad, c.puntos_terminar
    from public.clases c join public.asignaturas a on a.id = c.asignatura_id
   where a.sigla = ${SIGLA} and c.codigo = ${CODIGO}`;
const [mat] = await dueno`
  select mt.id from public.matriculas mt
    join public.perfiles  p on p.id = mt.perfil_id
    join public.usuarios  u on u.id = p.id
    join public.secciones s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
   where lower(u.correo) = ${CORREO} and a.sigla = ${SIGLA}`;

const saldo = async () => (await dueno`
  select coalesce(sum(puntos),0)::int as s from public.movimientos_puntos
   where matricula_id = ${mat.id}`)[0].s;

// Estado limpio para que la corrida sea repetible.
await dueno`delete from public.progreso_clase
             where matricula_id = ${mat.id} and clase_id = ${clase.id}`;
await dueno`delete from public.movimientos_puntos
             where matricula_id = ${mat.id}
               and (motivo like ${'%clase ' + CODIGO + '%'} or motivo like ${'%de ' + CODIGO})`;

const s0 = await saldo();
console.log(`Contra   ${BASE}`);
console.log(`Clase    ${SIGLA}/${CODIGO} · ${clase.slides} slides · ${clase.actividades} actividades`);
console.log(`Saldo    ${s0} al empezar\n`);

// ---------- 1. Sin sesión ----------

console.log('1. Sin sesión no se abre');
const anon = await fetch(`${BASE}/api/clase?id=${clase.id}`, { redirect: 'manual' });
revisar('estado', anon.status, 401);
const cuerpoAnon = await anon.text();
revisar('no filtra el deck', cuerpoAnon.length < 4000, true);
revisar('explica qué hacer', cuerpoAnon.includes('iniciar sesión'), true);

// ---------- 2. Iniciar sesión ----------

console.log('\n2. Iniciar sesión');
const ingreso = await fetch(`${BASE}/api/auth/ingresar`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ correo: CORREO, clave: CLAVE }),
});
revisar('estado', ingreso.status, 200);
const galleta = (ingreso.headers.getSetCookie?.() ?? [])
  .map((c) => c.split(';')[0]).join('; ');
revisar('trae la cookie de sesión', galleta.startsWith('pulso_sesion='), true);

// ---------- 3. Abrir la clase ----------

console.log('\n3. Abrir la clase con la cookie');
const r1 = await fetch(`${BASE}/api/clase?id=${clase.id}`, { headers: { cookie: galleta } });
revisar('estado', r1.status, 200);
revisar('tipo de contenido', r1.headers.get('content-type'), 'text/html; charset=utf-8');
revisar('revalida siempre', /no-cache/.test(r1.headers.get('cache-control') ?? ''), true);
revisar('no se indexa', r1.headers.get('x-robots-tag'), 'noindex, nofollow');
const etag = r1.headers.get('etag');
revisar('trae ETag', typeof etag === 'string' && etag.length > 5, true);

const html = await r1.text();
revisar('llegó el deck completo', html.length > 700000, true);
revisar('es el deck de verdad', html.includes('Presentación de la asignatura'), true);
revisar('viene instrumentado', html.includes('data-pulso="rastreo"'), true);
revisar('el script va antes de </body>',
  html.lastIndexOf('data-pulso="rastreo"') < html.lastIndexOf('</body>'), true);
revisar('fuerza modo estudio', html.includes("cambiarModo('estudio')"), true);
revisar('no filtra la ruta del blob', /blob\.vercel-storage\.com/.test(html), false);
revisar('puntos por abrir', await saldo(), s0 + clase.puntos_abrir);

console.log('\n4. Con el ETag responde 304 y no reenvía 750 KB');
const r2 = await fetch(`${BASE}/api/clase?id=${clase.id}`,
  { headers: { cookie: galleta, 'if-none-match': etag } });
revisar('estado', r2.status, 304);
revisar('sin cuerpo', (await r2.text()).length, 0);
revisar('reabrir no volvió a pagar', await saldo(), s0 + clase.puntos_abrir);

// ---------- 5. Reportar avance ----------

const avance = (slide, respuestas) => fetch(`${BASE}/api/clase-avance`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie: galleta },
  body: JSON.stringify({ clase: clase.id, slide, respuestas }),
}).then(async (r) => ({ estado: r.status, datos: await r.json() }));

console.log('\n5. Reportar una actividad acertada');
const llaves = Object.keys(clase.pauta);
const una = { [llaves[0]]: clase.pauta[llaves[0]] };
const a1 = await avance(5, una);
revisar('estado', a1.estado, 200);
revisar('puntos', a1.datos.puntos_nuevos, clase.puntos_actividad);

console.log('\n6. Reportar todas y llegar al final, antes del mínimo de tiempo');
const a2 = await avance(clase.slides - 1, clase.pauta);
revisar('paga las que faltaban', a2.datos.puntos_nuevos,
  (clase.actividades - 1) * clase.puntos_actividad);
revisar('todavía no terminada', a2.datos.terminada, false);

console.log('\n7. Con el tiempo cumplido, paga el término');
await dueno`update public.progreso_clase
               set abierta_en = now() - make_interval(secs => ${clase.segundos_minimos + 5})
             where matricula_id = ${mat.id} and clase_id = ${clase.id}`;
const a3 = await avance(clase.slides - 1, clase.pauta);
revisar('puntos por terminar', a3.datos.puntos_nuevos, clase.puntos_terminar);
revisar('terminada', a3.datos.terminada, true);

console.log('\n8. Avance sin sesión se rechaza');
const sinSesion = await fetch(`${BASE}/api/clase-avance`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clase: clase.id, slide: 20, respuestas: clase.pauta }),
});
revisar('estado', sinSesion.status, 401);

console.log('\n9. Una clase que no existe no revela nada');
const fantasma = await fetch(`${BASE}/api/clase?id=00000000-0000-0000-0000-000000000000`,
  { headers: { cookie: galleta } });
revisar('estado', fantasma.status, 403);

const esperado = s0 + clase.puntos_abrir
  + clase.actividades * clase.puntos_actividad + clase.puntos_terminar;
revisar('saldo final', await saldo(), esperado);

console.log(fallos === 0
  ? `\nTodo bien por HTTP: ${esperado - s0} puntos en el recorrido completo.`
  : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
