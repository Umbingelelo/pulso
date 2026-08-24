/**
 * El recorrido completo de un laboratorio, con el alumno de prueba.
 *
 * Llama a las mismas funciones de Postgres que llama `/api/laboratorio`, con la
 * misma identidad puesta igual y como el mismo rol `pulso_app` con RLS aplicado.
 * Lo único que no ejercita es el HTTP y el navegador.
 *
 * Además de que el camino feliz funcione, comprueba lo que de verdad duele:
 * que no se pueda entregar en blanco, que después de entregar no se pueda seguir
 * escribiendo, que no se pueda entregar dos veces —serían puntos duplicados— y
 * que el laboratorio de otro ramo no se vea. Un laboratorio son dos horas de
 * trabajo del alumno; los modos de falla caros son los que pierden ese trabajo o
 * lo dejan cobrar de más.
 *
 * Deja el estado como estaba: borra su avance al empezar y al terminar.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/probar-laboratorio.mjs [--codigo L1]
 */
import { neon } from '@neondatabase/serverless';

const CORREO = 'alumno.prueba@duocuc.cl';
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => {
    if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1]]);
    return a;
  }, []),
);
const CODIGO = args.codigo ?? 'L1';
/**
 * Con qué asignatura, cuando el código no alcanza.
 *
 * Desde que ITY1102 tiene su propio `L1`, buscar solo por código encuentra dos
 * laboratorios distintos y la prueba corría sobre el que Postgres devolviera
 * primero. Verde en los dos casos, pero sin saber cuál se probó — que es lo mismo
 * que no haber probado.
 */
const SIGLA = args.sigla ?? null;

const dueno = neon(process.env.DATABASE_URL_OWNER);
const app = neon(process.env.DATABASE_URL_OWNER);

let fallos = 0;
const rev = (e, real, esp) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${e}: ${JSON.stringify(real)}` +
    (ok ? '' : `  ← esperaba ${JSON.stringify(esp)}`));
};

/** Igual que `lib/identidad.mjs`: identidad a mano, local a la transacción. */
async function comoAlumno(usuarioId, consulta) {
  const r = await app.transaction([
    app`select set_config('pulso.usuario_id', ${usuarioId}, true)`,
    app`set local role pulso_app`,
    consulta(app),
  ]);
  return r[2] ?? [];
}

/** Falla a propósito: devuelve el mensaje en vez de reventar. */
async function debeFallar(etiqueta, usuarioId, consulta, contiene) {
  try {
    await comoAlumno(usuarioId, consulta);
    fallos++;
    console.log(`  ✗ ${etiqueta}: no falló, y tenía que fallar`);
  } catch (e) {
    const ok = (e.message ?? '').includes(contiene);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: «${e.message}»` +
      (ok ? '' : `  ← esperaba que dijera «${contiene}»`));
  }
}

// ---------- Preparación ----------

const [alumno] = await dueno`
  select u.id from public.usuarios u where lower(u.correo) = ${CORREO}`;
if (!alumno) throw new Error(`No existe ${CORREO}.`);

const candidatos = await dueno`
  select mt.id as matricula, a.id as actividad, a.titulo, a.puntos, l.cajas, l.controles,
         asg.sigla
    from public.matriculas mt
    join public.secciones   s on s.id = mt.seccion_id
    join public.asignaturas asg on asg.id = s.asignatura_id
    join public.actividades a on a.asignatura_id = s.asignatura_id
                             and a.periodo_id    = s.periodo_id
    join public.laboratorios l on l.actividad_id = a.id
   where mt.perfil_id = ${alumno.id} and a.codigo = ${CODIGO}
     and (${SIGLA}::text is null or asg.sigla = ${SIGLA})
   order by asg.sigla`;
if (!candidatos.length) {
  throw new Error(`El alumno de prueba no tiene el laboratorio ${CODIGO}` +
    (SIGLA ? ` en ${SIGLA}.` : '.'));
}
if (candidatos.length > 1) {
  // Se para en vez de elegir: correr sobre uno cualquiera y decir «todo bien»
  // deja el otro sin probar y a nadie enterado.
  console.error(`Hay ${candidatos.length} laboratorios con el código ${CODIGO}: ` +
    candidatos.map((c) => c.sigla).join(', '));
  console.error(`Elige uno:  node neon/probar-laboratorio.mjs --codigo ${CODIGO} --sigla ${candidatos[0].sigla}`);
  process.exit(1);
}
const m = candidatos[0];

/**
 * Deja la matrícula como estaba.
 *
 * Se borra por dos criterios, y hacen falta los dos.
 *
 * **Por marca de agua**, porque un filtro por «L1» no calza con nada: el trigger
 * escribe el **título** de la actividad, no su código, y por eso cada corrida le
 * dejaba cien puntos regalados al alumno de prueba. Lo que hay después de la
 * marca es lo que hizo esta corrida y nada más.
 *
 * **Y por motivo**, porque la marca sola no alcanza: si una corrida se muere
 * después de entregar —una tubería cortada con `| head` basta— sus puntos quedan
 * ahí, y la corrida siguiente calcula su marca **por encima** de ellos. Desde ese
 * momento son inalcanzables: quedan sumando para siempre y ninguna limpieza los
 * ve. Ya pasó. El título de la actividad es lo único que los identifica.
 */
const marca = async () => {
  const [r] = await dueno`select coalesce(max(id),0) as id
     from public.movimientos_puntos where matricula_id = ${m.matricula}`;
  return r.id;
};
let piso = await marca();

const limpiar = async () => {
  await dueno`delete from public.laboratorio_avance
               where matricula_id = ${m.matricula} and actividad_id = ${m.actividad}`;
  await dueno`delete from public.resultados_actividad
               where matricula_id = ${m.matricula} and actividad_id = ${m.actividad}`;
  await dueno`delete from public.movimientos_puntos
               where matricula_id = ${m.matricula}
                 and (id > ${piso} or motivo = ${m.titulo})`;
};
await limpiar();
// La marca se vuelve a tomar después de barrer: si esta corrida arrastró lo que
// dejó una anterior, el «saldo de antes» tiene que ser el ya limpio.
piso = await marca();

const saldo = async () => {
  const [r] = await dueno`select coalesce(sum(puntos),0)::int as p
     from public.movimientos_puntos where matricula_id = ${m.matricula}`;
  return r.p;
};
const antes = await saldo();

console.log(`${m.sigla} · laboratorio ${CODIGO} · ${m.cajas} cajas · ${m.controles} controles · ${m.puntos} puntos`);

// ---------- Leerlo ----------

console.log('\nAbrirlo');
const [{ r: lab }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('trae el enunciado', Array.isArray(lab?.bloques) && lab.bloques.length > 0, true);
rev('cajas', lab?.cajas, m.cajas);
rev('empieza sin respuestas', lab?.respuestas, {});
rev('empieza en el tramo 0', lab?.tramo, 0);
rev('sin entregar', lab?.entregado_en, null);

const idsDeCaja = lab.bloques.filter((b) => b.tipo === 'caja').map((b) => b.id);
rev('los identificadores no se repiten', new Set(idsDeCaja).size, idsDeCaja.length);
rev('ninguna caja sin identificador', idsDeCaja.every((x) => !!x), true);

// ---------- El enunciado que quedó guardado ----------
// `probar-compilador.mjs` ya revisa el Markdown antes de subir. Esto revisa lo
// que hay **en la base**, que es otra cosa: una fila puede venir de una versión
// vieja del compilador, o de una subida a mano. Y un enunciado roto no falla en
// ninguna parte: llega así a la pantalla del alumno.

console.log('\nEl enunciado');
const contenido = (b) => b.html ?? b.enunciado ?? '';
rev('todos los bloques son de un tipo conocido',
  lab.bloques.filter((b) => !['html', 'caja', 'control', 'aviso'].includes(b.tipo)), []);
rev('ningún bloque llegó vacío',
  lab.bloques.filter((b) => !contenido(b).trim()).map((b) => b.tipo), []);
rev('los formatos de caja son de los que el navegador dibuja',
  lab.bloques.filter((b) => b.tipo === 'caja' && !['corta', 'codigo'].includes(b.formato))
    .map((b) => `${b.id}=${b.formato}`), []);
rev('los avisos son de una clase que el navegador dibuja',
  lab.bloques.filter((b) => b.tipo === 'aviso' && !['alerta', 'pista', 'ojo'].includes(b.clase))
    .map((b) => b.clase), []);
// Un `:::` que sobrevive al compilador es un marcador que no se entendió y se
// fue de paseo como prosa. El alumno lo ve escrito tal cual en la pantalla.
rev('no quedó ningún ::: suelto en la prosa',
  lab.bloques.filter((b) => /<p>\s*:::/.test(contenido(b))).length, 0);

// El tramo es **un** número y la pantalla marca alcanzado todo control con
// `numero <= tramo`. Con un salto el alumno nunca llega al último; con un
// repetido, marcar uno marca los dos.
const numerosDeControl = lab.bloques.filter((b) => b.tipo === 'control').map((b) => b.numero);
rev('los controles van correlativos desde 1',
  numerosDeControl, numerosDeControl.map((_, i) => i + 1));

// Las columnas `cajas` y `controles` son las que dibujan la barra de progreso y
// las que cuenta el panel del docente. Si se despegan de los bloques, la barra
// nunca llega al 100% y nadie se entera de por qué.
rev('la columna «cajas» calza con los bloques', idsDeCaja.length, m.cajas);
rev('la columna «controles» calza con los bloques', numerosDeControl.length, m.controles);

// ---------- Entregar en blanco ----------
// Antes del camino feliz: si dejara entregar vacío, el alumno perdería su único
// intento con un clic sin querer y no habría vuelta atrás desde su lado.

console.log('\nLo que no se puede hacer todavía');
await debeFallar('no se entrega en blanco', alumno.id, (s) =>
  s`select public.laboratorio_entregar(${m.matricula}::uuid, ${CODIGO})`,
  'No has respondido ninguna caja');

// Con espacios en blanco tampoco: `trim` tiene que contar eso como vacío.
await comoAlumno(alumno.id, (s) =>
  s`select public.laboratorio_guardar(${m.matricula}::uuid, ${CODIGO},
      ${JSON.stringify({ [idsDeCaja[0]]: '   \n  ' })}::jsonb, 0)`);
await debeFallar('los espacios no cuentan como respuesta', alumno.id, (s) =>
  s`select public.laboratorio_entregar(${m.matricula}::uuid, ${CODIGO})`,
  'No has respondido ninguna caja');

// ---------- Ir escribiendo ----------

console.log('\nIr respondiendo');
const escritas = {};
for (const [i, id] of idsDeCaja.entries()) escritas[id] = `Respuesta de prueba a ${id} (${i})`;

await comoAlumno(alumno.id, (s) =>
  s`select public.laboratorio_guardar(${m.matricula}::uuid, ${CODIGO},
      ${JSON.stringify(escritas)}::jsonb, 1)`);
const [{ r: v1 }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('guardó todas', Object.keys(v1.respuestas).length, m.cajas);
rev('el texto es el mismo', v1.respuestas[idsDeCaja[0]], escritas[idsDeCaja[0]]);
rev('avanzó al tramo 1', v1.tramo, 1);

// El tramo solo sube: si vuelve atrás a corregir una caja no puede perder el
// punto de control que ya alcanzó delante del profesor.
await comoAlumno(alumno.id, (s) =>
  s`select public.laboratorio_guardar(${m.matricula}::uuid, ${CODIGO},
      ${JSON.stringify(escritas)}::jsonb, 0)`);
const [{ r: v2 }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('el tramo no retrocede', v2.tramo, 1);

rev('todavía no hay puntos', await saldo(), antes);

// ---------- Las sugerencias no impiden nada ----------
// Esta sección existe por una razón sola: el alumno pidió que la revisión por IA
// **nunca** sea un impedimento para entregar. Eso no se sostiene con buenas
// intenciones, se sostiene comprobándolo.

console.log('\nLas sugerencias');
const guardarRevision = (id, veredicto) => comoAlumno(alumno.id, (s) =>
  s`select public.laboratorio_revisar_guardar(
      ${m.matricula}::uuid, ${CODIGO}, ${id}, ${veredicto},
      ${'mensaje de prueba para ' + id}, ${'hash-' + id}) as r`);

const [{ r: unaRev }] = await guardarRevision(idsDeCaja[0], 'incompleto');
rev('se guarda una sugerencia', unaRev?.veredicto, 'incompleto');

const [{ r: conRev }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('viene con el laboratorio', conRev.revisiones[idsDeCaja[0]]?.veredicto, 'incompleto');
rev('y trae su hash para no volver a llamar al modelo',
  conRev.revisiones[idsDeCaja[0]]?.hash, `hash-${idsDeCaja[0]}`);

// Guardar respuestas no puede borrar las sugerencias: son dos columnas del mismo
// jsonb y un `set` mal escrito se las llevaría sin que nadie lo note.
await comoAlumno(alumno.id, (s) =>
  s`select public.laboratorio_guardar(${m.matricula}::uuid, ${CODIGO},
      ${JSON.stringify(escritas)}::jsonb, 1)`);
const [{ r: trasGuardar }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('seguir escribiendo no las borra',
  trasGuardar.revisiones[idsDeCaja[0]]?.veredicto, 'incompleto');

await debeFallar('una caja inventada se rechaza', alumno.id, (s) =>
  s`select public.laboratorio_revisar_guardar(${m.matricula}::uuid, ${CODIGO},
      'no-existe', 'logrado', 'x', 'y')`, 'no existe en este laboratorio');
await debeFallar('un veredicto inventado se rechaza', alumno.id, (s) =>
  s`select public.laboratorio_revisar_guardar(${m.matricula}::uuid, ${CODIGO},
      ${idsDeCaja[0]}, 'reprobado', 'x', 'y')`, 'Veredicto desconocido');
// Todas en «incompleto»: el peor caso posible para el alumno. Tiene que poder
// entregar exactamente igual, y eso lo comprueba la sección siguiente.
for (const id of idsDeCaja) await guardarRevision(id, 'incompleto');
const [{ r: todasMal }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('quedan todas en incompleto',
  Object.values(todasMal.revisiones).every((x) => x.veredicto === 'incompleto'), true);

// ---------- La pauta ----------
// La respuesta correcta que escribió el docente. Lo único que hay que comprobar
// acá es lo que la hace segura: que la trae la función del servidor y que **no
// viene pegada al enunciado**, porque el enunciado sí viaja al navegador.

console.log('\nLa pauta');
const [{ pautas: pautasCrudas }] = await dueno`
  select coalesce(l.pautas, '{}'::jsonb) as pautas
    from public.laboratorios l where l.actividad_id = ${m.actividad}`;
const conPauta = Object.keys(pautasCrudas);
console.log(`  · ${CODIGO} tiene pauta en ${conPauta.length} de ${idsDeCaja.length} cajas`);

const [{ r: paraElNavegador }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('el enunciado que viaja al navegador no trae pautas',
  Object.keys(paraElNavegador).includes('pautas'), false);
// Y no solo la llave: ni una frase de ninguna pauta puede estar en lo que viaja.
const viajado = JSON.stringify(paraElNavegador);
const filtradas = conPauta.filter((id) => pautasCrudas[id].split(/[\n.;]/)
  .some((f) => f.trim().length >= 60 && viajado.includes(f.trim())));
rev('ni el texto de una pauta se filtró en él', filtradas, []);

if (conPauta.length) {
  const [{ p }] = await comoAlumno(alumno.id, (s) =>
    s`select public.laboratorio_pauta(${m.matricula}::uuid, ${CODIGO}, ${conPauta[0]}) as p`);
  rev(`el servidor sí puede leer la pauta de ${conPauta[0]}`, p === pautasCrudas[conPauta[0]], true);
  // Una caja sin pauta devuelve null, no un error: es el caso de L0, L1 y X1
  // enteros, y quien llama tiene que poder distinguirlo de una falla.
  const [{ p: nada }] = await comoAlumno(alumno.id, (s) =>
    s`select public.laboratorio_pauta(${m.matricula}::uuid, ${CODIGO}, 'no-existe') as p`);
  rev('una caja sin pauta devuelve nulo y no revienta', nada, null);
}

// ---------- Entregar ----------

console.log('\nEntregar');
const [{ r: entrega }] = await comoAlumno(alumno.id, (s) =>
  s`select public.laboratorio_entregar(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('entregado', entrega?.entregado, true);
// La garantía: con las 16 sugerencias en «incompleto», entregar da lo mismo que
// sin ninguna. Ni cuenta distinto, ni paga menos, ni se queja.
rev('con todas las sugerencias en incompleto, entrega igual', entrega?.entregado, true);
rev('cuenta las respondidas', entrega?.respondidas, m.cajas);
rev('pagó los puntos completos', await saldo() - antes, m.puntos);

const [{ r: v3 }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, ${CODIGO}) as r`);
rev('queda con fecha de entrega', typeof v3.entregado_en === 'string', true);

// ---------- Después de entregar ----------

console.log('\nDespués de entregar');
await debeFallar('no se puede seguir escribiendo', alumno.id, (s) =>
  s`select public.laboratorio_guardar(${m.matricula}::uuid, ${CODIGO},
      ${JSON.stringify({ ...escritas, [idsDeCaja[0]]: 'cambiado' })}::jsonb, 2)`,
  'Ya lo entregaste');
await debeFallar('no se entrega dos veces', alumno.id, (s) =>
  s`select public.laboratorio_entregar(${m.matricula}::uuid, ${CODIGO})`,
  'Ya lo habías entregado');
rev('los puntos no se duplicaron', await saldo() - antes, m.puntos);

// Entregar cierra la edición pero no el aprendizaje: la sugerencia es la única
// retroalimentación que va a recibir sobre lo que escribió, así que se puede
// pedir después. Es la diferencia con `laboratorio_guardar`, que sí se cierra.
const [{ r: revTras }] = await guardarRevision(idsDeCaja[1], 'logrado');
rev('sí se puede pedir sugerencia después de entregar', revTras?.veredicto, 'logrado');

// ---------- Lo que no es suyo ----------

console.log('\nLo que no es suyo');
const [otra] = await dueno`
  select id from public.matriculas where id <> ${m.matricula} limit 1`;
if (otra) {
  await debeFallar('no lee el laboratorio de otro', alumno.id, (s) =>
    s`select public.mi_laboratorio(${otra.id}::uuid, ${CODIGO})`, 'no es tuya');
  await debeFallar('no escribe en el de otro', alumno.id, (s) =>
    s`select public.laboratorio_guardar(${otra.id}::uuid, ${CODIGO}, '{}'::jsonb, 0)`,
    'no es tuya');
  await debeFallar('no revisa la caja de otro', alumno.id, (s) =>
    s`select public.laboratorio_revisar_guardar(${otra.id}::uuid, ${CODIGO},
        ${idsDeCaja[0]}, 'logrado', 'x', 'y')`, 'no es tuya');
  await debeFallar('no lee la pauta con la matrícula de otro', alumno.id, (s) =>
    s`select public.laboratorio_pauta(${otra.id}::uuid, ${CODIGO}, ${idsDeCaja[0]})`,
    'no es tuya');
}
const [{ r: inexistente }] = await comoAlumno(alumno.id, (s) =>
  s`select public.mi_laboratorio(${m.matricula}::uuid, 'NO-EXISTE') as r`);
rev('un código que no existe da nulo', inexistente, null);

// ---------- Lo que ve el docente ----------

console.log('\nLo que ve el docente');
const [docente] = await dueno`
  select id from public.usuarios where lower(correo) = 'cr.calderons@profesor.duoc.cl'`;
if (docente) {
  const [ambito] = await dueno`
    select a.asignatura_id, a.periodo_id from public.actividades a where a.id = ${m.actividad}`;
  const filas = await comoAlumno(docente.id, (s) =>
    s`select * from public.laboratorio_avances(
        ${ambito.asignatura_id}::uuid, ${ambito.periodo_id}::uuid, ${CODIGO})`);
  const mia = filas.find((x) => x.matricula_id === m.matricula);
  rev('ve al alumno de prueba', !!mia, true);
  rev('con sus respuestas contadas', mia?.respondidas, m.cajas);
  // `mi_laboratorio` devuelve jsonb, así que ahí la fecha llega como cadena;
  // acá es una columna timestamptz y el driver la convierte en Date.
  rev('y su entrega', !!mia?.entregado_en, true);
}

// ---------- Dejarlo como estaba ----------

await limpiar();
const despues = await saldo();
rev('el saldo vuelve a como estaba', despues, antes);

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
