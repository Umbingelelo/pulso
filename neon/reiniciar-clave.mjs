/**
 * Reinicia la contraseña de un alumno. Mantención del docente.
 *
 * Existe porque **todavía no hay pantalla de recuperar contraseña**: cuando un
 * alumno olvida la suya, no tiene forma de volver a entrar por sí mismo y depende
 * de que alguien se la reinicie. Mientras eso siga así, esto es el camino.
 *
 * Va por el rol dueño y escribe directo en `usuarios`, que es la única forma:
 * `cambiar_clave()` exige la contraseña actual —justamente la que el alumno no
 * recuerda—. El hash lo calcula Postgres con el mismo bcrypt que usa el resto de
 * la plataforma (`crypt` + `gen_salt('bf')`), así que la clave nueva funciona
 * igual que una puesta por el propio alumno. La contraseña en claro no se guarda
 * en ninguna parte, y el hash no se imprime.
 *
 * Al terminar comprueba el cambio llamando a `autenticar()`, para no dejarte con
 * la duda de si quedó bien.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/reiniciar-clave.mjs --correo br.alvarezz@duocuc.cl --clave "..."
 *
 * Con `--buscar <texto>` lista candidatos por nombre o correo y no cambia nada.
 */
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? true]);
    return acc;
  }, []),
);

if (!process.env.DATABASE_URL_OWNER) {
  console.error('Falta DATABASE_URL_OWNER.  set -a; . ./.env.local; set +a');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL_OWNER);

// ---------- Buscar ----------

if (args.buscar) {
  const patron = `%${args.buscar}%`;
  const filas = await sql`
    select u.correo, p.nombre,
           string_agg(a.sigla || ' ' || s.codigo, ', ') as ramos,
           u.ultimo_ingreso
      from public.usuarios u
      left join public.perfiles    p  on p.id = u.id
      left join public.matriculas  mt on mt.perfil_id = p.id
      left join public.secciones   s  on s.id = mt.seccion_id
      left join public.asignaturas a  on a.id = s.asignatura_id
     where p.nombre ilike ${patron} or u.correo ilike ${patron}
     group by u.correo, p.nombre, u.ultimo_ingreso
     order by p.nombre`;
  if (!filas.length) console.log(`Nadie calza con «${args.buscar}».`);
  else console.table(filas);
  process.exit(0);
}

// ---------- Reiniciar ----------

if (!args.correo || typeof args.clave !== 'string') {
  console.error('Uso:  node neon/reiniciar-clave.mjs --correo <correo> --clave <clave>');
  console.error('      node neon/reiniciar-clave.mjs --buscar <nombre o correo>');
  process.exit(1);
}

const correo = String(args.correo).trim();
const clave = args.clave;

// Se busca por coincidencia exacta e insensible a mayúsculas, igual que
// `autenticar()`. Nada de `ilike '%…%'` acá: un patrón que calce con dos cuentas
// le cambiaría la contraseña a la persona equivocada.
const encontrados = await sql`
  select u.id, u.correo, p.nombre,
         string_agg(a.sigla || ' ' || s.codigo, ', ') as ramos
    from public.usuarios u
    left join public.perfiles    p  on p.id = u.id
    left join public.matriculas  mt on mt.perfil_id = p.id
    left join public.secciones   s  on s.id = mt.seccion_id
    left join public.asignaturas a  on a.id = s.asignatura_id
   where lower(u.correo) = lower(${correo})
   group by u.id, u.correo, p.nombre`;

if (!encontrados.length) {
  console.error(`No existe ninguna cuenta con el correo ${correo}.`);
  console.error('Busca con:  node neon/reiniciar-clave.mjs --buscar <nombre>');
  process.exit(1);
}
if (encontrados.length > 1) {
  console.error(`Hay ${encontrados.length} cuentas con ese correo. No toco ninguna.`);
  console.table(encontrados);
  process.exit(1);
}

const quien = encontrados[0];

if (clave.length < 8) {
  console.warn(`Aviso: «${'•'.repeat(clave.length)}» tiene ${clave.length} caracteres.`);
  console.warn('El ingreso la acepta, pero registrar_alumno() y cambiar_clave() exigen 8.');
  console.warn('O sea: entra con ella, pero para cambiársela él mismo tendrá que poner 8 o más.');
}

await sql`
  update public.usuarios
     set clave_hash = crypt(${clave}, gen_salt('bf'))
   where id = ${quien.id}::uuid`;

// La comprobación importa: `autenticar()` es exactamente lo que corre al iniciar
// sesión, así que si esto pasa, el alumno entra.
const [ok] = await sql`select public.autenticar(${quien.correo}, ${clave}) as id`;

console.log(`\nAlumno   ${quien.nombre}`);
console.log(`Correo   ${quien.correo}`);
console.log(`Ramos    ${quien.ramos ?? '(sin matrícula)'}`);
console.log(ok?.id === quien.id
  ? 'Estado   contraseña cambiada y comprobada con autenticar(): puede entrar.'
  : 'Estado   ¡el cambio NO quedó! autenticar() no la reconoce.');

process.exit(ok?.id === quien.id ? 0 : 1);
