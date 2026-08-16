/**
 * Extrae de Lucide los trazos de los iconos que la tienda usa, a un archivo TS.
 *
 * Se generan en vez de escribirse a mano por dos razones: dibujar a ojo algo que
 * «se parece a Lucide» produce un set inconsistente —grosores distintos, esquinas
 * distintas— que es justo lo que hace que una interfaz se vea amateur; y así
 * agregar un premio nuevo es agregar su nombre acá y volver a correr esto.
 *
 * No se importa la librería en tiempo de ejecución: son 2.025 iconos y el alumno
 * bajaría todos para usar dieciséis.
 *
 *   node neon/generar-iconos.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

// Los que usa la interfaz y no vienen de ningún premio: los avisos del
// enunciado de un laboratorio, sus puntos de control y su marca de entregado.
const DE_LA_INTERFAZ = [
  'triangle-alert', 'lightbulb', 'eye', 'flag', 'flask-conical', 'check',
];

const sql = neon(process.env.DATABASE_URL_OWNER);
const usados = await sql`
  select distinct icono from public.articulos where icono is not null order by icono`;

const nombres = [...new Set([...usados.map((u) => u.icono), ...DE_LA_INTERFAZ])].sort();

const partes = [];
for (const icono of nombres) {
  const svg = await readFile(`node_modules/lucide-static/icons/${icono}.svg`, 'utf8');
  // Solo el interior: el <svg> lo pone el componente, con su tamaño y su color.
  const cuerpo = svg.replace(/[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*/, '')
                    .replace(/\s+/g, ' ').trim();
  partes.push(`  '${icono}': '${cuerpo.replace(/'/g, "\\'")}',`);
}

await writeFile('src/app/iconos.ts', `/**
 * Iconos de Lucide, generados por \`neon/generar-iconos.mjs\`. No editar a mano.
 *
 * Solo los que se usan: la librería trae más de dos mil y no tiene sentido que
 * el alumno los baje todos. Para agregar uno, se le pone el nombre a un artículo
 * —o a la lista DE_LA_INTERFAZ del generador— y se vuelve a correr.
 *
 * Lucide · ISC · https://lucide.dev
 */
export const ICONOS: Record<string, string> = {
${partes.join('\n')}
};
`);
console.log(`${nombres.length} iconos escritos en src/app/iconos.ts`);
