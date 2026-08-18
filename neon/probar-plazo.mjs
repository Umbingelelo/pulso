/**
 * El plazo de los puntos: hacer el laboratorio en su semana paga, después no.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-plazo.mjs [--sigla ITY1102]
 *
 * ── Qué se vigila ──
 *
 * Lo obvio —dentro paga, fuera no— y sobre todo las cuatro cosas que se rompen
 * solas si alguien toca esto más adelante:
 *
 *   * **La entrega fuera de plazo se registra igual.** No pagar y no dejar entregar
 *     son cosas distintas. Si esto se convierte en un `raise`, el alumno que se
 *     atrasó una vez queda con el laboratorio congelado a medias.
 *   * **Y desbloquea el desafío opcional.** El candado de la 0026 mira la fila de
 *     `resultados_actividad`, no los puntos. Es el caso 4 y es la razón concreta de
 *     por qué no se bloquea la entrega.
 *   * **Lo que dice la pantalla es lo que se pagó.** `laboratorio_entregar` devolvía
 *     `a.puntos` fijo; con plazo eso sería una cifra inventada y el alumno la iría a
 *     buscar a su saldo.
 *   * **Antes de `puntua_desde` tampoco paga.** Los dos lados del plazo, no solo el
 *     de la fecha de cierre.
 *
 * Deja el estado como estaba: las fechas de la actividad y el alumno de prueba sin
 * avance, sin resultado y sin los movimientos que se le pagaron acá.
 */
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] ?? true]);
    return a;
  }, []),
);
const SIGLA = args.sigla ?? 'ITY1102';
const CORREO = args.correo ?? 'alumno.prueba@duocuc.cl';

const dueno = neon(process.env.DATABASE_URL_OWNER);
const app = neon(process.env.DATABASE_URL_OWNER);

let fallos = 0;
function revisar(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`));
}

/** Como en el resto de las pruebas: identidad puesta y rol `pulso_app` adoptado. */
async function como(usuarioId, consulta) {
  const r = await app.transaction([
    app`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    app`set local role pulso_app`,
    consulta(app),
  ]);
  return r[2] ?? [];
}

// ============================== Con qué se prueba ==============================

const [alumno] = await dueno`select id from public.usuarios where lower(correo) = ${CORREO}`;
if (!alumno) { console.error(`No existe el alumno de prueba ${CORREO}`); process.exit(1); }

/**
 * El par (oficial, opcional) se **descubre** en vez de venir por argumento: el
 * opcional es el que declara `requiere`, y el oficial es lo que requiere. Así la
 * prueba sigue sirviendo cuando cambien los códigos, que es lo que ya pasó una vez
 * con las cajas huérfanas.
 */
const [par] = await dueno`
  select req.id as oficial_id, req.codigo as oficial, req.titulo as oficial_titulo,
         req.puntos as oficial_puntos,
         req.puntua_desde, req.puntua_hasta,
         req.asignatura_id, req.periodo_id,
         a.id as opcional_id, a.codigo as opcional
    from public.laboratorios l
    join public.actividades   a   on a.id = l.actividad_id
    join public.actividades   req on req.codigo = l.requiere
                                 and req.asignatura_id = a.asignatura_id
                                 and req.periodo_id    = a.periodo_id
    join public.asignaturas   asg on asg.id = a.asignatura_id
   where asg.sigla = ${SIGLA} and l.requiere is not null and a.activa and req.activa
   limit 1`;
if (!par) {
  console.error(`No encontré un laboratorio con «requiere» en ${SIGLA}. ` +
    'Sube uno opcional o pasa otra --sigla.');
  process.exit(1);
}

/**
 * El docente se resuelve por lo que **dicta**, no por su correo: buscarlo con un
 * `like '%profesor%'` puede devolver a uno que no tenga esta asignatura, y entonces
 * los casos del panel fallarían por la razón equivocada —`docente_ve_actividad`
 * diciendo la verdad— y parecerían un error del plazo.
 */
const [docente] = await dueno`
  select da.docente_id as id from public.docente_asignaturas da
   where da.asignatura_id = ${par.asignatura_id} and da.periodo_id = ${par.periodo_id}
   limit 1`;

const [mat] = await dueno`
  select mt.id from public.matriculas mt
    join public.usuarios    u on u.id = mt.perfil_id
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
   where lower(u.correo) = ${CORREO} and a.sigla = ${SIGLA}`;
if (!mat) { console.error(`El alumno de prueba no está matriculado en ${SIGLA}`); process.exit(1); }

/** Una caja de verdad del enunciado: entregar en blanco lo rechaza la propia función. */
const [caja] = await dueno`
  select b->>'id' as id
    from public.laboratorios l, jsonb_array_elements(l.bloques) b
   where l.actividad_id = ${par.oficial_id} and b->>'tipo' = 'caja'
   limit 1`;
if (!caja) { console.error(`El laboratorio ${par.oficial} no tiene cajas`); process.exit(1); }

const original = { desde: par.puntua_desde, hasta: par.puntua_hasta };

const saldo = async () => (await dueno`
  select coalesce(sum(puntos),0)::int as s from public.movimientos_puntos
   where matricula_id = ${mat.id}`)[0].s;

/** Borra todo rastro de las dos actividades para este alumno. */
async function limpiar() {
  for (const id of [par.oficial_id, par.opcional_id]) {
    await dueno`delete from public.resultados_actividad
                 where matricula_id = ${mat.id} and actividad_id = ${id}`;
    await dueno`delete from public.laboratorio_avance
                 where matricula_id = ${mat.id} and actividad_id = ${id}`;
  }
  await dueno`delete from public.movimientos_puntos
               where matricula_id = ${mat.id} and motivo = ${par.oficial_titulo}`;
}

/** El plazo, puesto a la bruta por el dueño: los casos van más rápido así. */
async function plazo(desde, hasta) {
  await dueno`update public.actividades
                 set puntua_desde = ${desde}, puntua_hasta = ${hasta}
               where id = ${par.oficial_id}`;
}

/** El alumno escribe una caja y entrega. Devuelve lo que contestó la base. */
async function entregar(codigo) {
  await como(alumno.id, (s) =>
    s`select public.laboratorio_guardar(${mat.id}::uuid, ${codigo},
              ${JSON.stringify({ [caja.id]: 'Respuesta de prueba.' })}::jsonb, 0::integer) as r`);
  const [r] = await como(alumno.id, (s) =>
    s`select public.laboratorio_entregar(${mat.id}::uuid, ${codigo}) as r`);
  return r.r;
}

const ahora = Date.now();
const enUnaHora = new Date(ahora + 3_600_000).toISOString();
const haceUnaHora = new Date(ahora - 3_600_000).toISOString();
const haceDosHoras = new Date(ahora - 7_200_000).toISOString();
const enDosHoras = new Date(ahora + 7_200_000).toISOString();

console.log(`Laboratorio ${SIGLA}/${par.oficial} · ${par.oficial_puntos} puntos ` +
  `· caja «${caja.id}»`);
console.log(`Desafío     ${par.opcional}, se abre al entregar ${par.oficial}\n`);

try {
  // ---------- 1. Dentro del plazo ----------

  console.log('1. Dentro del plazo, paga completo');
  await limpiar();
  await plazo(haceUnaHora, enUnaHora);
  const s0 = await saldo();
  const e1 = await entregar(par.oficial);
  revisar('dice que fue a tiempo', e1.a_tiempo, true);
  revisar('devuelve los puntos del laboratorio', e1.puntos, par.oficial_puntos);
  revisar('y el saldo subió eso mismo', (await saldo()) - s0, par.oficial_puntos);

  // ---------- 2. Después del cierre ----------

  console.log('\n2. Después del cierre, no paga');
  await limpiar();
  await plazo(haceDosHoras, haceUnaHora);
  const s1 = await saldo();
  const e2 = await entregar(par.oficial);
  revisar('dice que NO fue a tiempo', e2.a_tiempo, false);
  revisar('devuelve cero puntos', e2.puntos, 0);
  revisar('y el saldo no se movió', (await saldo()) - s1, 0);
  // La razón de todo el diseño: no pagar no es no registrar.
  revisar('pero la entrega quedó registrada', e2.entregado, true);
  const [reg] = await dueno`
    select detalle->>'a_tiempo' as a_tiempo from public.resultados_actividad
     where matricula_id = ${mat.id} and actividad_id = ${par.oficial_id}`;
  revisar('con el atraso anotado en el detalle', reg?.a_tiempo, 'false');

  // ---------- 3. Antes de que empiece ----------

  console.log('\n3. Antes de que empiece a pagar, tampoco paga');
  await limpiar();
  await plazo(enUnaHora, enDosHoras);
  const s2 = await saldo();
  const e3 = await entregar(par.oficial);
  revisar('dice que NO fue a tiempo', e3.a_tiempo, false);
  revisar('y el saldo no se movió', (await saldo()) - s2, 0);

  // ---------- 4. El desafío opcional se abre igual ----------

  console.log('\n4. Entregar fuera de plazo abre el desafío opcional');
  // Sin limpiar: se aprovecha la entrega atrasada del caso 3, que es justo el
  // estado que importa. Si el candado mirara los puntos en vez de la fila, acá
  // el alumno se quedaría sin ningún desafío por haberse atrasado una vez.
  const [falta] = await dueno`
    select public.laboratorio_falta(${mat.id}::uuid, ${par.opcional_id}::uuid) as f`;
  revisar('el candado del desafío está abierto', falta.f, null);
  const vista = await como(alumno.id, (s) =>
    s`select public.mi_laboratorio(${mat.id}::uuid, ${par.opcional}) as r`);
  revisar('y el enunciado del desafío ya baja',
    Array.isArray(vista[0]?.r?.bloques) && vista[0].r.bloques.length > 0, true);

  // ---------- 5. Sin plazo, como antes ----------

  console.log('\n5. Sin plazo paga siempre, como antes de la 0028');
  await limpiar();
  await plazo(null, null);
  const s3 = await saldo();
  const e5 = await entregar(par.oficial);
  revisar('dice que fue a tiempo', e5.a_tiempo, true);
  revisar('y pagó completo', (await saldo()) - s3, par.oficial_puntos);

  // ---------- 6. Lo que ve el alumno antes de entregar ----------

  console.log('\n6. El alumno ve el plazo antes de entregar, no después');
  await limpiar();
  await plazo(haceDosHoras, haceUnaHora);
  const ver = await como(alumno.id, (s) =>
    s`select public.mi_laboratorio(${mat.id}::uuid, ${par.oficial}) as r`);
  revisar('mi_laboratorio dice que está fuera de plazo', ver[0]?.r?.en_plazo, false);
  revisar('y manda la fecha de cierre', !!ver[0]?.r?.puntua_hasta, true);
  const lista = await como(alumno.id, (s) =>
    s`select codigo, en_plazo from public.mis_laboratorios(${mat.id}::uuid)
       where codigo = ${par.oficial}`);
  revisar('mis_laboratorios dice lo mismo', lista[0]?.en_plazo, false);

  await plazo(haceUnaHora, enUnaHora);
  const ver2 = await como(alumno.id, (s) =>
    s`select public.mi_laboratorio(${mat.id}::uuid, ${par.oficial}) as r`);
  revisar('y dentro del plazo dice que sí', ver2[0]?.r?.en_plazo, true);

  // ---------- 7. El docente administra las fechas desde la app ----------

  console.log('\n7. El docente pone el plazo desde el panel');
  if (!docente) {
    console.log('  · no encontré un usuario docente, me salto el caso');
  } else {
    const [amb] = await dueno`
      select asignatura_id, periodo_id, codigo, titulo, descripcion, tipo, puntos, orden, activa
        from public.actividades where id = ${par.oficial_id}`;
    const guardar = (desde, hasta) => como(docente.id, (s) =>
      s`select public.actividad_guardar(
          ${par.oficial_id}::uuid, ${amb.asignatura_id}::uuid, ${amb.periodo_id}::uuid,
          ${amb.codigo}, ${amb.titulo}, ${amb.descripcion}, ${amb.tipo},
          ${amb.puntos}::integer, ${amb.orden}::integer, ${amb.activa},
          ${desde}::timestamptz, ${hasta}::timestamptz) as r`);

    await guardar(haceDosHoras, haceUnaHora);
    const [tras] = await dueno`
      select puntua_hasta from public.actividades where id = ${par.oficial_id}`;
    revisar('guardó la fecha de cierre', !!tras.puntua_hasta, true);
    const [ep] = await dueno`
      select public.actividad_en_plazo(${par.oficial_id}::uuid) as e`;
    revisar('y la actividad quedó fuera de plazo', ep.e, false);

    // Quitar el plazo es dejar los dos campos nulos. Si esto empezara a hacer
    // `coalesce`, el docente no podría deshacer una fecha mal puesta.
    await guardar(null, null);
    const [sin] = await dueno`
      select puntua_desde, puntua_hasta from public.actividades where id = ${par.oficial_id}`;
    revisar('y se puede quitar el plazo', [sin.puntua_desde, sin.puntua_hasta], [null, null]);

    console.log('\n8. Lo que no se puede hacer');
    try {
      await guardar(enUnaHora, haceUnaHora);
      revisar('un plazo al revés se rechaza', 'lo dejó pasar', 'rechazado');
    } catch (e) {
      revisar('un plazo al revés se rechaza',
        /termina antes de empezar/.test(e.message), true);
    }

    try {
      await como(alumno.id, (s) =>
        s`select public.actividad_guardar(
            ${par.oficial_id}::uuid, ${amb.asignatura_id}::uuid, ${amb.periodo_id}::uuid,
            ${amb.codigo}, ${amb.titulo}, ${amb.descripcion}, ${amb.tipo},
            ${amb.puntos}::integer, ${amb.orden}::integer, ${amb.activa},
            null::timestamptz, null::timestamptz) as r`);
      revisar('un alumno no puede mover el plazo', 'lo dejó pasar', 'rechazado');
    } catch (e) {
      revisar('un alumno no puede mover el plazo',
        /no es de un curso que dictes/.test(e.message), true);
    }

    console.log('\n9. El conteo que delata un plazo mal puesto');
    await limpiar();
    await plazo(haceDosHoras, haceUnaHora);
    await entregar(par.oficial);
    const filas = await como(docente.id, (s) =>
      s`select codigo, entregas, a_tiempo, en_plazo
          from public.actividades_que_dicto(${amb.asignatura_id}::uuid, ${amb.periodo_id}::uuid)
         where codigo = ${par.oficial}`);
    revisar('cuenta la entrega', filas[0]?.entregas >= 1, true);
    revisar('y no la cuenta como a tiempo', filas[0]?.a_tiempo < filas[0]?.entregas, true);
    revisar('y dice que el plazo está cerrado', filas[0]?.en_plazo, false);
  }

} finally {
  await plazo(original.desde, original.hasta);
  await limpiar();
  console.log('\n(plazo restaurado y alumno de prueba limpio)');
}

console.log(fallos === 0 ? '\nTodo bien: el laboratorio paga en su semana y no después.'
                         : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
