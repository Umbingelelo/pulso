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
  respuesta_correcta: 'Que ejecutarla varias veces deja el sistema en el mismo estado',
  incorrectas: [
    'Que solo se puede ejecutar una vez por sesión de usuario',
    'Que el servidor responde siempre el mismo código de estado',
    'Que la respuesta se guarda en caché durante un tiempo fijo',
  ],
  explicacion: 'Idempotente no significa que se ejecute una vez, sino que repetirla no cambia el resultado final.',
};

console.log('Quiz · lo que debe pasar');
caso('un quiz bien armado', BUENO, true, { termino: 'idempotente' });

console.log('\nQuiz · lo que debe rechazar');

caso('solo dos incorrectas en vez de tres',
  { ...BUENO, incorrectas: BUENO.incorrectas.slice(0, 2) }, false);

caso('dos alternativas iguales',
  { ...BUENO, incorrectas: [BUENO.incorrectas[0], BUENO.incorrectas[0], BUENO.incorrectas[2]] }, false);

caso('la misma alternativa con otra puntuación',
  { ...BUENO, respuesta_correcta: 'Que se ejecuta una vez.', incorrectas: ['que SE EJECUTA una vez', BUENO.incorrectas[1], BUENO.incorrectas[2]] }, false);

caso('una alternativa vacía',
  { ...BUENO, incorrectas: ['', BUENO.incorrectas[1], BUENO.incorrectas[2]] }, false);

caso('la pregunta no pregunta nada',
  { ...BUENO, pregunta: 'Idempotencia en HTTP y sus implicaciones prácticas' }, false);

caso('«todas las anteriores»',
  { ...BUENO, incorrectas: [BUENO.incorrectas[0], BUENO.incorrectas[1], 'Todas las anteriores'] }, false);

caso('sin explicación',
  { ...BUENO, explicacion: '' }, false);

// El delator clásico: el modelo desarrolla la correcta y despacha el resto.
caso('la correcta mucho más larga que las otras', {
  pregunta: '¿Qué es un exchange en RabbitMQ?',
  respuesta_correcta: 'Un componente que recibe los mensajes que publica el productor y decide a qué colas enrutarlos según las reglas de binding configuradas',
  incorrectas: ['Una cola', 'Un cliente', 'Un puerto'],
  explicacion: 'El exchange enruta; la cola almacena.',
}, false);

// Salió de verdad en el primer quiz de Base64: el modelo enumera y la pantalla
// le agrega su propia letra, así que el alumno lee «a) a) Es un método…».
caso('alternativas con su propia letra',
  { ...BUENO, respuesta_correcta: 'a) Una cosa', incorrectas: ['b) Otra cosa', 'c) Tercera', 'd) Cuarta'] }, false);

caso('alternativas con viñeta',
  { ...BUENO, respuesta_correcta: '- Una cosa', incorrectas: ['- Otra cosa', '- Tercera', '- Cuarta'] }, false);

caso('un paréntesis legítimo al principio no se confunde con enumeración',
  { ...BUENO, incorrectas: ['(RFC 7231) Define los métodos seguros del protocolo',
    BUENO.incorrectas[1], BUENO.incorrectas[2]] }, true, { termino: 'idempotente' });

caso('la correcta es literalmente el término',
  { ...BUENO, respuesta_correcta: 'idempotente' }, false, { termino: 'idempotente' });

caso('sin la respuesta correcta',
  { ...BUENO, respuesta_correcta: '' }, false);

caso('no es un objeto', 'una respuesta en texto plano', false);
caso('objeto vacío', {}, false);

console.log('\nQuiz · el esquema que se le exige al modelo');
const req = quiz.esquema.required;
const okEsq = req.includes('pregunta') && req.includes('respuesta_correcta')
           && req.includes('incorrectas') && req.includes('explicacion')
           && !req.includes('correcta')          // el índice ya no se le pide
           && quiz.esquema.properties.incorrectas.minItems === 3
           && quiz.esquema.additionalProperties === false;
if (!okEsq) fallos++;
console.log(`  ${okEsq ? '✓' : '✗'} pide tres incorrectas y NO pide el índice`);

console.log('\nQuiz · el armado');
const { enunciado, solucion } = quiz.armar(BUENO, { termino: 'idempotente', fuente: 'D1' });
const filtra = !('correcta' in enunciado) && !('explicacion' in enunciado);
if (!filtra) fallos++;
console.log(`  ${filtra ? '✓' : '✗'} el enunciado no lleva la respuesta ni la explicación`);
const apunta = enunciado.opciones[Number(solucion.correcta)] === BUENO.respuesta_correcta;
if (!apunta) fallos++;
console.log(`  ${apunta ? '✓' : '✗'} el índice de la solución apunta a la correcta de verdad`);

// Barajar acá es lo que reparte la posición de la correcta. En el diagnóstico de
// DSY el 72% había caído en la B y contestar todo B sacaba más de un 70%.
const cuenta = [0, 0, 0, 0];
for (let i = 0; i < 4000; i++) {
  const { enunciado: e, solucion: s } = quiz.armar(BUENO, {});
  if (e.opciones[Number(s.correcta)] !== BUENO.respuesta_correcta) { cuenta[0] = -1; break; }
  cuenta[Number(s.correcta)]++;
}
const pareja = cuenta.every((c) => c > 850 && c < 1150);
if (!pareja) fallos++;
console.log(`  ${pareja ? '✓' : '✗'} en 4.000 armados la correcta cae pareja: ${cuenta.join(' / ')}`);

console.log(fallos === 0
  ? '\nTodo bien: el validador caza lo que tiene que cazar.'
  : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
