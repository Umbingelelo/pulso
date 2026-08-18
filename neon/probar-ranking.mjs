/**
 * La tabla de posiciones: que sea de la sección y que se pueda dibujar.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-ranking.mjs [--sigla DSY1107]
 *
 * ── Qué se vigila ──
 *
 * **Que compare con la sección y no con la asignatura.** Comparaba con toda la
 * asignatura, y en DSY1107 eso pone las tres secciones en la misma tabla: 001D
 * lleva 2.175 de XP contra 75 de 002D, así que los de las otras dos aparecían al
 * fondo de una lista que no era la suya. Una sección es un curso; es la unidad
 * con la que un alumno se compara.
 *
 * **Y que no filtre a nadie de otra sección**, que es lo mismo visto como
 * privacidad: el ranking deja ver nombre, cara, título y XP, y eso solo tiene que
 * alcanzar a los compañeros de sala.
 *
 * No escribe nada.
 */
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] ?? true]);
    return a;
  }, []),
);
const SIGLA = args.sigla ?? 'DSY1107';

const d = neon(process.env.DATABASE_URL_OWNER);
let fallos = 0;
const rev = (e, real, esp) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esp)}`));
};
async function como(usuarioId, consulta) {
  const r = await d.transaction([
    d`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    d`set local role pulso_app`,
    consulta(d),
  ]);
  return r[2] ?? [];
}

// Un alumno de verdad por cada sección, para mirar el ranking con sus ojos.
const muestras = await d`
  select distinct on (s.codigo)
         s.codigo as seccion, mt.id as matricula, u.id as usuario, p.nombre,
         (select count(*)::int from public.matriculas m2
            join public.perfiles p2 on p2.id = m2.perfil_id
           where m2.seccion_id = s.id and m2.activa
             and not p2.oculto_en_ranking) as en_su_seccion
    from public.matriculas mt
    join public.perfiles    p on p.id = mt.perfil_id
    join public.usuarios    u on u.id = p.id
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas a on a.id = s.asignatura_id
   where a.sigla = ${SIGLA} and mt.activa
     and not exists (select 1 from public.docentes dd where dd.id = p.id)
     -- Ni la cuenta de pruebas: está oculta del ranking a propósito, así que
     -- mirarlo «con sus ojos» daría un «no aparece» que es correcto y confunde.
     and not p.oculto_en_ranking
   order by s.codigo, p.nombre`;
if (!muestras.length) throw new Error(`No hay alumnos en ${SIGLA}.`);

console.log(`${SIGLA} · ${muestras.length} secciones\n`);

for (const m of muestras) {
  console.log(`Sección ${m.seccion} — mirando con ${m.nombre}`);
  const tabla = await como(m.usuario, (s) =>
    s`select * from public.tabla_posiciones(${m.matricula}::uuid, 40)`);

  // Todos los de la tabla tienen que ser de su sección.
  const ids = tabla.map((f) => f.matricula_id);
  const [ajenos] = await d`
    select count(*)::int as n
      from public.matriculas mt
     where mt.id = any(${ids}::uuid[])
       and mt.seccion_id <> (select seccion_id from public.matriculas where id = ${m.matricula})`;
  rev('nadie de otra sección en la tabla', ajenos.n, 0);
  rev('él mismo aparece', tabla.filter((f) => f.soy_yo).length, 1);

  // El orden es por experiencia, de mayor a menor.
  const xps = tabla.map((f) => f.xp);
  rev('ordenada por experiencia', [...xps].sort((a, b) => b - a), xps);

  // Los empatados comparten lugar: es `rank()`, no `row_number()`.
  const porXp = new Map();
  for (const f of tabla) {
    if (!porXp.has(f.xp)) porXp.set(f.xp, f.lugar);
    else if (porXp.get(f.xp) !== f.lugar) {
      rev(`los empatados en ${f.xp} XP comparten lugar`, f.lugar, porXp.get(f.xp));
    }
  }

  // Y que la pantalla pueda dibujarlo: cada fila necesita algo que poner en el
  // `src`. Antes iba el avatar en crudo, y «thumbs:ana» no es una URL.
  const sinCara = tabla.filter((f) => !f.avatar || !String(f.avatar).trim());
  rev('todos tienen avatar que dibujar', sinCara.length, 0);
  const conTitulo = tabla.filter((f) => f.titulo).length;
  console.log(`  · ${tabla.length} de ${m.en_su_seccion} en su sección · ` +
    `${conTitulo} con título · XP de ${Math.max(...xps)} a ${Math.min(...xps)}`);
}

// El techo del ranking: lo que ve un alumno no puede pasarse del tamaño de su
// sección, y `--limite` no puede abrir la puerta a otras.
console.log('\nEl límite no abre otras secciones');
const m0 = muestras[0];
const grande = await como(m0.usuario, (s) =>
  s`select * from public.tabla_posiciones(${m0.matricula}::uuid, 200)`);
rev('pedir 200 no trae más que su sección', grande.length <= m0.en_su_seccion, true);

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
