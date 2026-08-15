/**
 * La ventana de la clase: que llegar a tiempo valga más, y que valga bien.
 *
 * Lo que se comprueba, además de lo obvio:
 *
 *   * El factor se decide por tramo y en el momento del cobro, no al abrir.
 *   * El **término** se valora con el instante en que el alumno llegó a la última
 *     diapositiva, no con el instante en que se le paga. Entre los dos puede
 *     pasar el mínimo de tiempo de la 0008, y sería absurdo que nuestra propia
 *     demora lo dejara fuera de la ventana. Ese es el caso 5 y es el que más
 *     fácil se rompe si alguien toca esto después.
 *   * Un docente no puede programar la clase de otra asignatura.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-ventana.mjs
 */
import { neon } from '@neondatabase/serverless';

const SIGLA = 'DSY1107';
const CODIGO = 'S01';
const CORREO = 'alumno.prueba@duocuc.cl';

const dueno = neon(process.env.DATABASE_URL_OWNER);
const app = neon(process.env.DATABASE_URL_OWNER);

let fallos = 0;
function revisar(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`));
}

async function como(usuarioId, consulta) {
  const r = await app.transaction([
    app`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    app`set local role pulso_app`,
    consulta(app),
  ]);
  return r[2] ?? [];
}

const [alumno] = await dueno`select id from public.usuarios where correo = ${CORREO}`;
const [docente] = await dueno`select id from public.usuarios where correo like ${'%profesor%'}`;
const [clase] = await dueno`
  select c.id, c.slides, c.actividades, c.pauta, c.segundos_minimos,
         c.puntos_abrir, c.puntos_actividad, c.puntos_terminar,
         c.publicada_desde, c.ventana_hasta, c.factor_atrasado
    from public.clases c join public.asignaturas a on a.id = c.asignatura_id
   where a.sigla = ${SIGLA} and c.codigo = ${CODIGO}`;
const [mat] = await dueno`
  select mt.id from public.matriculas mt
    join public.usuarios    u on u.id = mt.perfil_id
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
   where lower(u.correo) = ${CORREO} and a.sigla = ${SIGLA}`;

const original = {
  desde: clase.publicada_desde, hasta: clase.ventana_hasta, factor: clase.factor_atrasado,
};

const saldo = async () => (await dueno`
  select coalesce(sum(puntos),0)::int as s from public.movimientos_puntos
   where matricula_id = ${mat.id}`)[0].s;

async function limpiar() {
  await dueno`delete from public.progreso_clase
               where matricula_id = ${mat.id} and clase_id = ${clase.id}`;
  await dueno`delete from public.movimientos_puntos
               where matricula_id = ${mat.id}
                 and (motivo like ${'%clase ' + CODIGO + '%'} or motivo like ${'%de ' + CODIGO})`;
}

console.log(`Clase ${SIGLA}/${CODIGO} · abrir ${clase.puntos_abrir} · actividad ${clase.puntos_actividad} · terminar ${clase.puntos_terminar}`);
console.log(`${clase.actividades} actividades · máximo ${clase.puntos_abrir + clase.actividades*clase.puntos_actividad + clase.puntos_terminar}\n`);

try {
  // ---------- 1. Programar desde la app, como docente ----------

  console.log('1. El docente programa la ventana desde la app');
  const abre = new Date(Date.now() - 60_000).toISOString();       // abierta hace un minuto
  const cierra = new Date(Date.now() + 3_600_000).toISOString();  // cierra en una hora
  const [prog] = await como(docente.id, (s) =>
    s`select public.clase_programar(${clase.id}::uuid, ${abre}::timestamptz,
              ${cierra}::timestamptz, 0.5, null, null, null) as r`);
  revisar('quedó programada', prog.r.codigo, CODIGO);
  revisar('factor guardado', Number(prog.r.factor_atrasado), 0.5);

  console.log('\n2. Un alumno no puede programar clases');
  try {
    await como(alumno.id, (s) =>
      s`select public.clase_programar(${clase.id}::uuid, ${abre}::timestamptz, null, null, null, null, null) as r`);
    revisar('rechazado', 'lo dejó pasar', 'rechazado');
  } catch (e) {
    revisar('rechazado', /no es de una asignatura que dictes/.test(e.message), true);
  }

  // ---------- 3. Dentro de la ventana: todo completo ----------

  console.log('\n3. Dentro de la ventana, todo vale completo');
  await limpiar();
  const s0 = await saldo();
  const [a1] = await como(alumno.id, (s) => s`select public.abrir_clase(${clase.id}::uuid) as r`);
  revisar('abrir paga completo', a1.r.puntos_nuevos, clase.puntos_abrir);
  revisar('dice que está en ventana', a1.r.en_ventana, true);

  const [g1] = await como(alumno.id, (s) =>
    s`select public.progreso_clase_guardar(${clase.id}::uuid, 3::integer,
               ${JSON.stringify(clase.pauta)}::jsonb) as r`);
  revisar('actividades pagan completo', g1.r.puntos_nuevos,
    clase.actividades * clase.puntos_actividad);

  // ---------- 4. Fuera de la ventana: reducido ----------

  console.log('\n4. Fuera de la ventana, se paga por el factor');
  // Se mueven las dos fechas juntas: hay un `check` que impide que la ventana
  // cierre antes de que la clase se publique, porque en ese estado nadie podría
  // cobrar completo nunca y sería un error de programación, no una intención.
  await dueno`update public.clases
                 set publicada_desde = now() - interval '2 hours',
                     ventana_hasta   = now() - interval '1 hour'
               where id = ${clase.id}`;
  await limpiar();
  const s1 = await saldo();
  const [a2] = await como(alumno.id, (s) => s`select public.abrir_clase(${clase.id}::uuid) as r`);
  revisar('abrir paga la mitad', a2.r.puntos_nuevos, Math.round(clase.puntos_abrir * 0.5));
  revisar('dice que NO está en ventana', a2.r.en_ventana, false);

  const [g2] = await como(alumno.id, (s) =>
    s`select public.progreso_clase_guardar(${clase.id}::uuid, 3::integer,
               ${JSON.stringify(clase.pauta)}::jsonb) as r`);
  revisar('actividades pagan la mitad', g2.r.puntos_nuevos,
    clase.actividades * Math.round(clase.puntos_actividad * 0.5));

  const motivos = await dueno`select motivo from public.movimientos_puntos
     where matricula_id = ${mat.id} and motivo like ${'%' + CODIGO + '%'} order by id`;
  revisar('el historial lo dice', motivos.every((m) => m.motivo.includes('(fuera de plazo)')), true);

  // ---------- 5. El caso delicado ----------

  console.log('\n5. Llega al final DENTRO de la ventana y cobra después: paga completo');
  // Ventana abierta y a punto de cerrarse.
  await dueno`update public.clases
                 set publicada_desde = now() - interval '10 minutes',
                     ventana_hasta   = now() + interval '5 seconds'
               where id = ${clase.id}`;
  await limpiar();
  const s2 = await saldo();
  await como(alumno.id, (s) => s`select public.abrir_clase(${clase.id}::uuid) as r`);

  // Llega al final ahora, dentro de la ventana. El mínimo de tiempo no se cumple
  // todavía, así que no cobra el término: solo queda anotado cuándo llegó.
  const [g3] = await como(alumno.id, (s) =>
    s`select public.progreso_clase_guardar(${clase.id}::uuid, ${clase.slides - 1}::integer,
               '{}'::jsonb) as r`);
  revisar('todavía no lo da por terminado', g3.r.terminada, false);
  const [pr] = await dueno`select alcanzo_final_en from public.progreso_clase
     where matricula_id = ${mat.id} and clase_id = ${clase.id}`;
  revisar('anotó cuándo llegó al final', pr.alcanzo_final_en !== null, true);

  // Se envejece el escenario en vez de esperar, y con margen suficiente para que
  // no dependa de cuántos milisegundos tarde esta prueba en correr:
  //
  //   -20 min  abrió                     -10 min  llegó al final
  //                          -5 min  cerró la ventana        ahora  cobra
  //
  // O sea: llegó al final DENTRO de la ventana y cobra DESPUÉS de que cerró.
  await dueno`update public.clases
                 set publicada_desde = now() - interval '20 minutes',
                     ventana_hasta   = now() - interval '5 minutes'
               where id = ${clase.id}`;
  await dueno`update public.progreso_clase
                 set abierta_en       = now() - interval '20 minutes',
                     alcanzo_final_en = now() - interval '10 minutes'
               where matricula_id = ${mat.id} and clase_id = ${clase.id}`;

  const [g4] = await como(alumno.id, (s) =>
    s`select public.progreso_clase_guardar(${clase.id}::uuid, ${clase.slides - 1}::integer,
               '{}'::jsonb) as r`);
  revisar('ahora sí termina', g4.r.terminada, true);
  // Lo que se mide: paga COMPLETO aunque la ventana ya cerró, porque llegó al
  // final cuando todavía estaba abierta.
  revisar('y paga completo, no la mitad', g4.r.puntos_nuevos, clase.puntos_terminar);
  const [mt] = await dueno`select motivo from public.movimientos_puntos
     where matricula_id = ${mat.id} and motivo like ${'Terminó%'} order by id desc limit 1`;
  revisar('sin marca de atraso', mt.motivo.includes('fuera de plazo'), false);

  // ---------- 6. Sin ventana, nada cambia ----------

  console.log('\n6. Sin ventana definida no hay castigo nunca');
  await dueno`update public.clases set ventana_hasta = null,
                 publicada_desde = now() - interval '1 day' where id = ${clase.id}`;
  await limpiar();
  const s3 = await saldo();
  const [a3] = await como(alumno.id, (s) => s`select public.abrir_clase(${clase.id}::uuid) as r`);
  revisar('paga completo', a3.r.puntos_nuevos, clase.puntos_abrir);
  revisar('en ventana', a3.r.en_ventana, true);

  // ---------- 7. Lo que ve cada uno ----------

  console.log('\n7. Las vistas');
  const vAl = await como(alumno.id, (s) =>
    s`select en_ventana, ventana_hasta, factor_atrasado from public.mis_clases
       where id = ${clase.id}::uuid`);
  revisar('el alumno ve el estado de la ventana', vAl[0]?.en_ventana, true);
  const vDoc = await como(docente.id, (s) =>
    s`select codigo, abrieron, a_tiempo, terminaron, publicada from public.clases_que_dicto
       where id = ${clase.id}::uuid`);
  revisar('el docente ve su clase con estadísticas', vDoc[0]?.codigo, CODIGO);
  revisar('y cuántos la abrieron', typeof vDoc[0]?.abrieron, 'number');
  const vOtro = await como(alumno.id, (s) =>
    s`select count(*)::int as n from public.clases_que_dicto`);
  revisar('el alumno no ve la vista del docente', vOtro[0].n, 0);

} finally {
  // Se deja la clase como estaba, y al alumno de prueba sin progreso.
  await dueno`update public.clases
                 set publicada_desde = ${original.desde},
                     ventana_hasta   = ${original.hasta},
                     factor_atrasado = ${original.factor}
               where id = ${clase.id}`;
  await limpiar();
  console.log('\n(clase restaurada y alumno de prueba limpio)');
}

console.log(fallos === 0 ? '\nTodo bien: la ventana premia llegar a tiempo.'
                         : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
