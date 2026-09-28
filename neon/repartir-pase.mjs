/**
 * Reparte los premios de los pases: qué frase y qué imagen toca en cada nivel.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/repartir-pase.mjs [--resortear DSY1107:2,ITY1102:2] [--escribir]
 *
 * Sin `--escribir` informa y no toca nada.
 *
 * ── Un pase que ya empezó no se vuelve a sortear ──
 *
 * Se sortean solo los pases que todavía no empiezan. Los que ya empezaron quedan
 * **congelados**: sus premios se leen de la base, se muestran en el informe y
 * cuentan como usados para que nadie más los reciba. Antes esto re-sorteaba todos
 * los pases en cada corrida, y como el pozo cambia —se suben cosméticos, el gacha
 * entrega otros— el mismo sorteo con la misma semilla daba otra escalera: el
 * premio del nivel 19 le cambiaba a quien ya lo estaba mirando, y la exclusividad
 * se movía, devolviendo al gacha algo que alguien ya ganó en el pase.
 *
 * `--resortear SIGLA:N` es la excepción explícita, para cuando se decide darle
 * premios nuevos a un pase que ya partió —como la EP2 el 28 de septiembre, que
 * arrancó con la escalera reiniciada—. Lo ya entregado no se toca: vive en
 * `alumno_cosmeticos`, que es otra tabla.
 *
 * ── Lo que queda en el pase sale del gacha ──
 *
 * No hace falta marcar nada: `gacha_tirar` excluye lo que está en
 * `pase_recompensas`. Asignar un cosmético a un nivel **es** hacerlo exclusivo, y
 * quitarlo de ahí lo devuelve al pozo.
 *
 * ── Solo lo que nadie tiene ──
 *
 * El sorteo elige entre cosméticos que **ningún alumno tiene todavía**. Un premio
 * que el alumno ya sacó tirando es un nivel vacío para él, y la escalera se lee
 * como una lista de cosas que se van a ganar.
 *
 * ── Al azar, pero siempre el mismo azar ──
 *
 * La semilla sale del id del pase y del nivel: dos corridas seguidas sobre el
 * mismo pozo dan la misma escalera.
 *
 * ── Por qué el pase llega hasta legendaria y no hasta mítica ──
 *
 * Lo mítico se queda **solo en el gacha**. El pase es el camino garantizado: se
 * llega al 30 trabajando, y si además diera lo más raro del pozo, el 1% del gacha
 * dejaría de significar nada.
 *
 * ── La rareza de las imágenes ──
 *
 * Desde la 0035 cada imagen tiene la rareza que le da su código
 * (`rareza_de_imagen`), y la escalera la usa: las caras también suben de rareza
 * con el nivel. Al escribir, las imágenes que no quedan en un pase congelado se
 * realinean a esa rareza —las que salen de un pase vuelven al pozo con la suya, no
 * con la que tenían puesta a mano—. René Puente, el final, conserva la suya.
 */
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1]?.startsWith('--') ? true : (arr[i + 1] ?? true)]);
    return a;
  }, []),
);
const ESCRIBIR = !!args.escribir;
const RESORTEAR = new Set(typeof args.resortear === 'string' ? args.resortear.split(',') : []);

const sql = neon(process.env.DATABASE_URL_OWNER);

/**
 * La escalera de cada pase que se sortea.
 *
 * Desde la EP2 el pase se puede terminar —las misiones pagan 75 XP—, así que la
 * escalera es más larga que la de la EP1: quince cosméticos en vez de doce, y
 * las caras suben de rareza igual que las frases. Los niveles sin nada no están
 * vacíos: son el tramo hasta el siguiente, y verlo cerca es lo que tira.
 */
const ESCALERA = [
  { nivel: 2,  tipo: 'avatar', rareza: 'poco_comun' },
  { nivel: 4,  tipo: 'titulo', rareza: 'rara' },
  { nivel: 6,  tipo: 'avatar', rareza: 'rara' },
  { nivel: 8,  tipo: 'titulo', rareza: 'rara' },
  { nivel: 11, tipo: 'avatar', rareza: 'rara' },
  { nivel: 12, tipo: 'marco' },
  { nivel: 13, tipo: 'titulo', rareza: 'epica' },
  { nivel: 16, tipo: 'avatar', rareza: 'epica' },
  { nivel: 18, tipo: 'titulo', rareza: 'epica' },
  { nivel: 23, tipo: 'avatar', rareza: 'epica' },
  { nivel: 24, tipo: 'marco' },
  { nivel: 26, tipo: 'titulo', rareza: 'legendaria' },
  { nivel: 28, tipo: 'avatar', rareza: 'legendaria' },
  { nivel: 30, tipo: 'titulo', rareza: 'legendaria' },
];

/** Una tirada cada cinco niveles: seis por pase. */
const TIRADAS_CADA = 5;

/**
 * El premio final del semestre, fijado a mano: el nivel 30 del **último** pase de
 * cada asignatura es René Puente, y por estar en `pase_recompensas` no sale tirando.
 */
const FINAL = { codigo: 'avatar-loco-rene', nivel: 30 };

/** Azar reproducible: `xmur3` para la semilla y `mulberry32` para generar. */
function generador(semilla) {
  let h = 1779033703 ^ semilla.length;
  for (let i = 0; i < semilla.length; i++) {
    h = Math.imul(h ^ semilla.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Qué se sortea y qué queda congelado ----------

const pases = await sql`
  select p.id, p.numero, p.nombre, a.sigla, pe.codigo as periodo, p.desde,
         p.desde <= now() as empezo
    from public.pases p
    join public.asignaturas a on a.id = p.asignatura_id
    join public.periodos   pe on pe.id = p.periodo_id
   where p.activo
   order by a.sigla, p.numero`;
if (!pases.length) throw new Error('No hay pases activos.');

for (const clave of RESORTEAR) {
  if (!pases.some((p) => `${p.sigla}:${p.numero}` === clave)) {
    throw new Error(`--resortear ${clave}: no hay un pase activo con esa sigla y número`);
  }
}
const congelado = (p) => p.empezo && !RESORTEAR.has(`${p.sigla}:${p.numero}`);
const aSortear = pases.filter((p) => !congelado(p));

// Los premios de los congelados se quedan como están y cuentan como usados.
const vigentes = await sql`
  select r.pase_id, r.nivel, r.tiradas, c.id, c.codigo, c.tipo, c.nombre, c.descripcion, c.rareza
    from public.pase_recompensas r
    left join public.cosmeticos c on c.id = r.cosmetico_id`;

const usados = new Set();
const filas = [];
for (const pase of pases.filter(congelado)) {
  for (const r of vigentes.filter((v) => v.pase_id === pase.id)) {
    const cosmetico = r.id ? r : null;
    if (cosmetico && cosmetico.tipo !== 'marco') usados.add(cosmetico.id);
    filas.push({ pase, nivel: r.nivel, cosmetico, tiradas: r.tiradas, congelado: true });
  }
}

// ---------- El pozo del que se elige ----------
//
// Las imágenes con la rareza que les da su código: una que hoy está en un pase que
// se va a re-sortear puede tener una puesta a mano, y esa no es la que tendrá.

const pozo = await sql`
  select c.id, c.codigo, c.tipo, c.nombre, c.descripcion,
         case when c.tipo = 'avatar' and c.codigo <> ${FINAL.codigo}
              then public.rareza_de_imagen(c.codigo) else c.rareza end as rareza,
         exists (select 1 from public.alumno_cosmeticos ac where ac.cosmetico_id = c.id) as tiene_dueno
    from public.cosmeticos c
   where c.activo
   order by c.tipo, c.rareza, c.nombre`;

const cosmeticoFinal = pozo.find((c) => c.codigo === FINAL.codigo);
if (!cosmeticoFinal) {
  console.error(`No existe el cosmético final «${FINAL.codigo}». ¿Se subió la colección?`);
  process.exit(1);
}
usados.add(cosmeticoFinal.id);

/** Lo que se puede sortear: libre, sin dueño, y los marcos siempre (son tres y se repiten). */
const candidatos = (tipo, rareza) => pozo.filter((c) =>
  c.tipo === tipo && (!rareza || c.rareza === rareza)
  && (tipo === 'marco' || (!usados.has(c.id) && !c.tiene_dueno)));

// Comprobar que alcanza antes de repartir, en vez de dejar niveles sin premio.
const necesidad = {};
for (const paso of ESCALERA) {
  if (paso.tipo === 'marco') continue;
  const clave = `${paso.tipo}:${paso.rareza ?? 'cualquiera'}`;
  necesidad[clave] = (necesidad[clave] ?? 0) + aSortear.length;
}
const problemas = Object.entries(necesidad).flatMap(([clave, cuantos]) => {
  const [tipo, rareza] = clave.split(':');
  const hay = candidatos(tipo, rareza === 'cualquiera' ? null : rareza).length;
  return hay < cuantos ? [`${clave}: hacen falta ${cuantos} y hay ${hay} sin dueño`] : [];
});
if (problemas.length) {
  console.error('No alcanza el pozo:');
  for (const p of problemas) console.error(`  ${p}`);
  process.exit(1);
}

// ---------- Repartir ----------
//
// Sin repetir **entre pases**: cada frase y cada imagen es de un solo nivel de un solo
// pase, así que un alumno con dos ramos no ve el mismo premio dos veces.

/** El último pase de cada asignatura: ahí va el final. */
const ultimoDe = new Map();
for (const p of pases) {
  const previo = ultimoDe.get(p.sigla);
  if (!previo || p.numero > previo.numero) ultimoDe.set(p.sigla, p);
}

for (const pase of aSortear) {
  const esElUltimo = ultimoDe.get(pase.sigla)?.id === pase.id;
  for (const paso of ESCALERA) {
    if (esElUltimo && paso.nivel === FINAL.nivel) {
      filas.push({ pase, nivel: paso.nivel, cosmetico: cosmeticoFinal, tiradas: 0, final: true });
      continue;
    }
    const azar = generador(`${pase.id}|${paso.nivel}`);
    // Los marcos se repiten entre pases, pero no dentro del mismo: el segundo sería un
    // nivel vacío, porque un cosmético se gana una sola vez.
    const opciones = candidatos(paso.tipo, paso.rareza ?? null).filter((c) =>
      !filas.some((f) => f.pase.id === pase.id && f.cosmetico?.id === c.id));
    if (!opciones.length) {
      console.error(`Sin candidatos para ${pase.sigla} ${pase.nombre} nivel ${paso.nivel}`);
      process.exit(1);
    }
    const elegido = opciones[Math.floor(azar() * opciones.length)];
    if (paso.tipo !== 'marco') usados.add(elegido.id);
    filas.push({ pase, nivel: paso.nivel, cosmetico: elegido, tiradas: 0 });
  }
  for (let n = TIRADAS_CADA; n <= 30; n += TIRADAS_CADA) {
    // Si ese nivel ya lleva un cosmético, la tirada se le suma en la misma fila:
    // `pase_recompensas` tiene una fila por nivel.
    const ya = filas.find((f) => f.pase.id === pase.id && f.nivel === n);
    if (ya) ya.tiradas = 1;
    else filas.push({ pase, nivel: n, cosmetico: null, tiradas: 1 });
  }
}

// ---------- Informe ----------

for (const pase of pases) {
  const mias = filas.filter((f) => f.pase.id === pase.id).sort((a, b) => a.nivel - b.nivel);
  console.log(`\n${pase.sigla} · ${pase.nombre}${congelado(pase) ? '   (congelado: ya empezó)' : ''}`);
  for (const f of mias) {
    const c = f.cosmetico;
    const que = c
      ? `${c.tipo.padEnd(6)} ${c.rareza.padEnd(11)} ${c.nombre}${c.descripcion ? ` (${c.descripcion})` : ''}`
      : '—';
    console.log(`  nivel ${String(f.nivel).padStart(2)}  ${que}${f.tiradas ? `  +${f.tiradas} tirada` : ''}` +
      (f.final ? '   ← EL FINAL' : ''));
  }
}

const exclusivos = new Set(filas.filter((f) => f.cosmetico).map((f) => f.cosmetico.id));
const porTipo = {};
for (const id of exclusivos) {
  const c = pozo.find((x) => x.id === id);
  if (c) porTipo[c.tipo] = (porTipo[c.tipo] ?? 0) + 1;
}
console.log('\nSalen del gacha por ser del pase:');
for (const [tipo, n] of Object.entries(porTipo)) {
  const total = pozo.filter((c) => c.tipo === tipo).length;
  console.log(`  ${tipo.padEnd(6)} ${n} de ${total} · quedan ${total - n} en el pozo`);
}

if (!ESCRIBIR) {
  console.log('\nSin --escribir: no toqué nada.');
  process.exit(0);
}

// ---------- Escribir ----------
//
// Solo los pases que se sortearon. Borrar `pase_recompensas` **no** le quita nada a
// nadie: lo que ya se entregó vive en `alumno_cosmeticos`, que es otra tabla. Y las
// tiradas ya pagadas cuelgan de `(pase_id, nivel)` (0039), así que un nivel que
// cambia de premio no vuelve a pagar la tirada que ya pagó.

const nuevas = filas.filter((f) => !f.congelado);
const ids = aSortear.map((p) => p.id);
await sql.transaction([
  sql`delete from public.pase_recompensas where pase_id = any(${ids}::uuid[])`,
  ...nuevas.map((f) => sql`
    insert into public.pase_recompensas (pase_id, nivel, cosmetico_id, tiradas)
    values (${f.pase.id}, ${f.nivel}, ${f.cosmetico?.id ?? null}, ${f.tiradas})`),
  // Toda imagen que no está en un pase congelado lleva la rareza de su código, y
  // René la suya. Es lo que `probar-gacha.mjs` vigila para las sacables.
  sql`update public.cosmeticos c
         set rareza = public.rareza_de_imagen(c.codigo)
       where c.activo and c.tipo = 'avatar' and c.codigo <> ${FINAL.codigo}
         and c.rareza <> public.rareza_de_imagen(c.codigo)
         and not exists (select 1 from public.pase_recompensas pr
                           join public.pases p on p.id = pr.pase_id
                          where pr.cosmetico_id = c.id and p.desde <= now()
                            and not (p.id = any(${ids}::uuid[])))`,
]);

const [resumen] = await sql`
  select count(*)::int as filas,
         count(distinct cosmetico_id)::int as cosmeticos,
         sum(tiradas)::int as tiradas
    from public.pase_recompensas where pase_id = any(${ids}::uuid[])`;
console.log(`\nEscrito en ${ids.length} pases: ${resumen.filas} niveles con premio · ` +
  `${resumen.cosmeticos} cosméticos · ${resumen.tiradas} tiradas`);
