/**
 * Reparte los premios de los pases: qué frase y qué imagen toca en cada nivel.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/repartir-pase.mjs [--escribir]
 *
 * Sin `--escribir` informa y no toca nada.
 *
 * ── Lo que queda en el pase sale del gacha ──
 *
 * No hace falta marcar nada: `gacha_tirar` excluye lo que está en
 * `pase_recompensas`. Asignar un cosmético a un nivel **es** hacerlo exclusivo, y
 * quitarlo de ahí lo devuelve al pozo. Una columna `exclusivo` aparte podría
 * quedar en desacuerdo con la realidad y ese desacuerdo no falla en ninguna
 * parte: simplemente un premio del pase empieza a salir en el gacha.
 *
 * ── Al azar, pero siempre el mismo azar ──
 *
 * La elección se ve aleatoria y **no cambia entre corridas**: el sorteo va con una
 * semilla derivada del id del pase y del nivel. Eso importa porque esto se corre
 * más de una vez —cada vez que se suben cosméticos nuevos— y con azar de verdad
 * cada corrida reordenaría la escalera. Un alumno que ya vio que en el nivel 19 le
 * toca cierto personaje lo vería cambiar, y peor: la exclusividad se movería de un
 * cosmético a otro, devolviendo al gacha algo que alguien ya se ganó como premio
 * del pase.
 *
 * ── Por qué el pase llega hasta legendaria y no hasta mítica ──
 *
 * Los cuatro títulos míticos se quedan **solo en el gacha**. El pase es el camino
 * garantizado: se llega al 30 trabajando, y si además diera lo más raro del pozo,
 * el 1% del gacha dejaría de significar nada. Lo garantizado sube hasta
 * legendaria; lo mítico sigue siendo suerte.
 */
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] ?? true]);
    return a;
  }, []),
);
const ESCRIBIR = !!args.escribir;

const sql = neon(process.env.DATABASE_URL_OWNER);

/**
 * La escalera de cada pase: qué se entrega en cada nivel.
 *
 * Las frases suben de rareza con el nivel, que es lo que hace que llegar al 30
 * valga la pena. Las imágenes no tienen escalera de rareza —todas son comunes en
 * el gacha, para que ninguna sea más difícil que otra— así que lo que las hace
 * valiosas acá es justamente ser del pase y no salir en el pozo.
 *
 * Los niveles que no aparecen tampoco están vacíos: son el tramo que hay que
 * recorrer para llegar al siguiente, y verlos en la escalera es lo que hace que el
 * próximo premio se sienta cerca.
 */
const ESCALERA = [
  { nivel: 2,  tipo: 'titulo', rareza: 'poco_comun' },
  { nivel: 4,  tipo: 'avatar' },
  { nivel: 7,  tipo: 'titulo', rareza: 'rara' },
  { nivel: 9,  tipo: 'avatar' },
  { nivel: 12, tipo: 'marco' },
  { nivel: 14, tipo: 'avatar' },
  { nivel: 17, tipo: 'titulo', rareza: 'epica' },
  { nivel: 19, tipo: 'avatar' },
  { nivel: 22, tipo: 'titulo', rareza: 'epica' },
  { nivel: 24, tipo: 'marco' },
  { nivel: 27, tipo: 'avatar' },
  { nivel: 30, tipo: 'titulo', rareza: 'legendaria' },
];

/** Una tirada cada cinco niveles: seis por pase. */
const TIRADAS_CADA = 5;

/**
 * El premio final del semestre, fijado a mano.
 *
 * El nivel 30 del **último** pase no se sortea: es René Puente. Un pase entero
 * tiene sentido si al final hay algo que se sabe cuál es y por lo que se llega
 * —eso es lo que hace que valga la pena el nivel 29—, y un sorteo no puede dar
 * eso porque nadie sabe qué le va a tocar.
 *
 * Los otros cinco pases mantienen su título legendario en el 30. Y por estar en
 * `pase_recompensas`, René queda fuera del gacha automáticamente: no hay forma de
 * conseguirlo por suerte.
 */
const FINAL = { codigo: 'avatar-loco-rene', nivel: 30 };

/**
 * Azar reproducible.
 *
 * `xmur3` para convertir la semilla de texto en un número y `mulberry32` para
 * generar desde ahí. Son cuatro líneas y no traen dependencia; lo único que se
 * les pide es que la misma semilla dé siempre la misma secuencia.
 */
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

// ---------- El pozo del que se elige ----------

const pases = await sql`
  select p.id, p.numero, p.nombre, a.sigla, pe.codigo as periodo
    from public.pases p
    join public.asignaturas a on a.id = p.asignatura_id
    join public.periodos   pe on pe.id = p.periodo_id
   where p.activo
   order by a.sigla, p.numero`;
if (!pases.length) throw new Error('No hay pases activos.');

const pozo = await sql`
  select id, codigo, tipo, nombre, descripcion, rareza
    from public.cosmeticos
   where activo
   order by tipo, rareza, nombre`;

const de = (tipo, rareza) =>
  pozo.filter((c) => c.tipo === tipo && (!rareza || c.rareza === rareza));

// Comprobar que alcanza antes de repartir: si falta, se dice qué falta y cuánto,
// en vez de repartir a medias y dejar niveles sin premio.
const problemas = [];
const necesidad = {};
for (const paso of ESCALERA) {
  const clave = `${paso.tipo}:${paso.rareza ?? 'cualquiera'}`;
  necesidad[clave] = (necesidad[clave] ?? 0) + pases.length;
}
for (const [clave, cuantos] of Object.entries(necesidad)) {
  const [tipo, rareza] = clave.split(':');
  const hay = de(tipo, rareza === 'cualquiera' ? null : rareza).length;
  // Los marcos son tres y se repiten entre pases a propósito: son pocos y no
  // tiene sentido inventar marcos para que no se repitan.
  if (tipo === 'marco') continue;
  if (hay < cuantos) {
    problemas.push(`${clave}: hacen falta ${cuantos} y hay ${hay}`);
  }
}
if (problemas.length) {
  console.error('No alcanza el pozo:');
  for (const p of problemas) console.error(`  ${p}`);
  process.exit(1);
}

// ---------- Repartir ----------
//
// Se reparte sin repetir **entre pases**: cada frase y cada imagen es de un solo
// nivel de un solo pase, así que un alumno con dos ramos no ve el mismo premio dos
// veces. Los marcos son la excepción declarada arriba.

const usados = new Set();
const filas = [];

const cosmeticoFinal = pozo.find((c) => c.codigo === FINAL.codigo);
if (!cosmeticoFinal) {
  console.error(`No existe el cosmético final «${FINAL.codigo}». ¿Se subió la colección?`);
  process.exit(1);
}
// Fuera del sorteo: si además pudiera salir en otro nivel, dejaría de ser el final.
usados.add(cosmeticoFinal.id);
/** El último pase de cada asignatura: ahí va el final. */
const ultimoDe = new Map();
for (const p of pases) {
  const previo = ultimoDe.get(p.sigla);
  if (!previo || p.numero > previo.numero) ultimoDe.set(p.sigla, p);
}

for (const pase of pases) {
  const esElUltimo = ultimoDe.get(pase.sigla)?.id === pase.id;
  for (const paso of ESCALERA) {
    if (esElUltimo && paso.nivel === FINAL.nivel) {
      filas.push({ pase, nivel: paso.nivel, cosmetico: cosmeticoFinal, tiradas: 0, final: true });
      continue;
    }
    const azar = generador(`${pase.id}|${paso.nivel}`);
    const candidatos = de(paso.tipo, paso.rareza ?? null)
      .filter((c) => paso.tipo === 'marco' || !usados.has(c.id));
    if (!candidatos.length) {
      console.error(`Sin candidatos para ${pase.sigla} ${pase.nombre} nivel ${paso.nivel}`);
      process.exit(1);
    }
    const elegido = candidatos[Math.floor(azar() * candidatos.length)];
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
  console.log(`\n${pase.sigla} · ${pase.nombre}`);
  for (const f of mias) {
    const c = f.cosmetico;
    const que = c
      ? `${c.tipo.padEnd(6)} ${c.rareza.padEnd(11)} ${c.nombre}${c.descripcion ? ` (${c.descripcion})` : ''}`
      : '—';
    console.log(`  nivel ${String(f.nivel).padStart(2)}  ${que}${f.tiradas ? '  +1 tirada' : ''}` +
      (f.final ? '   ← EL FINAL' : ''));
  }
}

const exclusivos = new Set(filas.filter((f) => f.cosmetico).map((f) => f.cosmetico.id));
const porTipo = {};
for (const id of exclusivos) {
  const c = pozo.find((x) => x.id === id);
  porTipo[c.tipo] = (porTipo[c.tipo] ?? 0) + 1;
}
console.log('\nSalen del gacha por ser del pase:');
for (const [tipo, n] of Object.entries(porTipo)) {
  const total = de(tipo, null).length;
  console.log(`  ${tipo.padEnd(6)} ${n} de ${total} · quedan ${total - n} en el pozo`);
}

if (!ESCRIBIR) {
  console.log('\nSin --escribir: no toqué nada.');
  process.exit(0);
}

// ---------- Escribir ----------
//
// Se borran las recompensas anteriores de estos pases y se escriben las nuevas.
// Borrar `pase_recompensas` **no** le quita nada a nadie: lo que ya se entregó
// vive en `alumno_cosmeticos`, que es otra tabla.

for (const pase of pases) {
  await sql`delete from public.pase_recompensas where pase_id = ${pase.id}`;
}
for (const f of filas) {
  await sql`
    insert into public.pase_recompensas (pase_id, nivel, cosmetico_id, tiradas)
    values (${f.pase.id}, ${f.nivel}, ${f.cosmetico?.id ?? null}, ${f.tiradas})
    on conflict (pase_id, nivel) do update
      set cosmetico_id = excluded.cosmetico_id, tiradas = excluded.tiradas`;
}

const [resumen] = await sql`
  select count(*)::int as filas,
         count(distinct cosmetico_id)::int as cosmeticos,
         sum(tiradas)::int as tiradas
    from public.pase_recompensas`;
console.log(`\nEscrito: ${resumen.filas} niveles con premio · ${resumen.cosmeticos} cosméticos exclusivos · ${resumen.tiradas} tiradas repartidas`);
