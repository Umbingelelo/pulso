/**
 * El validador de mecánicas, probado sin gastar una sola llamada al modelo.
 *
 * Esta prueba es barata y es la que más veces se va a correr: cada mecánica
 * nueva agrega su tanda de casos malos acá. La idea es que ningún puzzle roto
 * llegue nunca a un alumno, y para eso hay que estar seguro de que el validador
 * caza lo que tiene que cazar —incluido lo que un modelo hace *bien* pero que
 * arruina el ejercicio, como desarrollar la alternativa correcta y despachar las
 * otras tres en dos palabras.
 *
 *   node neon/probar-mecanicas.mjs
 */
import * as quiz from '../lib/mecanicas/quiz.mjs';

let fallos = 0;

function caso(etiqueta, payload, esperado, contexto = {}) {
  const { ok, motivos } = quiz.validar(payload, contexto);
  const bien = ok === esperado;
  if (!bien) fallos++;
  const detalle = ok ? '' : `  (${motivos.join('; ')})`;
  console.log(`  ${bien ? '✓' : '✗'} ${etiqueta}: ${ok ? 'válido' : 'rechazado'}${detalle}`);
}

const BUENO = {
  pregunta: '¿Qué significa que una operación HTTP sea idempotente?',
  opciones: [
    'Que solo se puede ejecutar una vez por sesión de usuario',
    'Que ejecutarla varias veces deja el sistema en el mismo estado',
    'Que el servidor responde siempre el mismo código de estado',
    'Que la respuesta se guarda en caché durante un tiempo fijo',
  ],
  correcta: 1,
  explicacion: 'Idempotente no significa que se ejecute una vez, sino que repetirla no cambia el resultado final.',
};

console.log('Quiz · lo que debe pasar');
caso('un quiz bien armado', BUENO, true, { termino: 'idempotente' });

console.log('\nQuiz · lo que debe rechazar');

caso('tres alternativas en vez de cuatro',
  { ...BUENO, opciones: BUENO.opciones.slice(0, 3) }, false);

caso('dos alternativas iguales',
  { ...BUENO, opciones: [BUENO.opciones[0], BUENO.opciones[0], BUENO.opciones[2], BUENO.opciones[3]] }, false);

caso('la misma alternativa con otra puntuación',
  { ...BUENO, opciones: ['Que se ejecuta una vez.', 'que SE EJECUTA una vez', BUENO.opciones[2], BUENO.opciones[3]] }, false);

caso('una alternativa vacía',
  { ...BUENO, opciones: [BUENO.opciones[0], '', BUENO.opciones[2], BUENO.opciones[3]] }, false);

caso('índice de la correcta fuera de rango',
  { ...BUENO, correcta: 4 }, false);

caso('índice que no es entero',
  { ...BUENO, correcta: '1' }, false);

caso('la pregunta no pregunta nada',
  { ...BUENO, pregunta: 'Idempotencia en HTTP y sus implicaciones prácticas' }, false);

caso('«todas las anteriores»',
  { ...BUENO, opciones: [BUENO.opciones[0], BUENO.opciones[1], BUENO.opciones[2], 'Todas las anteriores'] }, false);

caso('sin explicación',
  { ...BUENO, explicacion: '' }, false);

// El delator clásico: el modelo desarrolla la correcta y despacha el resto.
caso('la correcta mucho más larga que las otras', {
  pregunta: '¿Qué es un exchange en RabbitMQ?',
  opciones: [
    'Una cola',
    'Un componente que recibe los mensajes que publica el productor y decide a qué colas enrutarlos según las reglas de binding configuradas',
    'Un cliente',
    'Un puerto',
  ],
  correcta: 1,
  explicacion: 'El exchange enruta; la cola almacena.',
}, false);

caso('la correcta es literalmente el término', {
  ...BUENO,
  opciones: ['idempotente', BUENO.opciones[1], BUENO.opciones[2], BUENO.opciones[3]],
  correcta: 0,
}, false, { termino: 'idempotente' });

caso('no es un objeto', 'una respuesta en texto plano', false);
caso('objeto vacío', {}, false);

console.log('\nQuiz · el esquema que se le exige al modelo');
const req = quiz.esquema.required;
const okEsq = req.includes('pregunta') && req.includes('opciones')
           && req.includes('correcta') && req.includes('explicacion')
           && quiz.esquema.properties.opciones.minItems === 4
           && quiz.esquema.properties.opciones.maxItems === 4
           && quiz.esquema.additionalProperties === false;
if (!okEsq) fallos++;
console.log(`  ${okEsq ? '✓' : '✗'} exige exactamente cuatro opciones y nada de más`);

console.log('\nQuiz · el reparto enunciado / solución');
const enun = quiz.aEnunciado(BUENO, { termino: 'idempotente', fuente: 'D1' });
const sol = quiz.aSolucion(BUENO);
const filtra = !('correcta' in enun) && !('explicacion' in enun);
if (!filtra) fallos++;
console.log(`  ${filtra ? '✓' : '✗'} el enunciado no lleva la respuesta ni la explicación`);
const tieneSol = sol.correcta === '1' && sol.explicacion.length > 10;
if (!tieneSol) fallos++;
console.log(`  ${tieneSol ? '✓' : '✗'} la solución sí las lleva, para que corrija Postgres`);

console.log(fallos === 0
  ? '\nTodo bien: el validador caza lo que tiene que cazar.'
  : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
