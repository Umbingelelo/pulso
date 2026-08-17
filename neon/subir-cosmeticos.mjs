/**
 * Sube los cosméticos: los títulos de perfil y las imágenes de avatar.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/subir-cosmeticos.mjs --titulos ~/Downloads/titulos_perfil_rareza.txt \
 *     --avatares ~/Downloads/iconos_pulso [--escribir]
 *
 * Sin `--escribir` informa y no toca nada, igual que el publicador de laboratorios.
 * Cada parte es opcional: se puede subir solo títulos o solo imágenes.
 *
 * ── Por qué las imágenes van a Blob y no a `public/` ──
 *
 * Este repositorio es público y son personajes de series con derechos de autor.
 * Meterlas en `public/` las dejaría publicadas a nombre del repositorio, indexables
 * y descargables por cualquiera, que es exactamente el problema que ya se resolvió
 * con los decks de clase. En Blob viven detrás de una URL larga que no se adivina y
 * que se puede cambiar sin tocar código.
 *
 * ── Idempotente a propósito ──
 *
 * Se corre muchas veces mientras se arma la colección. Cada cosmético tiene un
 * `codigo` estable —derivado del nombre del archivo o del número del título— así
 * que volver a correrlo actualiza en vez de duplicar, y **no le quita a nadie lo
 * que ya se ganó**: `alumno_cosmeticos` apunta al id, que no cambia.
 *
 * Las imágenes ya subidas no se vuelven a subir: se comparan por tamaño contra lo
 * que hay en Blob. Subir 220 archivos cada vez que se agrega uno sería diez
 * minutos de espera para nada.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { list, put } from '@vercel/blob';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] ?? true]);
    return a;
  }, []),
);
if (!args.titulos && !args.avatares) {
  console.error('Uso: node neon/subir-cosmeticos.mjs --titulos <archivo> --avatares <carpeta> [--escribir]');
  process.exit(1);
}
const ESCRIBIR = !!args.escribir;
const TEMPORADA = args.temporada ?? '2026-2';

/** Cómo se llama en el archivo del docente → cómo se llama en la base. */
const RAREZAS = {
  'común': 'comun', 'comun': 'comun',
  'poco común': 'poco_comun', 'poco comun': 'poco_comun',
  'raro': 'rara', 'rara': 'rara',
  'épico': 'epica', 'epico': 'epica', 'épica': 'epica',
  'legendario': 'legendaria', 'legendaria': 'legendaria',
  'mítico': 'mitica', 'mitico': 'mitica', 'mítica': 'mitica',
};

/** `Attack on Titan - Eren Yeager.jpg` → `attack-on-titan-eren-yeager`. */
const aCodigo = (texto) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const sql = neon(process.env.DATABASE_URL_OWNER);
const cosmeticos = [];
const problemas = [];

// ============================== Los títulos ==============================
//
// Una línea por título: `001. El Dios del Six Seven — Mítico`. El separador es una
// raya larga y no un guion: en el archivo hay títulos que llevan guion adentro
// («Aura Positiva, Saldo Negativo»), y cortar por el primer `-` los partiría.

if (args.titulos) {
  const texto = await readFile(args.titulos, 'utf8');
  let n = 0;
  for (const linea of texto.split('\n')) {
    n++;
    const m = linea.match(/^(\d{3})\.\s*(.+?)\s*—\s*(.+?)\s*$/);
    if (!m) {
      // Las líneas de encabezado y las vacías se saltan sin ruido; una que
      // *parezca* un título y no calce, se avisa.
      if (/^\d{3}\./.test(linea)) problemas.push(`línea ${n}: no entendí «${linea.trim()}»`);
      continue;
    }
    const [, numero, nombre, rarezaCruda] = m;
    const rareza = RAREZAS[rarezaCruda.toLowerCase()];
    if (!rareza) {
      problemas.push(`línea ${n}: rareza desconocida «${rarezaCruda}» en «${nombre}»`);
      continue;
    }
    cosmeticos.push({
      codigo: `titulo-${numero}`,
      tipo: 'titulo',
      nombre,
      descripcion: null,
      // El valor de un título **es** su texto: es lo que se dibuja bajo el nombre.
      valor: nombre,
      rareza,
    });
  }
}

// ============================== Las imágenes ==============================

if (args.avatares) {
  const carpeta = args.avatares;
  const archivos = (await readdir(carpeta))
    .filter((f) => ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(f).toLowerCase()))
    .sort();

  // Lo que ya está en Blob, para no volver a subir 220 archivos cada vez.
  let yaEstan = new Map();
  try {
    const { blobs } = await list({ prefix: 'avatares/', limit: 1000 });
    yaEstan = new Map(blobs.map((b) => [b.pathname, b]));
  } catch (e) {
    if (ESCRIBIR) throw e;
    console.log(`  (no pude listar Blob: ${e.message})`);
  }

  let subidos = 0; let reusados = 0;
  for (const archivo of archivos) {
    const sinExt = basename(archivo, extname(archivo));
    const codigo = aCodigo(sinExt);
    const ruta = `avatares/${codigo}${extname(archivo).toLowerCase()}`;
    const info = await stat(join(carpeta, archivo));

    // El nombre trae la serie y el personaje: `Attack on Titan - Eren Yeager`.
    const guion = sinExt.indexOf(' - ');
    const serie = guion > 0 ? sinExt.slice(0, guion).trim() : null;
    const personaje = guion > 0 ? sinExt.slice(guion + 3).trim() : sinExt.trim();

    let url = yaEstan.get(ruta)?.url;
    if (url && yaEstan.get(ruta)?.size === info.size) {
      reusados++;
    } else if (ESCRIBIR) {
      const r = await put(ruta, await readFile(join(carpeta, archivo)), {
        access: 'public',
        addRandomSuffix: false,
        contentType: extname(archivo).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg',
        allowOverwrite: true,
      });
      url = r.url;
      subidos++;
      if (subidos % 25 === 0) console.log(`  … ${subidos} subidas`);
    } else {
      url = `(sin subir: ${ruta})`;
      subidos++;
    }

    cosmeticos.push({
      codigo: `avatar-${codigo}`,
      tipo: 'avatar',
      nombre: personaje,
      descripcion: serie,
      valor: url,
      // Todas comunes: dentro de una rareza el sorteo es uniforme, así que es lo
      // que hace que las 220 tengan exactamente la misma probabilidad entre sí.
      rareza: 'comun',
    });
  }
  console.log(`Imágenes   ${archivos.length} · ${subidos} por subir · ${reusados} ya estaban`);
}

// ============================== Informe ==============================

const repetidos = cosmeticos
  .map((c) => c.codigo)
  .filter((c, i, a) => a.indexOf(c) !== i);
if (repetidos.length) problemas.push(`códigos repetidos: ${[...new Set(repetidos)].join(', ')}`);

if (problemas.length) {
  console.error('\nProblemas:');
  for (const p of problemas) console.error(`  ${p}`);
  process.exit(1);
}

const porRareza = {};
for (const c of cosmeticos) {
  porRareza[c.rareza] ??= { titulo: 0, avatar: 0 };
  porRareza[c.rareza][c.tipo]++;
}
console.log(`\nCosméticos ${cosmeticos.length}`);
for (const [r, n] of Object.entries(porRareza)) {
  console.log(`  ${r.padEnd(11)} ${String(n.titulo).padStart(3)} títulos · ${String(n.avatar).padStart(3)} avatares`);
}

if (!ESCRIBIR) {
  console.log('\nSin --escribir: no subí ni escribí nada.');
  process.exit(0);
}

// ============================== Escribir ==============================

for (const c of cosmeticos) {
  await sql`
    insert into public.cosmeticos (codigo, tipo, nombre, descripcion, valor, rareza, temporada, activo)
    values (${c.codigo}, ${c.tipo}, ${c.nombre}, ${c.descripcion}, ${c.valor},
            ${c.rareza}, ${TEMPORADA}, true)
    on conflict (codigo) do update
      set tipo = excluded.tipo, nombre = excluded.nombre,
          descripcion = excluded.descripcion, valor = excluded.valor,
          rareza = excluded.rareza, temporada = excluded.temporada, activo = true`;
}

// Retirar los avatares que ya no son de esta colección.
//
// Antes de esto había doce «avatares» que eran **estilos de DiceBear** —el
// cosmético desbloqueaba `bigSmile` y el dibujo lo generaba el navegador—. Ahora
// la cara es una imagen subida, así que esos dejan de tener sentido.
//
// Se marcan `activo = false`, **no se borran**. Diez alumnos ya se ganaron alguno,
// y `alumno_cosmeticos` apunta al id: borrarlos les quitaría de la vitrina algo que
// consiguieron. Retirados no salen en el gacha ni en la colección, y quien tenga
// uno puesto lo conserva hasta que gane una imagen.
if (args.avatares) {
  const codigos = cosmeticos.filter((c) => c.tipo === 'avatar').map((c) => c.codigo);
  const retirados = await sql`
    update public.cosmeticos set activo = false
     where tipo = 'avatar' and activo and not (codigo = any(${codigos}))
    returning codigo, nombre`;
  if (retirados.length) {
    console.log(`\nRetirados ${retirados.length} avatares que ya no son de la colección:`);
    console.log(`  ${retirados.map((r) => r.codigo).join(', ')}`);
    console.log('  (marcados inactivos, no borrados: quien ya los tenía los conserva)');
  }
}

const [resumen] = await sql`
  select count(*) filter (where tipo = 'titulo')::int as titulos,
         count(*) filter (where tipo = 'avatar')::int as avatares,
         count(*)::int as total
    from public.cosmeticos where activo`;
console.log(`\nSubido: ${resumen.titulos} títulos y ${resumen.avatares} avatares activos (${resumen.total} en total).`);
