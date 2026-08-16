/**
 * Ningún acento grave dentro del template de un componente.
 *
 * El template de un componente de Angular es un template literal de JavaScript,
 * así que un acento grave —típicamente en un comentario, citando un identificador—
 * lo cierra y el decorador deja de ser un literal. El build lo caza, pero el
 * mensaje («Decorator argument must be literal») no dice dónde ni por qué.
 *
 * Van cuatro veces. Esto lo dice en una línea.
 *
 *   node neon/revisar-plantillas.mjs
 */
import { readdir, readFile } from 'node:fs/promises';

let malos = 0;
for (const f of (await readdir('src/app')).filter((x) => x.endsWith('.ts'))) {
  const t = await readFile(`src/app/${f}`, 'utf8');
  const i = t.indexOf('template: `');
  if (i === -1) continue;
  const fin = t.indexOf('\n  `,', i);
  const cuerpo = t.slice(i + 11, fin === -1 ? undefined : fin);
  if (cuerpo.includes('`')) {
    const linea = t.slice(0, i + 11 + cuerpo.indexOf('`')).split('\n').length;
    console.error(`✗ src/app/${f}:${linea} · acento grave dentro del template`);
    malos++;
  }
}
console.log(malos === 0 ? '✓ ningún acento grave en los templates'
                        : `${malos} archivo(s) con el problema`);
process.exit(malos === 0 ? 0 : 1);
