/**
 * Sube los cosméticos: los títulos de perfil y las imágenes de avatar.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/subir-cosmeticos.mjs --titulos ~/Downloads/titulos_perfil_rareza.txt \
 *     --titulos-f neon/titulos-femenino.txt \
 *     --avatares ~/Downloads/iconos_pulso [--escribir]
 *
 * Sin `--escribir` informa y no toca nada, igual que el publicador de laboratorios.
 * Cada parte es opcional: se puede subir solo títulos, solo las formas femeninas o solo
 * imágenes.
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
if (!args.titulos && !args.avatares && !args['titulos-f']) {
  console.error('Uso: node neon/subir-cosmeticos.mjs --titulos <archivo> ' +
    '[--titulos-f <archivo>] [--avatares <carpeta>] [--escribir]');
  process.exit(1);
}
const ESCRIBIR = !!args.escribir;
const TEMPORADA = args.temporada ?? '2026-2';

/**
 * A qué store de Blob se escribe, y con qué credencial.
 *
 * Hay dos y hacen falta los dos: `pulso-clases` es **privado** —el material de
 * clase no puede quedar a un clic de cualquiera— y `pulso-cosmeticos` es
 * **público**, porque un `<img>` tiene que poder leer la cara del alumno sin token
 * ni sesión. Por eso acá no sirve el `BLOB_READ_WRITE_TOKEN` por omisión:
 * escribiría en el store equivocado, y además el privado rechaza los objetos
 * públicos.
 *
 * Se identifica el store con `COSMETICOS_STORE_ID` y se autoriza con el
 * **token OIDC** que `vercel env pull` deja en el entorno. Es lo que evita tener
 * que guardar una llave de escritura en `.env.local`: el OIDC dura poco y se
 * renueva solo, así que no hay un secreto de larga vida dando vueltas en el disco.
 *
 * Para que funcione, la conexión del store en Vercel tiene que cubrir
 * **All Environments**: si deja fuera development, esto falla con «OIDC is enabled
 * for this project, but not for the development environment».
 */
const STORE = process.env.COSMETICOS_STORE_ID;
const TOKEN = process.env.COSMETICOS_READ_WRITE_TOKEN;
const DESTINO = TOKEN ? { token: TOKEN } : STORE ? { storeId: STORE } : null;
if (args.avatares && !DESTINO) {
  console.error('Falta COSMETICOS_STORE_ID (o COSMETICOS_READ_WRITE_TOKEN).');
  console.error('Conecta `pulso-cosmeticos` al proyecto con prefijo COSMETICOS y All Environments,');
  console.error('y después:  npx vercel env pull .env.local');
  process.exit(1);
}

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

// ============================== Las formas femeninas ==============================
//
// Archivo aparte y no una columna más en el archivo de títulos, por dos razones. La
// primera es que el docente no tiene que re-editar 108 líneas para agregar 56. La segunda
// es concreta: ya hay un título con barra —«Locked In 24/7»— y otros con comillas y con
// porcentajes, así que cualquier separador puesto en la misma línea es una trampa
// esperando a que alguien escriba el título que la pisa.
//
// Se refiere por **código** y no por número porque ocho títulos tienen código de palabra
// —`titulo-madrugador`, `titulo-veterano`— y cuatro de esos necesitan forma femenina: un
// formato de solo números los habría dejado fuera en silencio.

const femeninos = new Map();
if (args['titulos-f']) {
  const texto = await readFile(args['titulos-f'], 'utf8');
  let n = 0;
  for (const linea of texto.split('\n')) {
    n++;
    const cruda = linea.trim();
    if (!cruda || cruda.startsWith('#')) continue;
    const mm = cruda.match(/^(\S+)\s*—\s*(.+?)\s*$/);
    if (!mm) {
      problemas.push(`formas femeninas, línea ${n}: no entendí «${cruda}»`);
      continue;
    }
    const [, codigo, femenino] = mm;
    if (femeninos.has(codigo)) {
      problemas.push(`formas femeninas, línea ${n}: «${codigo}» aparece dos veces`);
      continue;
    }
    femeninos.set(codigo, femenino);
  }
  console.log(`Formas fem. ${femeninos.size} leídas de ${args['titulos-f']}`);
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
    const { blobs } = await list({ prefix: 'avatares/', limit: 1000, ...DESTINO });
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
    //
    // Cuando no hay separador, antes se guardaba el nombre del archivo tal cual y
    // quedaban cosas como «loco-rene» a la vista del alumno. Sin serie que sacar,
    // al menos se limpia: guiones a espacios y cada palabra en mayúscula.
    const guion = sinExt.indexOf(' - ');
    const serie = guion > 0 ? sinExt.slice(0, guion).trim() : null;
    const personaje = guion > 0
      ? sinExt.slice(guion + 3).trim()
      : sinExt.trim().replace(/[-_]+/g, ' ')
          .replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1));

    let url = yaEstan.get(ruta)?.url;
    if (url && yaEstan.get(ruta)?.size === info.size) {
      reusados++;
    } else if (ESCRIBIR) {
      const r = await put(ruta, await readFile(join(carpeta, archivo)), {
        access: 'public',
        addRandomSuffix: false,
        contentType: extname(archivo).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg',
        allowOverwrite: true,
        ...DESTINO,
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
      // La rareza de una imagen **no se decide acá**: la pone la base con
      // `rareza_de_imagen`, que la deriva del código. Ver la 0035.
      //
      // Antes eran todas comunes, porque con un pozo único eso era lo que les daba
      // a las 220 la misma probabilidad entre sí. Con el pozo de imágenes aparte,
      // compartir rareza deja el sorteo sin nada que anunciar.
      //
      // Nula y no calculada en JS: la regla vive en un solo lugar. Calcularla acá
      // sería tener el mismo md5 escrito en dos lenguajes, y el día que se muevan
      // los cortes solo se corregiría uno.
      rareza: null,
    });
  }
  console.log(`Imágenes   ${archivos.length} · ${subidos} por subir · ${reusados} ya estaban`);
}

// ============================== Informe ==============================

const repetidos = cosmeticos
  .map((c) => c.codigo)
  .filter((c, i, a) => a.indexOf(c) !== i);
if (repetidos.length) problemas.push(`códigos repetidos: ${[...new Set(repetidos)].join(', ')}`);

// Un código que no exista es un **error y no un aviso**: significa que se escribió una
// forma femenina para un título que no está, y dejarlo pasar la perdería en silencio. Es
// el mismo criterio que ya se usa con las rarezas desconocidas.
//
// Se compara contra la base y no contra `cosmeticos`, porque los ocho títulos con código
// de palabra no salen del archivo de títulos: los sembró `sembrar-pases.mjs`.
if (femeninos.size) {
  const existentes = new Set((await sql`
    select codigo from public.cosmeticos where tipo = 'titulo'`).map((r) => r.codigo));
  for (const codigo of femeninos.keys()) {
    if (!existentes.has(codigo)) {
      problemas.push(`formas femeninas: «${codigo}» no corresponde a ningún título`);
    }
  }
}

if (problemas.length) {
  console.error('\nProblemas:');
  for (const p of problemas) console.error(`  ${p}`);
  process.exit(1);
}

// La rareza de las imágenes la pone la base, así que para informarla hay que
// preguntársela: es un `select`, así que esto también funciona sin `--escribir`.
// Calcularla en JS para el informe sería tener el md5 en dos lenguajes, y el día
// que el informe y la base no coincidan, el informe miente.
const rarezaImagenes = new Map();
const codigosImagen = cosmeticos.filter((c) => c.tipo === 'avatar').map((c) => c.codigo);
if (codigosImagen.length) {
  for (const r of await sql`
    select codigo, public.rareza_de_imagen(codigo) as rareza
      from unnest(${codigosImagen}::text[]) as codigo`) {
    rarezaImagenes.set(r.codigo, r.rareza);
  }
}

const porRareza = {};
for (const c of cosmeticos) {
  const rareza = c.rareza ?? rarezaImagenes.get(c.codigo) ?? 'sin rareza';
  porRareza[rareza] ??= { titulo: 0, avatar: 0 };
  porRareza[rareza][c.tipo]++;
}
console.log(`\nCosméticos ${cosmeticos.length}`);
for (const [r, n] of Object.entries(porRareza)) {
  console.log(`  ${r.padEnd(11)} ${String(n.titulo).padStart(3)} títulos · ${String(n.avatar).padStart(3)} avatares`);
}

if (femeninos.size) {
  console.log(`  ${femeninos.size} de esos títulos tienen forma femenina escrita`);
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
            -- Los títulos traen su rareza del archivo del docente; las imágenes la
            -- reciben de la base, derivada del código.
            coalesce(${c.rareza}, public.rareza_de_imagen(${c.codigo})),
            ${TEMPORADA}, true)
    on conflict (codigo) do update
      set tipo = excluded.tipo, nombre = excluded.nombre,
          descripcion = excluded.descripcion, valor = excluded.valor,
          -- La rareza de una imagen del pase se puso a mano —René Puente es
          -- legendaria por ser el premio final del semestre— y esta línea es lo
          -- que impide que la próxima corrida la pise. En los títulos no aplica:
          -- ahí la rareza es del archivo del docente y tiene que poder corregirla.
          rareza = case when excluded.tipo = 'avatar'
                         and exists (select 1 from public.pase_recompensas pr
                                      where pr.cosmetico_id = cosmeticos.id)
                        then cosmeticos.rareza
                        else excluded.rareza end,
          temporada = excluded.temporada, activo = true`;
}

// ============================== Escribir las formas femeninas ==============================
//
// Por código y contra la base, no contra `cosmeticos`: así también alcanza a los ocho
// títulos con código de palabra, que no salen del archivo de títulos.
//
// El `where` compara antes de escribir para que el recuento diga la verdad —cuántas
// cambiaron de verdad— y no «56 escritas» en cada corrida.

if (femeninos.size) {
  let escritas = 0;
  for (const [codigo, femenino] of femeninos) {
    const r = await sql`
      update public.cosmeticos set valor_femenino = ${femenino}
       where codigo = ${codigo} and coalesce(valor_femenino, '') <> ${femenino}
      returning codigo`;
    escritas += r.length;
  }
  console.log(`Formas fem. ${escritas} escritas · ${femeninos.size - escritas} ya estaban`);
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
