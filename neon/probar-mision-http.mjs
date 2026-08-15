/**
 * La misión del día por HTTP, contra producción.
 *
 * Ejercita lo que la prueba de lógica no puede ver: la cookie, la generación
 * corriendo dentro de una función de Vercel con la key y el rol generador, y que
 * la pauta no salga por el cable.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-mision-http.mjs
 */
import { neon } from '@neondatabase/serverless';

const BASE = process.argv[2] ?? 'https://pulso-rust.vercel.app';
const d = neon(process.env.DATABASE_URL_OWNER);
let f = 0;
const rev = (e, r, x) => { const ok = JSON.stringify(r) === JSON.stringify(x);
  if (!ok) f++; console.log(`  ${ok?'✓':'✗'} ${e}: ${JSON.stringify(r)}${ok?'':' ← esperaba '+JSON.stringify(x)}`); };

const [mat] = await d`select mt.id from public.matriculas mt
   join public.usuarios u on u.id=mt.perfil_id
   join public.secciones s on s.id=mt.seccion_id
   join public.asignaturas a on a.id=s.asignatura_id
  where lower(u.correo)='alumno.prueba@duocuc.cl' and a.sigla='DSY1107'`;
const limpiar = async () => {
  await d`delete from public.misiones where matricula_id=${mat.id}`;
  await d`delete from public.movimientos_experiencia where matricula_id=${mat.id}`;
};
await limpiar();

console.log('1. Sin sesión no se entra');
rev('GET', (await fetch(`${BASE}/api/mision?matricula=${mat.id}`)).status, 401);
rev('POST', (await fetch(`${BASE}/api/mision`, {method:'POST',
  headers:{'Content-Type':'application/json'}, body:JSON.stringify({matricula:mat.id})})).status, 401);

console.log('\n2. Iniciar sesión');
const ing = await fetch(`${BASE}/api/auth/ingresar`, {method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({correo:'alumno.prueba@duocuc.cl', clave:'pulso-prueba-2026'})});
const ck = (ing.headers.getSetCookie?.() ?? []).map(c=>c.split(';')[0]).join('; ');
rev('trae cookie', ck.startsWith('pulso_sesion='), true);
const H = { 'Content-Type':'application/json', cookie: ck };

console.log('\n3. Estado antes de generar');
const e0 = await (await fetch(`${BASE}/api/mision?matricula=${mat.id}`, {headers:H})).json();
rev('puede generar', e0.estado.puede_generar, true);
rev('sin misión', e0.mision, null);

console.log('\n4. El botón');
const t0 = Date.now();
const res = await fetch(`${BASE}/api/mision`, {method:'POST', headers:H, body:JSON.stringify({matricula:mat.id})});
const g = await res.json();
rev('estado', res.status, 200);
console.log(`   tardó ${((Date.now()-t0)/1000).toFixed(1)}s`);
if (g.error) { console.log('   ✗', g.error); process.exit(1); }
rev('la generó', g.generada, true);
rev('cuatro alternativas', g.mision.enunciado.opciones.length, 4);
rev('la pauta no viaja', 'correcta' in g.mision.enunciado || 'explicacion' in g.mision.enunciado, false);
rev('el cuerpo entero no trae la solución', JSON.stringify(g).includes('"solucion"'), false);
console.log(`   ${g.mision.enunciado.pregunta}`);
g.mision.enunciado.opciones.forEach((o,i)=>console.log(`     ${'abcd'[i]}) ${o.slice(0,72)}`));

console.log('\n5. Apretarlo de nuevo no genera otra');
const g2 = await (await fetch(`${BASE}/api/mision`, {method:'POST', headers:H, body:JSON.stringify({matricula:mat.id})})).json();
rev('no generó otra', g2.generada, false);
rev('es la misma', g2.mision.id, g.mision.id);

console.log('\n6. Responder bien paga');
const [sol] = await d`select solucion from public.misiones where id=${g.mision.id}`;
const rr = await (await fetch(`${BASE}/api/mision-responder`, {method:'POST', headers:H,
  body: JSON.stringify({mision:g.mision.id, respuesta:{elegida: sol.solucion.correcta}})})).json();
rev('acertada', rr.acertada, true);
rev('experiencia', rr.xp_ganada, 25);
rev('recién ahora ve la explicación', rr.solucion.explicacion.length > 10, true);
const [xp] = await d`select coalesce(sum(xp),0)::int x from public.movimientos_experiencia where matricula_id=${mat.id}`;
rev('experiencia anotada', xp.x, 25);

console.log('\n7. Responder dos veces se rechaza');
const dos = await (await fetch(`${BASE}/api/mision-responder`, {method:'POST', headers:H,
  body: JSON.stringify({mision:g.mision.id, respuesta:{elegida:'0'}})})).json();
rev('rechazado', /ya está resuelta/.test(dos.error ?? ''), true);

console.log('\n8. La matrícula de otro se rechaza');
const [otro] = await d`select id from public.matriculas where id <> ${mat.id} and activa limit 1`;
const aj = await (await fetch(`${BASE}/api/mision?matricula=${otro.id}`, {headers:H})).json();
rev('rechazado', !!aj.error, true);

await limpiar();
console.log(f===0 ? '\nTodo bien por HTTP: la misión del día funciona en producción.' : `\n${f} fallaron.`);
process.exit(f===0?0:1);
