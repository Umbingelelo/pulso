/**
 * El gacha: que el sorteo respete los pesos y que nadie se ponga lo que no ganó.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-gacha.mjs [--tiradas 4000]
 *
 * ── Qué se vigila ──
 *
 * Un gacha es una promesa numérica. Si la pantalla dice que un mítico sale 1 de
 * cada 100 y en realidad sale 1 de cada 2.000, eso no falla en ninguna parte: los
 * alumnos simplemente nunca ven uno y nadie sabe por qué. Por eso el grueso de
 * esta prueba es **contar**: se tiran unos miles y se compara la frecuencia
 * observada con los pesos declarados.
 *
 * Y lo otro que se vigila es la puerta: que el avatar **no se pueda escribir por
 * la Data API**. Esa es la petición explícita —que solo puedan tener las imágenes
 * cargadas— y se sostiene con un grant por columna, así que hay que comprobar que
 * el grant esté puesto y no que la pantalla no ofrezca el botón.
 *
 * Deja el estado como estaba: todo corre sobre una matrícula de prueba y se borra.
 */
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] ?? true]);
    return a;
  }, []),
);
const N = Number(args.tiradas ?? 4000);
const CORREO = 'alumno.prueba@duocuc.cl';

const d = neon(process.env.DATABASE_URL_OWNER);
let fallos = 0;
const rev = (e, ok, detalle = '') => {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}${ok || !detalle ? '' : `\n      ${detalle}`}`);
};
async function como(usuarioId, consulta) {
  const r = await d.transaction([
    d`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    d`set local role pulso_app`,
    consulta(d),
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
      (ok ? '' : `  ← esperaba «${contiene}»`));
  }
}

// ---------- El pozo ----------

const pesos = await d`select rareza, peso, nombre from public.gacha_rarezas order by orden`;
const pozo = await d`select rareza, tipo, count(*)::int as n from public.cosmeticos
   where activo group by rareza, tipo order by rareza, tipo`;
const total = pozo.reduce((s, p) => s + p.n, 0);

console.log(`El pozo: ${total} cosméticos activos`);
for (const p of pesos) {
  const suyos = pozo.filter((x) => x.rareza === p.rareza);
  const n = suyos.reduce((s, x) => s + x.n, 0);
  const det = suyos.map((x) => `${x.n} ${x.tipo}`).join(' + ');
  console.log(`  ${p.nombre.padEnd(11)} peso ${String(p.peso).padStart(2)} · ${String(n).padStart(3)} ítems (${det || 'ninguno'})`);
}

console.log('\nEl pozo está sano');
rev('todas las rarezas tienen peso', pesos.length, 6);
const sinPeso = pozo.filter((p) => !pesos.some((x) => x.rareza === p.rareza));
rev('ninguna rareza usada se quedó sin peso', sinPeso.length === 0,
  sinPeso.map((p) => p.rareza).join(', '));
const vacias = pesos.filter((p) => !pozo.some((x) => x.rareza === p.rareza));
rev('ninguna rareza con peso quedó sin ítems', vacias.length === 0,
  `${vacias.map((p) => p.nombre).join(', ')} — se sortearían y no habría qué entregar`);

// Lo pedido para las imágenes: todas en la misma rareza, y por lo tanto con la
// misma probabilidad entre sí, porque dentro de una rareza el sorteo es uniforme.
const rarezasDeAvatar = pozo.filter((p) => p.tipo === 'avatar').map((p) => p.rareza);
rev('las imágenes están todas en una sola rareza', new Set(rarezasDeAvatar).size <= 1,
  `están en: ${[...new Set(rarezasDeAvatar)].join(', ')}`);

// ---------- La matrícula de prueba ----------

const [alumno] = await d`select id from public.usuarios where lower(correo) = ${CORREO}`;
if (!alumno) throw new Error(`No existe ${CORREO}.`);
const [m] = await d`select mt.id from public.matriculas mt where mt.perfil_id = ${alumno.id} and mt.activa limit 1`;
if (!m) throw new Error('El alumno de prueba no tiene matrícula activa.');

const MOTIVO = 'Prueba de gacha';

/**
 * Lo que el alumno tenía **antes** de que esta prueba tocara nada.
 *
 * La limpieza se hace contra esta foto y no por `origen`, porque las tiradas de
 * la prueba entran por la misma función que las de verdad y quedan marcadas
 * igual: `origen = 'gacha'`. Borrar por origen le quitaría lo que se ganó de
 * verdad. Y la marca de agua sobre `movimientos_tiradas` recupera además lo que
 * haya dejado una corrida que se murió a medias.
 */
const suyos = new Set((await d`select cosmetico_id from public.alumno_cosmeticos
   where matricula_id = ${m.id}`).map((r) => r.cosmetico_id));
const [{ id: piso }] = await d`select coalesce(max(id), 0) as id
   from public.movimientos_tiradas where matricula_id = ${m.id}`;

const limpiar = async () => {
  await d`delete from public.alumno_cosmeticos
           where matricula_id = ${m.id}
             and not (cosmetico_id = any(${[...suyos]}::uuid[]))`;
  await d`delete from public.movimientos_tiradas
           where matricula_id = ${m.id} and id > ${piso}`;
};
await limpiar();

// Las tiradas de verdad del alumno no se tocan: se anota cuántas tenía y al final
// tiene que quedar con las mismas.
const tiradasDe = async () => {
  const [r] = await d`select public.mis_tiradas(${m.id}::uuid) as n`;
  return r.n;
};
const antes = await tiradasDe();

// ---------- Sin tiradas no se tira ----------

console.log('\nLo que no se puede');
if (antes === 0) {
  await debeFallar('sin tiradas no se puede tirar', alumno.id, (s) =>
    s`select public.gacha_tirar(${m.id}::uuid)`, 'No te quedan tiradas');
} else {
  console.log(`  · el alumno tiene ${antes} tiradas de verdad, me salto esa comprobación`);
}

const [otra] = await d`select id from public.matriculas where id <> ${m.id} limit 1`;
if (otra) {
  await debeFallar('no se tira sobre la matrícula de otro', alumno.id, (s) =>
    s`select public.gacha_tirar(${otra.id}::uuid)`, 'no es tuya');
}

// ---------- El avatar no se escribe por la API ----------
// Es la petición explícita: solo las imágenes cargadas. Se comprueba el grant,
// que es lo que de verdad lo impide, y no que la pantalla no ofrezca el botón.

console.log('\nEl avatar no se elige a mano');
const [permisos] = await d`
  select bool_or(privilege_type = 'UPDATE' and column_name = 'avatar') as puede_avatar,
         bool_or(privilege_type = 'UPDATE' and column_name = 'nombre') as puede_nombre
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'perfiles' and grantee = 'pulso_app'`;
rev('pulso_app no puede escribir perfiles.avatar', permisos.puede_avatar !== true);
rev('pero sí sigue pudiendo cambiarse el nombre', permisos.puede_nombre === true);
await debeFallar('y el intento directo lo rechaza Postgres', alumno.id, (s) =>
  s`update public.perfiles set avatar = 'thumbs:trampa' where id = ${alumno.id}`,
  'permission denied');

const [ajeno] = await d`select id from public.cosmeticos where tipo = 'avatar' and activo
   and id not in (select cosmetico_id from public.alumno_cosmeticos where matricula_id = ${m.id})
   limit 1`;
if (ajeno) {
  await debeFallar('no se pone una cara que no ganó', alumno.id, (s) =>
    s`select public.equipar_cosmetico(${m.id}::uuid, ${ajeno.id}::uuid)`, 'Todavía no has ganado eso');
}

// ---------- El sorteo respeta los pesos ----------
//
// Se tira muchas veces sobre una matrícula que se limpia después. Como el gacha
// no repite, hay que devolverle el pozo entre tirada y tirada: si no, a las 320
// tiradas se acabaría y las frecuencias saldrían deformadas.

console.log(`\nEl sorteo, con ${N.toLocaleString('es')} tiradas`);
await d`insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
        values (${m.id}, ${N}, ${MOTIVO})`;

const cuenta = {};
for (let i = 0; i < N; i++) {
  const [{ r }] = await como(alumno.id, (s) => s`select public.gacha_tirar(${m.id}::uuid) as r`);
  cuenta[r.rareza] = (cuenta[r.rareza] ?? 0) + 1;
  // Devolver lo que salió, para que el pozo no se agote y el reparto se mida
  // sobre la distribución de verdad.
  await d`delete from public.alumno_cosmeticos
           where matricula_id = ${m.id} and cosmetico_id = ${r.id}`;
  if ((i + 1) % 1000 === 0) console.log(`  … ${i + 1}`);
}

const sumaPesos = pesos.reduce((s, p) => s + p.peso, 0);
let desviacionMayor = 0;
for (const p of pesos) {
  const esperado = (p.peso / sumaPesos) * N;
  const visto = cuenta[p.rareza] ?? 0;
  // Margen generoso: con 4.000 tiradas, la mítica esperada son 40 y su desviación
  // típica ~6, así que ±35% cubre el azar sin dejar pasar un peso mal aplicado
  // —que se vería como un 10x, no como un 20%—.
  const desvio = esperado ? Math.abs(visto - esperado) / esperado : 0;
  desviacionMayor = Math.max(desviacionMayor, desvio);
  const pct = ((visto / N) * 100).toFixed(1);
  const objetivo = ((p.peso / sumaPesos) * 100).toFixed(1);
  rev(`${p.nombre.padEnd(11)} ${pct}% (esperado ${objetivo}%)`, desvio < 0.35,
    `salió ${visto}, esperaba ~${Math.round(esperado)}`);
}
console.log(`  · desviación mayor: ${(desviacionMayor * 100).toFixed(1)}%`);

// ---------- Dejarlo como estaba ----------

await limpiar();
const despues = await tiradasDe();
rev('las tiradas del alumno vuelven a como estaban', despues === antes,
  `quedó con ${despues}, tenía ${antes}`);
const [colgados] = await d`select count(*)::int as n from public.alumno_cosmeticos
   where matricula_id = ${m.id}
     and not (cosmetico_id = any(${[...suyos]}::uuid[]))`;
rev('no le quedaron cosméticos de la prueba', colgados.n === 0, `quedaron ${colgados.n}`);

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
