/**
 * La tienda: los premios que definió el docente, con precio y con icono.
 *
 * ── Cómo se fijaron los precios ──
 *
 * Un alumno de DSY1107 puede ganar **750 puntos en todo el semestre** —600 de las
 * 16 clases, 100 del registro, 50 del diagnóstico— más hasta 144 del sobrante del
 * pase si completa los tres. En ITY1102 son 615. Ese techo es el que manda.
 *
 * El principio: **con todo el semestre alcanza para comprar, como máximo, un
 * punto de nota**. De ahí sale la escala de 600 puntos por punto de calificación,
 * y de ahí bajan las demás bandas:
 *
 *     Baja       40 – 60     se puede varias veces
 *     Media     100 – 130    una decisión real dentro de un parcial
 *     Alta      180 – 250    casi todo lo que se gana en un parcial
 *     Muy alta  400 – 550    hay que ahorrar dos parciales
 *
 * Gastar todo en nota deja sin nada para lo demás. Esa tensión es el punto: si
 * todo fuera barato, no habría elección que tomar.
 *
 * ── Los iconos ──
 *
 * Nombres de **Lucide**, no emojis. Los emojis dependen de la fuente del sistema,
 * se ven distintos en cada equipo y no se pueden teñir con los colores de la
 * marca. Los trazos SVG viven en el componente de la tienda, que solo carga los
 * que usa.
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
  // código                 nombre                                    categoría     esfuerzo  precio icono            límite
  ['llegar-tarde',         'Llegar tarde a clase',                    'comodin',    'Baja',       40, 'alarm-clock',      3,
   'Entras después de la hora sin que cuente como atraso. Una vez por parcial.'],
  ['gacha-iconos',         'Tirada exclusiva de íconos',              'gacha',      'Baja',       50, 'sparkles',      null,
   'Una tirada en el pozo que solo entrega íconos y avatares.'],
  ['gacha-titulos',        'Tirada exclusiva de títulos',             'gacha',      'Baja',       50, 'dices',         null,
   'Una tirada en el pozo que solo entrega títulos.'],
  ['decimas-02',           '0,2 puntos en una evaluación',            'nota',       'Baja',      120, 'trending-up',      3,
   'Se suman a la nota de la evaluación que elijas. Uno por parcial.'],
  ['cambiar-orden',        'Cambiar el orden de presentación',        'evaluacion', 'Media',     100, 'arrow-up-down',    3,
   'Eliges en qué lugar de la lista presenta tu equipo.'],
  ['cambiar-pregunta',     'Cambiar una pregunta de la defensa',      'evaluacion', 'Media',     120, 'repeat-2',         3,
   'Pides que te cambien una pregunta por otra. Se responde igual.'],
  ['perdonazo',            'Perdonazo por atraso a presentación',     'comodin',    'Alta',      180, 'shield-check',     2,
   'Llegas tarde a la hora citada de una presentación y no se descuenta.'],
  ['napping-day',          'Napping Day: faltar a una clase',         'comodin',    'Alta',      180, 'bed',              2,
   'Una inasistencia que no cuenta. Avisa antes, no después.'],
  ['analisis-privado',     'Análisis privado de tu proyecto',         'apoyo',      'Alta',      200, 'microscope',       2,
   'Media hora a solas revisando tu proyecto conmigo, antes de la entrega.'],
  ['aplazo-24',            '24 horas más para una entrega',           'plazo',      'Alta',      210, 'calendar-clock',   2,
   'Un día extra de plazo. Se pide antes de la fecha, no después.'],
  ['pasapalabra',          'Pasapalabra: omitir una pregunta',        'evaluacion', 'Alta',      220, 'skip-forward',     2,
   'Saltas una pregunta de la defensa sin que cuente como error.'],
  ['reentregar',           'Volver a entregar tras conocer la nota',  'plazo',      'Alta',      250, 'rotate-ccw',       1,
   'Corriges y vuelves a entregar dentro de las 24 horas siguientes a la nota.'],
  ['decimas-05',           '0,5 puntos en una evaluación',            'nota',       'Media',     300, 'chart-line',       3,
   'Se suman a la nota de la evaluación que elijas. Uno por parcial.'],
  ['ruleta-nota',          'No dar la prueba y tirar la ruleta',      'nota',       'Muy alta',  400, 'dice-5',           1,
   'Cambias tu evaluación por un sorteo: 50% un 1, 40% un 4, 9% un 5, 0,8% un 6 y 0,2% un 7.'],
  ['desbloquear-defensa',  'Desbloquear las preguntas de la defensa', 'evaluacion', 'Muy alta',  550, 'key-round',        1,
   'Ves las preguntas de tu defensa antes del día. Una sola vez en el semestre.'],
  ['punto-completo',       '1 punto en una evaluación',               'nota',       'Alta',      600, 'award',            3,
   'Un punto entero sobre la nota de la evaluación que elijas. Uno por parcial.'],
];

/** Los que tocan nota o plazo pasan por el visto bueno del docente. */
const SIN_APROBACION = new Set(['gacha-iconos', 'gacha-titulos']);

const ambitos = await sql`
  select a.id as asignatura_id, p.id as periodo_id, a.sigla
    from public.asignaturas a, public.periodos p
   where p.codigo = '2026-2' and a.activa`;

for (const am of ambitos) {
  // La tienda anterior eran 32 artículos de relleno con emojis. Nadie ha canjeado
  // nada, así que se reemplaza entera en vez de dejar dos catálogos conviviendo.
  await sql`delete from public.articulos
             where asignatura_id = ${am.asignatura_id} and periodo_id = ${am.periodo_id}
               and codigo <> all(${PREMIOS.map((p) => p[0])})`;

  let orden = 0;
  for (const [codigo, nombre, categoria, esfuerzo, precio, icono, limite, descripcion] of PREMIOS) {
    orden++;
    await sql`
      insert into public.articulos (asignatura_id, periodo_id, codigo, nombre, descripcion,
                                    detalle, categoria, icono, precio, requiere_aprobacion,
                                    limite_por_alumno, activo, orden)
      values (${am.asignatura_id}, ${am.periodo_id}, ${codigo}, ${nombre}, ${descripcion},
              ${'Esfuerzo ' + esfuerzo}, ${categoria}, ${icono}, ${precio},
              ${!SIN_APROBACION.has(codigo)}, ${limite}, true, ${orden})
      on conflict (asignatura_id, periodo_id, codigo) do update
        set nombre = excluded.nombre, descripcion = excluded.descripcion,
            detalle = excluded.detalle, categoria = excluded.categoria,
            icono = excluded.icono, precio = excluded.precio,
            requiere_aprobacion = excluded.requiere_aprobacion,
            limite_por_alumno = excluded.limite_por_alumno, orden = excluded.orden,
            activo = true`;
  }
  console.log(`${am.sigla}: ${PREMIOS.length} premios`);
}
