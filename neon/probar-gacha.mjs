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

// ---------- El reparto de rarezas de las imágenes ----------
//
// Hasta la 0035 las imágenes eran **todas comunes**, y eso tenía sentido con un
// pozo único: dentro de una rareza el sorteo es uniforme, así que compartir
// rareza era lo que les daba a las 220 la misma probabilidad entre sí.
//
// Con el pozo de imágenes aparte, esa misma decisión deja el sorteo sin nada que
// anunciar: cada tirada de imagen saldría en gris. Ahora la rareza se deriva del
// md5 del código —`rareza_de_imagen`— y lo que hay que vigilar es otra cosa.
//
// Se miran solo las sacables: las del pase están fuera del sorteo, y su rareza se
// puso a mano —René Puente es legendaria por ser el premio final del semestre—,
// así que recalcularla sería pisarla.

console.log('\nEl reparto de rarezas de las imágenes');

const imagenes = await d`
  select c.codigo, c.rareza, public.rareza_de_imagen(c.codigo) as toca
    from public.cosmeticos c
   where c.activo and c.tipo = 'avatar'
     and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id)`;

// El invariante que de verdad importa, y no el recuento exacto: el recuento
// cambia en cuanto el docente sube una imagen más, pero esto tiene que seguir
// valiendo siempre. Es lo que atrapa una corrida de `subir-cosmeticos.mjs` que
// vuelva a dejarlas todas comunes.
const desalineadas = imagenes.filter((i) => i.rareza !== i.toca);
rev('cada imagen tiene la rareza que le toca por su código',
  desalineadas.length === 0,
  `${desalineadas.length} desalineadas, p. ej. ${desalineadas.slice(0, 3)
    .map((i) => `${i.codigo}: es ${i.rareza} y toca ${i.toca}`).join(' · ')}`);

const porRarezaImg = {};
for (const i of imagenes) porRarezaImg[i.rareza] = (porRarezaImg[i.rareza] ?? 0) + 1;
for (const p of pesos) {
  const n = porRarezaImg[p.rareza] ?? 0;
  console.log(`  ${p.nombre.padEnd(11)} ${String(n).padStart(3)} imágenes` +
    ` (${((n / imagenes.length) * 100).toFixed(1)}%)`);
}

// Una rareza con uno o dos ítems se agota en la primera tirada y desaparece del
// pozo: el peso se reparte entre las demás y la promesa de la pantalla deja de
// cumplirse a mitad de semestre. Tres es el piso.
const flacas = pesos.filter((p) => (porRarezaImg[p.rareza] ?? 0) < 3);
rev('ninguna rareza del pozo de imágenes quedó con menos de tres',
  flacas.length === 0,
  flacas.map((p) => `${p.nombre}: ${porRarezaImg[p.rareza] ?? 0}`).join(', '));

// Y las del pase conservan la suya, que se puso a mano.
const [rene] = await d`select rareza from public.cosmeticos where codigo = 'avatar-loco-rene'`;
if (rene) {
  rev('el premio final del pase sigue siendo legendario', rene.rareza === 'legendaria',
    `quedó ${rene.rareza}`);
}

// ---------- La matrícula de prueba ----------

const [alumno] = await d`select id from public.usuarios where lower(correo) = ${CORREO}`;
if (!alumno) throw new Error(`No existe ${CORREO}.`);
const [m] = await d`select mt.id from public.matriculas mt where mt.perfil_id = ${alumno.id} and mt.activa limit 1`;
if (!m) throw new Error('El alumno de prueba no tiene matrícula activa.');

const MOTIVO = 'Prueba de gacha';
const MOTIVO_SALDO = 'Prueba de gacha: saldo para canjear';

/**
 * Barrer lo que dejó una corrida que se murió a medias, **antes** de tomar la foto.
 *
 * Esto existe por una falla de la limpieza anterior, y la falla es del tipo peor:
 * hacía que la prueba **informara verde estando sucia**.
 *
 * La limpieza era solo por marca de agua —`max(id)` de `movimientos_tiradas` al
 * arrancar, más la foto de los cosméticos— y las dos cosas se recalculan en cada
 * corrida. Así que lo que quedaba de una corrida muerta pasaba a ser la línea base de
 * la siguiente, y los chequeos del final —«las tiradas vuelven a como estaban», «no le
 * quedaron cosméticos de la prueba»— comparaban contra el estado ya contaminado y
 * pasaban. Encima el +1 del canje y el −1 de la tirada se cancelan, así que el saldo
 * tampoco delataba nada.
 *
 * Y pasó de verdad: quedaron colgados desde el 8 de septiembre un canje de «Una tirada
 * de gacha», su cobro de −150 puntos, dos filas de `movimientos_tiradas` y el título
 * «El Último Romántico del Carrete». Cuatro corridas seguidas dijeron «Todo bien».
 *
 * ── Por qué la fila con `MOTIVO` es la marca de agua y no `max(id)` ──
 *
 * No se puede barrer por `origen = 'gacha'` ni por `motivo like 'Tirada: %'`: las
 * tiradas de la prueba entran por la misma función que las de verdad y quedan marcadas
 * igual, así que eso le quitaría al alumno lo que se ganó jugando.
 *
 * Pero la fila con `MOTIVO` **solo la escribe esta prueba**. Si está ahí, es que una
 * corrida no llegó al final, y su `creado_en` es el momento exacto desde el cual todo lo
 * que calce con las firmas de la prueba es residuo. Eso es lo que la vuelve una marca de
 * agua honesta: la pone la prueba, no el reloj de nadie más.
 */
const barrer = async () => {
  const [resto] = await d`select min(creado_en) as desde
     from public.movimientos_tiradas
    where matricula_id = ${m.id} and motivo in (${MOTIVO}, ${MOTIVO_SALDO})`;
  if (!resto?.desde) return;

  const desde = resto.desde;
  // Solo lo que calza con lo que esta prueba escribe, y solo desde esa marca en
  // adelante. Un canje de verdad del alumno hecho después no lleva estas firmas.
  const canjes = await d`
    delete from public.canjes c
     using public.articulos a
     where a.id = c.articulo_id and c.matricula_id = ${m.id}
       and a.codigo = 'gacha-tirada' and c.creado_en >= ${desde}
    returning c.id`;
  const puntos = await d`
    delete from public.movimientos_puntos
     where matricula_id = ${m.id}
       and (motivo = ${MOTIVO_SALDO}
            or (creado_en >= ${desde} and motivo = 'Canje: Una tirada de gacha'))
    returning id`;
  const cosmeticos = await d`
    delete from public.alumno_cosmeticos
     where matricula_id = ${m.id} and origen = 'gacha' and obtenido_en >= ${desde}
    returning cosmetico_id`;
  const tiradas = await d`
    delete from public.movimientos_tiradas
     where matricula_id = ${m.id}
       and (motivo in (${MOTIVO}, ${MOTIVO_SALDO})
            or (creado_en >= ${desde}
                and (motivo like 'Tirada: %' or motivo like 'Canje #%: Una tirada de gacha')))
    returning id`;

  console.log(`\nBarrí lo que dejó una corrida anterior (desde ${desde.toISOString()}):`);
  console.log(`  ${canjes.length} canjes · ${puntos.length} movimientos de puntos` +
    ` · ${cosmeticos.length} cosméticos · ${tiradas.length} movimientos de tiradas`);
};
await barrer();

/**
 * Lo que el alumno tenía **antes** de que esta prueba tocara nada.
 *
 * La foto se toma después de barrer, así que ahora sí es la línea base de verdad.
 * Dentro de la corrida la marca de agua sigue sirviendo: `limpiar()` es lo que se
 * llama al final, y lo que se le escape lo recoge el `barrer()` de la próxima.
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

// ---------- Lo del pase no sale en el gacha ----------
// Un premio del pase que además salga tirando deja de ser un premio, y el alumno
// que se esforzó por llegar al nivel 30 ve a otro con lo mismo por suerte.

console.log('\nLo del pase es del pase');
const delPase = await d`select distinct cosmetico_id from public.pase_recompensas
   where cosmetico_id is not null`;
const idsPase = new Set(delPase.map((r) => r.cosmetico_id));
rev('hay cosméticos asignados al pase', idsPase.size > 0, `${idsPase.size}`);

const [pozoGacha] = await d`
  select count(*)::int as n from public.cosmeticos c
   where c.activo and exists (select 1 from public.pase_recompensas pr
                               where pr.cosmetico_id = c.id)`;
rev('la colección los sigue mostrando, marcados', pozoGacha.n > 0, `${pozoGacha.n}`);

// La comprobación que importa: se marca todo como no-obtenido y se tira muchas
// veces; ninguno de los del pase puede aparecer.
const [{ n: sacables }] = await d`
  select count(*)::int as n from public.cosmeticos c
   where c.activo
     and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id)`;
console.log(`  · ${sacables} sacables en el gacha · ${idsPase.size} solo en el pase`);

// Lo que la colección ofrece tiene que ser lo que el pozo tiene, y eso estuvo
// mal hasta la 0036: `mis_cosmeticos` calculaba `del_pase` **por ramo** y
// `gacha_tirar` excluye lo del pase de **cualquier** ramo, así que el filtro
// «Puedo sacarlo» ofrecía 15 imágenes y 14 títulos que el pozo no tenía. El
// alumno tiraba doscientas veces esperando algo que no estaba.
//
// Se revisa sobre **todas** las matrículas del alumno de prueba, y ahí está la
// gracia: con una sola no se habría notado nunca, porque el desajuste son
// justamente los premios del pase del *otro* ramo.
const mias = await d`select mt.id, a.sigla from public.matriculas mt
   join public.secciones s on s.id = mt.seccion_id
   join public.asignaturas a on a.id = s.asignatura_id
  where mt.perfil_id = ${alumno.id} and mt.activa`;
rev('el alumno de prueba tiene más de un ramo, que es lo que lo destapa',
  mias.length > 1, `tiene ${mias.length}`);
for (const mia of mias) {
  const [pantalla] = await como(alumno.id, (s) => s`
    select count(*) filter (where tipo = 'avatar')::int as img,
           count(*) filter (where tipo = 'titulo')::int as tit
      from public.mis_cosmeticos(${mia.id}::uuid) where not tengo and not del_pase`);
  const [pozo] = await d`
    select count(*) filter (where c.tipo = 'avatar')::int as img,
           count(*) filter (where c.tipo = 'titulo')::int as tit
      from public.cosmeticos c
     where c.activo
       and not exists (select 1 from public.alumno_cosmeticos ac
                        where ac.matricula_id = ${mia.id} and ac.cosmetico_id = c.id)
       and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id)`;
  rev(`${mia.sigla}: lo que la colección ofrece es lo que el pozo tiene`,
    pantalla.img === pozo.img && pantalla.tit === pozo.tit,
    `la pantalla ofrece ${pantalla.img} imágenes y ${pantalla.tit} títulos,` +
    ` y el pozo tiene ${pozo.img} y ${pozo.tit}`);
}

// ---------- Ni el gacha ni el pase pagan puntos ----------
// Los puntos son de las actividades y se gastan en la tienda. Que el gacha o el
// pase los repartieran haría que dos economías separadas se mezclaran, y que
// alguien pudiera farmear la tienda tirando.

console.log('\nNi el gacha ni el pase pagan puntos');
const puntosDe = async () => {
  const [r] = await d`select coalesce(sum(puntos),0)::int as p
     from public.movimientos_puntos where matricula_id = ${m.id}`;
  return r.p;
};
const puntosAntes = await puntosDe();

// Por `como()` y no como dueño: `mi_pase` comprueba que la matrícula sea suya.
const [{ r: sinPuntos }] = await como(alumno.id, (s) =>
  s`select public.mi_pase(${m.id}::uuid) as r`);
rev('mi_pase ya no promete puntos por el XP sobrante',
  sinPuntos === null || !('puntos_por_sobrante' in sinPuntos),
  JSON.stringify(Object.keys(sinPuntos ?? {})));
rev('la columna xp_por_punto ya no existe',
  (await d`select count(*)::int as n from information_schema.columns
     where table_schema='public' and table_name='pases' and column_name='xp_por_punto'`)[0].n === 0);

// ---------- Ningún sacable queda fuera de los dos pozos ----------
//
// Los pozos filtran por tipo, así que un cosmético sacable que no sea imagen ni
// título **no saldría en ninguno de los dos** y quedaría inalcanzable sin que
// nada falle. Hoy los tres marcos son todos del pase, así que no se pierde nada;
// esto es lo que avisa el día que se suba uno que no lo sea.

console.log('\nLos dos pozos cubren todo');
const huerfanos = await d`
  select c.codigo, c.tipo from public.cosmeticos c
   where c.activo and c.tipo not in ('avatar', 'titulo')
     and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id)`;
rev('todo lo sacable es imagen o título', huerfanos.length === 0,
  `${huerfanos.map((h) => `${h.codigo} (${h.tipo})`).join(', ')} — no saldría en ningún pozo`);

await debeFallar('un pozo que no existe se rechaza', alumno.id, (s) =>
  s`select public.gacha_tirar(${m.id}::uuid, 'cualquiera')`, 'Ese pozo no existe');

// ---------- El sorteo respeta los pesos, en cada pozo ----------
//
// Desde la 0035 hay dos pozos y una sola moneda, así que se mide **cada pozo por
// separado** y con las tiradas repartidas entre los dos. Medir el promedio de
// ambos escondería que uno está torcido: si el de imágenes entregara siempre
// común y el de títulos compensara, el total seguiría cuadrando con los pesos.
//
// Se tira sobre una matrícula que se limpia después. Como el gacha no repite, hay
// que devolverle el pozo entre tirada y tirada: si no, a las pocas decenas se
// acabaría y las frecuencias saldrían deformadas.

const POR_POZO = Math.floor(N / 2);
await d`insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
        values (${m.id}, ${POR_POZO * 2 + 3}, ${MOTIVO})`;

const salieronDelPase = [];

/** Tira `n` veces en un pozo y cuenta lo que salió, por rareza y por tipo. */
async function sortear(pozo, n) {
  const cuenta = {}; const tipos = {};
  for (let i = 0; i < n; i++) {
    const [{ r }] = await como(alumno.id, (s) =>
      s`select public.gacha_tirar(${m.id}::uuid, ${pozo}) as r`);
    cuenta[r.rareza] = (cuenta[r.rareza] ?? 0) + 1;
    tipos[r.tipo] = (tipos[r.tipo] ?? 0) + 1;
    if (idsPase.has(r.id)) salieronDelPase.push(r.nombre);
    // Devolver lo que salió, para que el pozo no se agote y el reparto se mida
    // sobre la distribución de verdad.
    await d`delete from public.alumno_cosmeticos
             where matricula_id = ${m.id} and cosmetico_id = ${r.id}`;
    if ((i + 1) % 1000 === 0) console.log(`  … ${i + 1}`);
  }
  return { cuenta, tipos };
}

/**
 * El margen se calcula, no se fija a ojo.
 *
 * La primera versión usaba un ±35% para todas las rarezas y **fallaba por azar**:
 * con 600 tiradas la mítica se espera 6 veces, y ±35% son ±2,1 — más angosto que
 * una sola desviación típica, así que una corrida normal la hacía fallar.
 *
 * Cada rareza es un binomial de `n` intentos con probabilidad `p`, así que su
 * desviación típica es `√(n·p·(1−p))`. Se admiten cuatro: la probabilidad de que
 * una corrida sana se salga de ahí es ínfima, y en cambio un peso mal aplicado se
 * ve como el doble o el triple, no como un 20%. El piso de 3 evita que una
 * esperanza chiquita deje un margen de cero.
 *
 * Una prueba que falla por azar es peor que no tenerla: se aprende a ignorarla, y
 * el día que la falla es de verdad, nadie la mira.
 *
 * `presentes` es la parte que no se puede omitir: si a un pozo le falta una
 * rareza, su peso se reparte entre las que quedan y comparar contra los pesos
 * declarados haría fallar la prueba por algo que está bien.
 */
function revisarPesos(cuenta, n, presentes) {
  const suyos = pesos.filter((p) => presentes.has(p.rareza));
  const suma = suyos.reduce((s, p) => s + p.peso, 0);
  for (const p of suyos) {
    const prob = p.peso / suma;
    const esperado = prob * n;
    const margen = Math.max(4 * Math.sqrt(n * prob * (1 - prob)), 3);
    const visto = cuenta[p.rareza] ?? 0;
    rev(`${p.nombre.padEnd(11)} ${((visto / n) * 100).toFixed(1)}%` +
        ` (esperado ${(prob * 100).toFixed(1)}%)`,
      Math.abs(visto - esperado) <= margen,
      `salió ${visto}, esperaba ${esperado.toFixed(1)} ± ${margen.toFixed(1)}`);
  }
  if (suyos.length < pesos.length) {
    console.log(`  · a este pozo le faltan ${pesos.filter((p) => !presentes.has(p.rareza))
      .map((p) => p.nombre).join(', ')}: los pesos se renormalizan entre las que quedan`);
  }
  const ciegas = suyos.filter((p) => {
    const prob = p.peso / suma;
    return Math.max(4 * Math.sqrt(n * prob * (1 - prob)), 3) >= prob * n;
  });
  if (ciegas.length) {
    console.log(`  · con ${n} tiradas no distinguiría un peso al doble en: ` +
      `${ciegas.map((p) => p.nombre).join(', ')}. Para eso, --tiradas 8000`);
  }
}

/** Las rarezas que ese pozo tiene de verdad, que son las que pueden salir. */
async function rarezasDe(tipo) {
  const r = await d`
    select distinct c.rareza from public.cosmeticos c
     where c.activo and c.tipo = ${tipo}
       and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id)`;
  return new Set(r.map((x) => x.rareza));
}

for (const pozo of ['imagen', 'titulo']) {
  const tipo = pozo === 'imagen' ? 'avatar' : 'titulo';
  console.log(`\nEl pozo de ${pozo === 'imagen' ? 'imágenes' : 'títulos'},` +
    ` con ${POR_POZO.toLocaleString('es')} tiradas`);
  const { cuenta, tipos } = await sortear(pozo, POR_POZO);
  const ajenos = Object.keys(tipos).filter((t) => t !== tipo);
  rev(`solo entrega ${tipo}`, ajenos.length === 0,
    `también salió: ${ajenos.map((t) => `${tipos[t]} ${t}`).join(', ')}`);
  revisarPesos(cuenta, POR_POZO, await rarezasDe(tipo));
}

rev('ninguna de las tiradas entregó algo del pase',
  salieronDelPase.length === 0,
  salieronDelPase.slice(0, 4).join(', '));
rev('y el saldo de puntos no se movió ni un punto', await puntosDe() === puntosAntes,
  `quedó en ${await puntosDe()}, estaba en ${puntosAntes}`);

// ---------- Sin pozo se sigue pudiendo tirar ----------
//
// El parámetro tiene omisión nula a propósito: nulo es el pozo completo, como
// antes de la 0035. No es una comodidad, es lo que permite aplicar la migración
// **antes** del despliegue sin que el sitio publicado —que llama con un solo
// argumento— se caiga en el medio.

console.log('\nLa llamada de un solo argumento sigue sirviendo');
const surtido = new Set();
for (let i = 0; i < 3; i++) {
  const [{ r }] = await como(alumno.id, (s) => s`select public.gacha_tirar(${m.id}::uuid) as r`);
  surtido.add(r.tipo);
  await d`delete from public.alumno_cosmeticos
           where matricula_id = ${m.id} and cosmetico_id = ${r.id}`;
}
rev('sin pozo entrega del pozo completo', surtido.size > 0, `salió: ${[...surtido].join(', ')}`);

// ---------- La tienda entrega la tirada ----------
//
// Esta sección existe por una falla que estuvo doce veces en producción: los dos
// artículos de gacha de la tienda cobraban 150 puntos y **no entregaban nada**.
// `solicitar_canje` descontaba y escribía el canje; nadie escribía en
// `movimientos_tiradas`. Todo quedaba «entregado», el saldo bajaba, y la pantalla
// del gacha seguía diciendo que no quedaban tiradas.
//
// Lo que se vigila acá es la cadena completa —cobra, acredita, y la tirada se puede
// gastar— porque cada pieza por separado funcionaba y el conjunto no.

console.log('\nLa tienda entrega la tirada');

const [articulo] = await d`
  select a.id, a.codigo, a.precio, a.tiradas
    from public.articulos a
    join public.matriculas mt on mt.id = ${m.id}
    join public.secciones s on s.id = mt.seccion_id
                           and s.asignatura_id = a.asignatura_id
                           and s.periodo_id = a.periodo_id
   where a.categoria = 'gacha' and a.activo`;

const [{ n: cuantos }] = await d`
  select count(*)::int as n
    from public.articulos a
    join public.matriculas mt on mt.id = ${m.id}
    join public.secciones s on s.id = mt.seccion_id
                           and s.asignatura_id = a.asignatura_id
                           and s.periodo_id = a.periodo_id
   where a.categoria = 'gacha' and a.activo`;
rev('hay un solo artículo de gacha en la vitrina', cuantos === 1, `hay ${cuantos}`);

if (!articulo) {
  rev('el artículo de gacha existe', false, 'no encontré ninguno activo para esta matrícula');
} else {
  rev(`el artículo declara cuántas tiradas entrega (${articulo.codigo})`,
    articulo.tiradas === 1, `tiradas = ${articulo.tiradas}`);

  const saldoDe = async () => {
    const [r] = await d`select coalesce(sum(puntos), 0)::int as n
       from public.movimientos_puntos where matricula_id = ${m.id}`;
    return r.n;
  };

  // Los puntos que haga falta para poder comprar, y se devuelven al final.
  const saldoInicial = await saldoDe();
  if (saldoInicial < articulo.precio) {
    await d`insert into public.movimientos_puntos (matricula_id, puntos, motivo)
            values (${m.id}, ${articulo.precio - saldoInicial + 10}, ${MOTIVO_SALDO})`;
  }

  const tiradasAntes = await tiradasDe();
  const saldoAntes = await saldoDe();

  const [{ canje }] = await como(alumno.id, (s) =>
    s`select public.solicitar_canje(${m.id}::uuid, ${articulo.id}::uuid) as canje`);
  rev('el canje se registra', Number(canje) > 0, `devolvió ${canje}`);

  const saldoDespues = await saldoDe();
  const tiradasDespues = await tiradasDe();
  rev('cobra el precio', saldoAntes - saldoDespues === articulo.precio,
    `bajó ${saldoAntes - saldoDespues}, el precio es ${articulo.precio}`);
  rev('y acredita la tirada', tiradasDespues - tiradasAntes === articulo.tiradas,
    `subió ${tiradasDespues - tiradasAntes}`);

  // El motivo lleva el número del canje: sin eso, dos compras del mismo artículo no
  // se distinguen en el historial y no se puede rastrear qué pagó qué.
  const [{ n: rastreable }] = await d`
    select count(*)::int as n from public.movimientos_tiradas
     where matricula_id = ${m.id} and motivo like ${'Canje #' + canje + ':%'}`;
  rev('la tirada se puede rastrear hasta el canje que la pagó', rastreable === 1);

  // Y lo que de verdad importaba: que la tirada sirva.
  const [{ premio }] = await como(alumno.id, (s) =>
    s`select public.gacha_tirar(${m.id}::uuid) as premio`);
  rev('la tirada comprada se puede gastar', Boolean(premio?.nombre),
    JSON.stringify(premio));
  rev('y queda en cero de nuevo', (await tiradasDe()) === tiradasAntes);

  // Un artículo con tiradas no puede quedar esperando visto bueno: se cobraría al
  // solicitar y la tirada se entregaría igual, antes de que el docente aprobara.
  // El check de la 0031 lo prohíbe, y esto comprueba que el check está puesto.
  try {
    await d`update public.articulos set requiere_aprobacion = true where id = ${articulo.id}`;
    await d`update public.articulos set requiere_aprobacion = false where id = ${articulo.id}`;
    rev('un artículo con tiradas no puede pedir visto bueno', false, 'la base lo aceptó');
  } catch (e) {
    rev('un artículo con tiradas no puede pedir visto bueno',
      (e.message ?? '').includes('articulos_tiradas_sin_aprobacion'), e.message);
  }

  // Deshacer la compra: el canje, su cobro y el saldo que se le puso.
  await d`delete from public.canjes where id = ${canje}`;
  await d`delete from public.movimientos_puntos
           where matricula_id = ${m.id} and (motivo = ${MOTIVO_SALDO}
              or motivo like ${'Canje: %'} and puntos = ${-articulo.precio})`;
  const saldoFinal = await saldoDe();
  rev('el saldo vuelve a como estaba', saldoFinal === saldoInicial,
    `quedó con ${saldoFinal}, tenía ${saldoInicial}`);
}

// ---------- Dejarlo como estaba ----------

await limpiar();
const despues = await tiradasDe();
rev('las tiradas del alumno vuelven a como estaban', despues === antes,
  `quedó con ${despues}, tenía ${antes}`);
const [colgados] = await d`select count(*)::int as n from public.alumno_cosmeticos
   where matricula_id = ${m.id}
     and not (cosmetico_id = any(${[...suyos]}::uuid[]))`;
rev('no le quedaron cosméticos de la prueba', colgados.n === 0, `quedaron ${colgados.n}`);

// Las dos de arriba miran el **neto** y la foto, y por eso no vieron el residuo que
// quedó colgado cuatro corridas seguidas: el +1 del canje y el −1 de la tirada se
// cancelan, y la foto ya incluía el título huérfano. Esto mira las firmas, que es lo
// único que no se puede cancelar contra sí mismo.
const [firmas] = await d`
  select count(*)::int as n from public.movimientos_tiradas
   where matricula_id = ${m.id} and motivo in (${MOTIVO}, ${MOTIVO_SALDO})`;
rev('no quedó ninguna marca de esta prueba en el libro de tiradas',
  firmas.n === 0, `quedaron ${firmas.n}`);
const [saldoSuelto] = await d`
  select count(*)::int as n from public.movimientos_puntos
   where matricula_id = ${m.id} and motivo = ${MOTIVO_SALDO}`;
rev('ni el saldo que se le puso para poder canjear', saldoSuelto.n === 0,
  `quedaron ${saldoSuelto.n}`);

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
