/**
 * El modo reunión: encenderlo, el descuento en la tienda, y apagarlo.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-reunion.mjs
 *
 * Llama a las mismas funciones que llaman las acciones `reunion-*` de
 * `/api/docente`, con la misma identidad y el mismo rol `pulso_app` con RLS.
 *
 * ── Qué se vigila acá y por qué ──
 *
 * Un descuento toca el saldo de los alumnos, así que los modos de falla no son
 * cosméticos:
 *
 *   - **Que el descuento no se escape de la sección.** Es una reunión de un
 *     bloque; si alcanzara a las otras secciones de la asignatura, estaría
 *     regalando puntos a gente que ni sabe que hubo una reunión.
 *   - **Que se cobre lo que dice la pantalla.** La tienda calcula el precio
 *     rebajado en el navegador —`vitrina` se lee por la Data API y no se le puede
 *     agregar una columna sin quedarse sin precios un rato—, así que hay una
 *     fórmula en TypeScript y otra en SQL. Acá se comparan las dos sobre un rango
 *     de precios: si alguna se toca sin la otra, esto falla.
 *   - **Que la devolución devuelva lo pagado y no el precio de lista.** Canjear
 *     con 30% de descuento y cancelar sin descuento sería una máquina de fabricar
 *     puntos, y nadie lo notaría hasta que un alumno tuviera el doble que el resto.
 *   - **Que dos clics no dejen dos reuniones abiertas**, porque «terminar»
 *     cerraría una sola y la sección se quedaría con el descuento puesto.
 *
 * Deja el estado como estaba: cierra las reuniones que abrió y borra sus canjes.
 */
import { neon } from '@neondatabase/serverless';

const CORREO_ALUMNO = 'alumno.prueba@duocuc.cl';
const CORREO_DOCENTE = 'cr.calderons@profesor.duoc.cl';
const DESCUENTO = 30;

const dueno = neon(process.env.DATABASE_URL_OWNER);
const app = neon(process.env.DATABASE_URL_OWNER);

let fallos = 0;
const rev = (e, real, esp) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esp)}`));
};

/** Igual que `lib/identidad.mjs`: identidad a mano, local a la transacción. */
async function como(usuarioId, consulta) {
  const r = await app.transaction([
    app`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    app`set local role pulso_app`,
    consulta(app),
  ]);
  return r[2] ?? [];
}

async function debeFallar(etiqueta, usuarioId, consulta, contiene) {
  try {
    await como(usuarioId, consulta);
    fallos++;
    console.log(`  ✗ ${etiqueta}: no falló, y tenía que fallar`);
  } catch (e) {
    const ok = (e.message ?? '').includes(contiene);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: «${e.message}»` +
      (ok ? '' : `  ← esperaba que dijera «${contiene}»`));
  }
}

/**
 * La misma fórmula que `precioConDescuento` en `src/app/datos.service.ts`.
 * Copiada a propósito: es lo que se compara contra la de la base.
 */
const precioEnPantalla = (precio, descuento) =>
  !descuento || descuento <= 0 ? precio : Math.max(1, Math.floor((precio * (100 - descuento)) / 100));

// ---------- Preparación ----------

const [alumno] = await dueno`
  select u.id from public.usuarios u where lower(u.correo) = ${CORREO_ALUMNO}`;
if (!alumno) throw new Error(`No existe ${CORREO_ALUMNO}.`);
const [docente] = await dueno`
  select u.id from public.usuarios u where lower(u.correo) = ${CORREO_DOCENTE}`;
if (!docente) throw new Error(`No existe ${CORREO_DOCENTE}.`);

// La matrícula del alumno de prueba en un ramo que tenga tienda con precios.
const [m] = await dueno`
  select mt.id as matricula, s.id as seccion, s.codigo as seccion_codigo,
         a.id as asignatura, a.sigla, p.id as periodo
    from public.matriculas  mt
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
    join public.periodos    p on p.id = s.periodo_id
   where mt.perfil_id = ${alumno.id} and mt.activa
     and exists (select 1 from public.articulos ar
                  where ar.asignatura_id = a.id and ar.periodo_id = p.id
                    and ar.activo and ar.precio is not null)
   limit 1`;
if (!m) throw new Error('El alumno de prueba no tiene un ramo con artículos con precio.');

// Uno que **requiera aprobación**, a propósito: así el canje queda en
// `solicitado` y se puede cancelar, que es la única forma de comprobar que la
// devolución devuelve lo pagado y no el precio de lista. Un artículo al instante
// queda `entregado` y ya no se puede cancelar.
const [art] = await dueno`
  select ar.id, ar.nombre, ar.precio, ar.limite_por_alumno
    from public.articulos ar
   where ar.asignatura_id = ${m.asignatura} and ar.periodo_id = ${m.periodo}
     and ar.activo and ar.precio is not null and ar.stock is null
     and ar.requiere_aprobacion
   order by ar.precio asc
   limit 1`;
if (!art) throw new Error('No hay un artículo con precio, sin stock y con aprobación para probar.');

console.log(`Ramo ${m.sigla} · sección ${m.seccion_codigo}`);
console.log(`Artículo «${art.nombre}» · precio de lista ${art.precio}`);

/**
 * Deja la matrícula como estaba, y también lo que dejó una corrida que se murió.
 *
 * Todo lo que esta prueba escribe va **firmado**: los canjes con `NOTA` y los
 * puntos con `MOTIVO`. No es decoración: una corrida que revienta a medio camino
 * —un artículo que no se podía cancelar, por ejemplo— deja puntos regalados, y la
 * corrida siguiente calcula su marca de agua **por encima** de ellos, con lo que
 * quedan sumando para siempre y ninguna limpieza los ve. Ya pasó con el
 * laboratorio; acá se caza por la firma y no solo por la marca.
 */
const NOTA = 'prueba de reunión';
const MOTIVO = 'Prueba de modo reunión';

const limpiar = async () => {
  await dueno`update public.reuniones set fin = now()
               where seccion_id = ${m.seccion} and fin is null`;
  await dueno`delete from public.canjes
               where matricula_id = ${m.matricula}
                 and (articulo_id = ${art.id} or nota_alumno = ${NOTA})`;
};
await limpiar();
const [{ id: piso }] = await dueno`select coalesce(max(id),0) as id
   from public.movimientos_puntos where matricula_id = ${m.matricula}`;
const limpiarTodo = async () => {
  await limpiar();
  await dueno`delete from public.movimientos_puntos
               where matricula_id = ${m.matricula}
                 and (id > ${piso} or motivo = ${MOTIVO} or motivo like ${'%por reunión)'})`;
};
// Barrer antes de medir: si esta corrida arrastró lo de una anterior, el «saldo de
// antes» tiene que ser el ya limpio.
await limpiarTodo();

const saldo = async () => {
  const [r] = await dueno`select coalesce(sum(puntos),0)::int as p
     from public.movimientos_puntos where matricula_id = ${m.matricula}`;
  return r.p;
};
// El saldo con el que empezó todo: al final tiene que volver acá.
const saldoOriginal = await saldo();

// Que le alcance para canjear, pase lo que pase con su saldo real.
await dueno`insert into public.movimientos_puntos (matricula_id, puntos, motivo)
            values (${m.matricula}, ${art.precio * 3}, ${MOTIVO})`;

// ---------- Las dos fórmulas ----------

console.log('\nEl precio rebajado es el mismo en la base y en la pantalla');
const precios = [1, 2, 3, 7, 10, 33, 50, 55, 99, 100, 101, 250, 999];
const enBase = [];
for (const p of precios) {
  const [r] = await dueno`select public.precio_con_descuento(${p}::integer, ${DESCUENTO}::integer) as v`;
  enBase.push(r.v);
}
rev(`con ${DESCUENTO}% sobre ${precios.length} precios`,
  enBase, precios.map((p) => precioEnPantalla(p, DESCUENTO)));
const [sinDesc] = await dueno`select public.precio_con_descuento(100::integer, 0::integer) as v`;
rev('sin descuento no toca el precio', sinDesc.v, 100);
const [nulo] = await dueno`select public.precio_con_descuento(null::integer, 30::integer) as v`;
rev('un artículo sin precio sigue sin precio', nulo.v, null);
const [minimo] = await dueno`select public.precio_con_descuento(1::integer, 90::integer) as v`;
rev('nunca baja de 1 punto', minimo.v, 1);

// ---------- Sin reunión ----------

console.log('\nSin reunión');
const miReunion = async () => {
  const [{ r }] = await como(alumno.id, (s) =>
    s`select public.mi_reunion(${m.matricula}::uuid) as r`);
  return r;
};
let r0 = await miReunion();
rev('el alumno no ve reunión', r0.en_reunion, false);
rev('y el descuento es cero', r0.descuento, 0);
const [d0] = await dueno`select public.reunion_descuento(${m.seccion}::uuid) as v`;
rev('la sección no tiene descuento', d0.v, 0);

// ---------- Lo que no puede hacer un alumno ----------

console.log('\nLo que un alumno no puede hacer');
await debeFallar('no enciende la reunión', alumno.id, (s) =>
  s`select public.reunion_iniciar(${m.seccion}::uuid, 30::integer)`, 'no es de un ramo que dictes');
await debeFallar('no la apaga', alumno.id, (s) =>
  s`select public.reunion_terminar(${m.seccion}::uuid)`, 'no es de un ramo que dictes');

const [otra] = await dueno`
  select s.id from public.secciones s
   where s.id <> ${m.seccion}
     and not exists (select 1 from public.docente_asignaturas da
                      where da.asignatura_id = s.asignatura_id
                        and da.periodo_id = s.periodo_id
                        and da.docente_id = ${docente.id})
   limit 1`;
if (otra) {
  await debeFallar('el docente no enciende una sección que no dicta', docente.id, (s) =>
    s`select public.reunion_iniciar(${otra.id}::uuid, 30::integer)`, 'no es de un ramo que dictes');
} else {
  console.log('  · no hay una sección ajena para probarlo, me lo salto');
}

// ---------- Encenderla ----------

console.log('\nEncenderla');
const [{ r: inicio }] = await como(docente.id, (s) =>
  s`select public.reunion_iniciar(${m.seccion}::uuid, ${DESCUENTO}::integer) as r`);
rev('queda en reunión', inicio.en_reunion, true);
rev('no estaba encendida', inicio.ya_estaba, false);
rev('con el descuento pedido', inicio.descuento, DESCUENTO);

const r1 = await miReunion();
rev('el alumno la ve', r1.en_reunion, true);
rev('con su descuento', r1.descuento, DESCUENTO);
rev('y sabe desde cuándo', typeof r1.desde === 'string', true);

// Dos clics no dejan dos abiertas: «terminar» cerraría una sola y la sección se
// quedaría con el descuento puesto para siempre.
const [{ r: otraVez }] = await como(docente.id, (s) =>
  s`select public.reunion_iniciar(${m.seccion}::uuid, ${DESCUENTO}::integer) as r`);
rev('encenderla dos veces devuelve la que ya había', otraVez.ya_estaba, true);
const [abiertas] = await dueno`select count(*)::int as n from public.reuniones
   where seccion_id = ${m.seccion} and fin is null`;
rev('y hay una sola fila abierta', abiertas.n, 1);

// ---------- Que no se escape de la sección ----------

// La reunión es de un bloque y en un bloque hay una sección en sala. Si el
// descuento alcanzara a las demás, estaría regalando puntos a gente que ni sabe
// que hubo una reunión. Se miran **todas** las otras secciones, del mismo ramo y
// de los demás: el aislamiento tiene que valer para las dos cosas.
console.log('\nEl descuento no sale de la sección');
const vecinas = await dueno`
  select s.id, s.codigo, a.sigla,
         (s.asignatura_id = ${m.asignatura} and s.periodo_id = ${m.periodo}) as mismo_ramo
    from public.secciones   s
    join public.asignaturas a on a.id = s.asignatura_id
   where s.id <> ${m.seccion}`;
if (vecinas.length) {
  const otras = [];
  for (const v of vecinas) {
    const [x] = await dueno`select public.reunion_descuento(${v.id}::uuid) as v`;
    otras.push(x.v);
  }
  const delMismo = vecinas.filter((v) => v.mismo_ramo).length;
  rev(`las otras ${vecinas.length} secciones siguen en cero ` +
      `(${delMismo} del mismo ramo, ${vecinas.length - delMismo} de otros)`,
    otras, vecinas.map(() => 0));
  // Y desde el lado del alumno, que es el que importa: una matrícula de otra
  // sección no puede ver la reunión ni el descuento.
  const [ajena] = await dueno`
    select mt.id, u.id as usuario
      from public.matriculas mt
      join public.perfiles p on p.id = mt.perfil_id
      join public.usuarios u on u.id = p.id
     where mt.seccion_id <> ${m.seccion} and mt.activa
     limit 1`;
  if (ajena) {
    const [{ r }] = await como(ajena.usuario, (s) =>
      s`select public.mi_reunion(${ajena.id}::uuid) as r`);
    rev('un alumno de otra sección no la ve', r?.en_reunion, false);
    rev('ni tiene descuento', r?.descuento, 0);
  }
} else {
  console.log('  · no hay otras secciones con qué comparar');
}

// ---------- La tienda cobra lo rebajado ----------

console.log('\nLa tienda');
const esperado = precioEnPantalla(art.precio, DESCUENTO);
const antes = await saldo();
const [{ r: canje }] = await como(alumno.id, (s) =>
  s`select public.solicitar_canje(${m.matricula}::uuid, ${art.id}::uuid, ${NOTA}) as r`);
const [fila] = await dueno`select precio_pagado, estado from public.canjes where id = ${canje}`;
rev('cobra el precio rebajado, no el de lista', fila.precio_pagado, esperado);
rev('y es el mismo que muestra la pantalla', fila.precio_pagado, esperado);
rev('el saldo bajó exactamente eso', antes - await saldo(), esperado);
const [mov] = await dueno`select motivo, puntos from public.movimientos_puntos
   where matricula_id = ${m.matricula} order by id desc limit 1`;
rev('el movimiento deja constancia del descuento',
  mov.motivo.includes(`−${DESCUENTO}%`), true);

// La devolución tiene que devolver lo pagado. Si devolviera el precio de lista,
// canjear en reunión y cancelar después fabricaría puntos de la nada.
const conCanje = await saldo();
await como(alumno.id, (s) => s`select public.cancelar_canje(${canje}::bigint)`);
rev('cancelar devuelve lo pagado y no el precio de lista', await saldo() - conCanje, esperado);
rev('así que el saldo queda como antes del canje', await saldo(), antes);

// ---------- Apagarla ----------

console.log('\nApagarla');
const [{ r: fin }] = await como(docente.id, (s) =>
  s`select public.reunion_terminar(${m.seccion}::uuid) as r`);
rev('ya no está en reunión', fin.en_reunion, false);
rev('había una que cerrar', fin.no_habia, false);
rev('e informa cuánto duró', typeof fin.minutos === 'number', true);

const r2 = await miReunion();
rev('el alumno ya no la ve', r2.en_reunion, false);
rev('y el descuento volvió a cero', r2.descuento, 0);

const antes2 = await saldo();
const [{ r: canje2 }] = await como(alumno.id, (s) =>
  s`select public.solicitar_canje(${m.matricula}::uuid, ${art.id}::uuid, ${NOTA}) as r`);
const [fila2] = await dueno`select precio_pagado from public.canjes where id = ${canje2}`;
rev('la tienda vuelve a cobrar el precio de lista', fila2.precio_pagado, art.precio);
rev('y el saldo baja el precio entero', antes2 - await saldo(), art.precio);
await como(alumno.id, (s) => s`select public.cancelar_canje(${canje2}::bigint)`);

// Apagar lo apagado es el resultado que el docente quería, no una falla.
const [{ r: deNuevo }] = await como(docente.id, (s) =>
  s`select public.reunion_terminar(${m.seccion}::uuid) as r`);
rev('apagarla dos veces no revienta', deNuevo.no_habia, true);

// ---------- Que quede registro ----------

console.log('\nEl registro');
const [hist] = await dueno`select count(*)::int as n from public.reuniones
   where seccion_id = ${m.seccion} and fin is not null`;
rev('la reunión terminada queda en la historia', hist.n >= 1, true);

// ---------- Dejarlo como estaba ----------

await limpiarTodo();
rev('el saldo vuelve a como estaba', await saldo(), saldoOriginal);
const [colgadas] = await dueno`select count(*)::int as n from public.reuniones
   where seccion_id = ${m.seccion} and fin is null`;
rev('no queda ninguna reunión abierta', colgadas.n, 0);

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
