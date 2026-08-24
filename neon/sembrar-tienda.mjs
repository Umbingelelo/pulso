/**
 * La tienda: los premios que definió el docente, con precio y con icono.
 *
 * ── Cómo se fijaron los precios ──
 *
 * El techo del semestre manda. Con la escala nueva un alumno de DSY1107 gana
 * ~1.480 puntos de las 16 clases, más 100 de registro, 50 del diagnóstico y unos
 * 1.200 de los doce laboratorios: cerca de **2.800 en el semestre, ~950 por
 * parcial**. En ITY1102 son algo menos.
 *
 * Las bandas salen de ese parcial de ~950 y respetan el esfuerzo que asignó el
 * docente, que es quien sabe cuánto cuesta cada cosa en su curso:
 *
 *     Baja      150 – 200    se alcanza dentro de un parcial, sin ahorrar
 *     Media     350 – 450    la mitad de lo que rinde un parcial
 *     Alta      700 – 900    casi todo un parcial
 *     Muy alta 1.800 – 2.200 hay que ahorrar dos parciales enteros
 *
 * ── Los iconos ──
 *
 * Nombres de **Lucide**, no emojis. Los emojis dependen de la fuente del sistema,
 * se ven distintos en cada equipo y no se pueden teñir con los colores de la
 * marca. Los trazos SVG viven en `src/app/iconos.ts`, generado desde la librería
 * con solo los que se usan.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/sembrar-tienda.mjs
 */
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_OWNER);

/**
 * `porEP` marca los que el docente limitó a uno por evaluación parcial. Como el
 * límite de la tabla es por semestre, se deja en 3: uno por cada parcial.
 */
const PREMIOS = [
  // código                 nombre                                    categoría     esfuerzo    precio icono            límite
  ['gacha-tirada',         'Una tirada de gacha',                     'gacha',      'Baja',        150, 'dices',         null,
   'Una tirada en el pozo del gacha. Puede salir un ícono o un título, de cualquier rareza, '
   + 'de todo lo que todavía no tengas. Lo del pase no entra: eso se gana subiendo de nivel.'],
  ['decimas-02',           '0,2 puntos en una evaluación',            'nota',       'Baja',        200, 'trending-up',      3,
   'Se suman a la nota de la evaluación que elijas. Uno por parcial.'],
  ['llegar-tarde',         'Llegar tarde a clase',                    'comodin',    'Media',       350, 'alarm-clock',      3,
   'Entras después de la hora sin que cuente como atraso. Una vez por parcial.'],
  ['cambiar-orden',        'Cambiar el orden de presentación',        'evaluacion', 'Media',       350, 'arrow-up-down',    3,
   'Eliges en qué lugar de la lista presenta tu equipo.'],
  ['cambiar-pregunta',     'Cambiar una pregunta de la defensa',      'evaluacion', 'Media',       400, 'repeat-2',         3,
   'Pides que te cambien una pregunta por otra. Se responde igual.'],
  ['decimas-05',           '0,5 puntos en una evaluación',            'nota',       'Media',       450, 'chart-line',       3,
   'Se suman a la nota de la evaluación que elijas. Uno por parcial.'],
  ['napping-day',          'Napping Day: faltar a una clase',         'comodin',    'Alta',        700, 'bed',              2,
   'Una inasistencia que no cuenta. Avisa antes, no después.'],
  ['perdonazo',            'Perdonazo por atraso a presentación',     'comodin',    'Alta',        700, 'shield-check',     2,
   'Llegas tarde a la hora citada de una presentación y no se descuenta.'],
  ['aplazo-24',            '24 horas más para una entrega',           'plazo',      'Alta',        750, 'calendar-clock',   2,
   'Un día extra de plazo. Se pide antes de la fecha, no después.'],
  ['analisis-privado',     'Análisis privado de tu proyecto',         'apoyo',      'Alta',        750, 'microscope',       2,
   'Media hora a solas revisando tu proyecto conmigo, antes de la entrega.'],
  ['pasapalabra',          'Pasapalabra: omitir una pregunta',        'evaluacion', 'Alta',        800, 'skip-forward',     2,
   'Saltas una pregunta de la defensa sin que cuente como error.'],
  ['reentregar',           'Volver a entregar tras conocer la nota',  'plazo',      'Alta',        850, 'rotate-ccw',       1,
   'Corriges y vuelves a entregar dentro de las 24 horas siguientes a la nota.'],
  ['punto-completo',       '1 punto en una evaluación',               'nota',       'Alta',        900, 'award',            3,
   'Un punto entero sobre la nota de la evaluación que elijas. Uno por parcial.'],
  ['ruleta-nota',          'No dar la prueba y tirar la ruleta',      'nota',       'Muy alta',   1800, 'dice-5',           1,
   'Cambias tu evaluación por un sorteo: 50% un 1, 40% un 4, 9% un 5, 0,8% un 6 y 0,2% un 7.'],
  ['desbloquear-defensa',  'Desbloquear las preguntas de la defensa', 'evaluacion', 'Muy alta',   2200, 'key-round',        1,
   'Ves las preguntas de tu defensa antes del día. Una sola vez en el semestre.'],
];

/** Los que tocan nota o plazo pasan por el visto bueno del docente. */
const SIN_APROBACION = new Set(['gacha-tirada']);

/**
 * Cuántas tiradas de gacha entrega cada artículo al canjearlo.
 *
 * Vive acá y no en el cuerpo de `solicitar_canje` a propósito: el catálogo es donde
 * el docente ya define precio, límite y stock, así que también dice qué entrega. Un
 * paquete de cinco tiradas es una fila, no una migración.
 *
 * Antes esto no existía y era el agujero: los dos artículos de gacha cobraban 150
 * puntos y **no entregaban nada**, porque nadie escribía en `movimientos_tiradas`
 * desde un canje. Ver `0031_una_sola_tirada.sql`.
 */
const TIRADAS = new Map([['gacha-tirada', 1]]);

const ambitos = await sql`
  select a.id as asignatura_id, p.id as periodo_id, a.sigla
    from public.asignaturas a, public.periodos p
   where p.codigo = '2026-2' and a.activa`;

for (const am of ambitos) {
  // Lo que no está en la lista se **retira**, no se borra.
  //
  // Antes era un `delete`, y el comentario decía «nadie ha canjeado nada». Eso dejó
  // de ser cierto: hay canjes apuntando a artículos retirados y
  // `canjes.articulo_id` es `on delete restrict`, así que el borrado ya no fallaría
  // en silencio — fallaría la corrida entera. Y si la FK fuera en cascada sería
  // peor: se llevaría el historial de compras de esos alumnos.
  //
  // Retirarlo hace lo que se quiere: sale de la vitrina —que filtra por `activo`— y
  // el canje que alguien hizo sigue en su historial con el nombre de lo que compró.
  const retirados = await sql`
    update public.articulos set activo = false
     where asignatura_id = ${am.asignatura_id} and periodo_id = ${am.periodo_id}
       and activo and codigo <> all(${PREMIOS.map((p) => p[0])})
    returning codigo`;
  if (retirados.length) {
    console.log(`${am.sigla}: retirados ${retirados.map((r) => r.codigo).join(', ')}`);
  }

  let orden = 0;
  for (const [codigo, nombre, categoria, esfuerzo, precio, icono, limite, descripcion] of PREMIOS) {
    orden++;
    await sql`
      insert into public.articulos (asignatura_id, periodo_id, codigo, nombre, descripcion,
                                    detalle, categoria, icono, precio, requiere_aprobacion,
                                    limite_por_alumno, activo, orden, tiradas)
      values (${am.asignatura_id}, ${am.periodo_id}, ${codigo}, ${nombre}, ${descripcion},
              ${'Esfuerzo ' + esfuerzo}, ${categoria}, ${icono}, ${precio},
              ${!SIN_APROBACION.has(codigo)}, ${limite}, true, ${orden},
              ${TIRADAS.get(codigo) ?? null})
      on conflict (asignatura_id, periodo_id, codigo) do update
        set nombre = excluded.nombre, descripcion = excluded.descripcion,
            detalle = excluded.detalle, categoria = excluded.categoria,
            icono = excluded.icono, precio = excluded.precio,
            requiere_aprobacion = excluded.requiere_aprobacion,
            limite_por_alumno = excluded.limite_por_alumno, orden = excluded.orden,
            tiradas = excluded.tiradas, activo = true`;
  }
  console.log(`${am.sigla}: ${PREMIOS.length} premios`);
}
