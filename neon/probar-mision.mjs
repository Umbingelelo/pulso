/**
 * El ciclo completo de una misión diaria, contra la base de verdad.
 *
 * Genera con el modelo, registra con el rol generador, y responde con la
 * identidad del alumno y el RLS puesto —igual que la aplicación—. Lo único que
 * no ejercita es el HTTP y el navegador, que tienen sus propias pruebas.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-mision.mjs
 */
import { neon } from '@neondatabase/serverless';
import { generar } from '../lib/misiones.mjs';

const CORREO = 'alumno.prueba@duocuc.cl';
const SIGLA = 'DSY1107';

const d = neon(process.env.DATABASE_URL_OWNER);
const g = neon(process.env.DATABASE_URL_MISIONES);

let fallos = 0;
const revisar = (e, r, x) => {
  const ok = JSON.stringify(r) === JSON.stringify(x);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(r)}${ok ? '' : ` ← esperaba ${JSON.stringify(x)}`}`);
};

const [alumno] = await d`select id from public.usuarios where correo = ${CORREO}`;
const [mat] = await d`
  select mt.id from public.matriculas mt
    join public.usuarios    u on u.id = mt.perfil_id
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
   where lower(u.correo) = ${CORREO} and a.sigla = ${SIGLA}`;

/** Como la aplicación: identidad puesta a mano y el rol de la app adoptado. */
const como = async (q) => (await d.transaction([
  d`select set_config('pulso.usuario_id', ${alumno.id}, true)`,
  d`set local role pulso_app`,
  q(d),
]))[2] ?? [];

const limpiar = async () => {
  await d`delete from public.misiones where matricula_id = ${mat.id}`;
  await d`delete from public.movimientos_experiencia where matricula_id = ${mat.id}`;
};

/** El término se elige con el RLS del alumno, igual que en `/api/mision`. */
async function contexto() {
  const [c] = await como((s) =>
    s`select b.termino, b.definicion, b.fuente, a.nombre as asignatura
        from public.mision_banco b
        join public.asignaturas a on a.id = b.asignatura_id
       where b.activo order by random() limit 1`);
  return c;
}

async function crear() {
  const ctx = await contexto();
  const h = await generar('quiz', ctx);
  await g`select public.mision_registrar(${mat.id}::uuid, 'quiz', 'diaria',
            ${JSON.stringify(h.enunciado)}::jsonb, ${JSON.stringify(h.solucion)}::jsonb, 'modelo')`;
  const [m] = await como((s) => s`select public.mi_mision(${mat.id}::uuid) as m`);
  return { mision: m.m, termino: ctx.termino };
}

await limpiar();

console.log('1. Antes de apretar el botón');
const [e0] = await como((s) => s`select public.estado_mision(${mat.id}::uuid) as e`);
revisar('puede generar', e0.e.puede_generar, true);
revisar('todavía no tiene', e0.e.ya_tiene, false);
const [n0] = await como((s) => s`select public.mi_mision(${mat.id}::uuid) as m`);
revisar('no hay misión', n0.m, null);

console.log('\n2. Generar la del día');
const { mision, termino } = await crear();
console.log(`   término del banco: ${termino}`);
revisar('quedó creada', !!mision, true);
revisar('el enunciado no trae la correcta', 'correcta' in (mision.enunciado ?? {}), false);
revisar('el enunciado no trae la explicación', 'explicacion' in (mision.enunciado ?? {}), false);
revisar('trae cuatro alternativas', mision.enunciado.opciones.length, 4);
revisar('vale 25 de experiencia', mision.xp, 25);
console.log(`   ${mision.enunciado.pregunta}`);

const [e1] = await como((s) => s`select public.estado_mision(${mat.id}::uuid) as e`);
revisar('el botón queda bloqueado', e1.e.puede_generar, false);
revisar('dice cuándo se rehabilita', e1.e.faltan_segundos > 0, true);

console.log('\n3. La solución no baja al navegador');
try {
  await como((s) => s`select solucion from public.misiones where id = ${mision.id}::uuid`);
  revisar('la app puede leer la solución', 'sí pudo', 'no puede');
} catch (e) {
  revisar('la app no puede leer la solución', /permission denied/.test(e.message), true);
}

console.log('\n4. Responder mal no paga');
const [sol] = await d`select solucion from public.misiones where id = ${mision.id}`;
const mala = String((Number(sol.solucion.correcta) + 1) % 4);
const [r1] = await como((s) =>
  s`select public.mision_responder(${mision.id}::uuid, ${JSON.stringify({ elegida: mala })}::jsonb) as r`);
revisar('acertada', r1.r.acertada, false);
revisar('experiencia', r1.r.xp_ganada, 0);
revisar('ahora sí ve la explicación', r1.r.solucion.explicacion.length > 10, true);

console.log('\n5. No se responde dos veces');
try {
  await como((s) => s`select public.mision_responder(${mision.id}::uuid, '{}'::jsonb) as r`);
  revisar('rechaza el segundo intento', 'lo dejó pasar', 'rechaza');
} catch (e) {
  revisar('rechaza el segundo intento', /ya está resuelta/.test(e.message), true);
}

console.log('\n6. Con otra misión, responder bien sí paga');
await limpiar();
const { mision: m2 } = await crear();
const [s2] = await d`select solucion from public.misiones where id = ${m2.id}`;
const [r2] = await como((s) =>
  s`select public.mision_responder(${m2.id}::uuid, ${JSON.stringify({ elegida: s2.solucion.correcta })}::jsonb) as r`);
revisar('acertada', r2.r.acertada, true);
revisar('experiencia ganada', r2.r.xp_ganada, 25);
const [xp] = await como((s) =>
  s`select coalesce(sum(xp),0)::int as x from public.movimientos_experiencia where matricula_id = ${mat.id}::uuid`);
revisar('experiencia acumulada', xp.x, 25);

console.log('\n7. La misión de otro alumno no se toca');
const [otro] = await d`
  select mt.id from public.matriculas mt where mt.id <> ${mat.id} and mt.activa limit 1`;
try {
  await como((s) => s`select public.mi_mision(${otro.id}::uuid) as m`);
  revisar('rechaza mirar la de otro', 'lo dejó pasar', 'rechaza');
} catch (e) {
  revisar('rechaza mirar la de otro', /no es tuya/.test(e.message), true);
}

console.log('\n8. Una segunda del mismo día no se crea');
const ctx3 = await contexto();
const h3 = await generar('quiz', ctx3);
await g`select public.mision_registrar(${mat.id}::uuid, 'quiz', 'diaria',
          ${JSON.stringify(h3.enunciado)}::jsonb, ${JSON.stringify(h3.solucion)}::jsonb, 'modelo')`;
const [cuantas] = await d`select count(*)::int n from public.misiones
   where matricula_id = ${mat.id} and fecha = public.dia_mision()`;
revisar('sigue habiendo una sola', cuantas.n, 1);

await limpiar();
console.log(fallos === 0
  ? '\nTodo bien: el ciclo de la misión diaria funciona.'
  : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
