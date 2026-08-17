/**
 * La sugerencia del modelo sobre una respuesta del alumno.
 *
 * Vive aparte de `api/laboratorio.mjs` por lo mismo que el compilador de
 * Markdown vive aparte del publicador: acá está el criterio, y el criterio se
 * prueba con respuestas de mentira, sin HTTP y sin base de datos.
 * `neon/probar-revision.mjs` hace exactamente eso.
 *
 * ── Qué se le manda, y por qué tanto ──
 *
 * **El laboratorio completo**, no el enunciado de la caja sola. No es derroche:
 * la caja 1.5 de L1 pregunta por qué apareció una línea en la terminal donde
 * corre `libros.mjs`, y para juzgar esa respuesta hay que haber visto el bloque
 * de código de ese microservicio y el `fetch` al 3001 que están unos párrafos
 * antes. Con el enunciado suelto, el modelo no tiene con qué.
 *
 * El enunciado entero de L1 son unos 11.400 tokens, así que revisar sus 21 cajas
 * para 30 alumnos cuesta del orden de medio dólar. No hay nada que optimizar.
 *
 * También van **las otras respuestas del propio alumno**, por un caso concreto:
 * la caja 3.1 dice «responde de nuevo la pregunta del principio, y si cambiaste
 * de opinión dilo». Sin ver lo que puso en la 0.1, eso no se puede validar.
 *
 * ── Nada de reglas deterministas ──
 *
 * Acá no hay un `if` que compruebe que la respuesta «empiece con HTTP/1.1». El
 * juicio **es** el criterio, y una regla lo empobrece: con el laboratorio entero
 * en contexto el modelo puede hacer algo que ninguna regla puede, que es ver si
 * lo que el alumno pegó corresponde a **ese** paso y no a otro.
 *
 * Lo único determinista es el esquema de salida, que es forma y no contenido.
 *
 * A cambio, el modelo se va a equivocar de vez en cuando. Por eso el veredicto es
 * una **sugerencia** que no toca los puntos: es lo que hace que equivocarse salga
 * barato.
 */
import { completar, costo } from './openrouter.mjs';

/** Los tres veredictos. Ninguno dice «incorrecto», a propósito. */
export const VEREDICTOS = ['logrado', 'parcial', 'incompleto'];

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['veredicto', 'mensaje'],
  properties: {
    veredicto: { type: 'string', enum: VEREDICTOS },
    mensaje: {
      type: 'string',
      description: 'Dos o tres frases, en español de Chile, tuteando al alumno. ' +
        'Nunca la respuesta: qué mirar o qué revisar.',
    },
  },
};

/**
 * El enunciado compilado, de vuelta a texto para el modelo.
 *
 * Los bloques se guardan en HTML porque el navegador los dibuja, pero al modelo
 * el HTML solo le gasta tokens. Los `<pre>` se conservan como bloques de código
 * cercados: en un laboratorio de este tipo, el código **es** buena parte del
 * enunciado y sin él no se puede juzgar nada.
 */
function aTexto(html) {
  return (html ?? '')
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, (_, c) => `\n\`\`\`\n${c}\n\`\`\`\n`)
    .replace(/<\/(p|li|tr|h[1-6]|div)>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Arma el laboratorio como texto, con la caja que se revisa marcada en su lugar.
 *
 * La marca va **en su posición** y no al final: parte del contexto es qué venía
 * antes y qué viene después. Las demás cajas aparecen con su enunciado y con lo
 * que el alumno respondió, si respondió.
 */
export function armarContexto(lab, cajaId) {
  const partes = [];
  for (const b of lab.bloques ?? []) {
    if (b.tipo === 'caja') {
      const suya = (lab.respuestas ?? {})[b.id];
      if (b.id === cajaId) {
        partes.push(
          `\n════ CAJA ${b.id} · ESTA ES LA QUE TIENES QUE REVISAR ════\n` +
          `Lo que se le pide (formato ${b.formato}):\n${aTexto(b.enunciado)}\n` +
          `════ fin de la caja a revisar ════\n`);
      } else {
        partes.push(
          `[caja ${b.id}] ${aTexto(b.enunciado)}` +
          (suya?.trim() ? `\n   → respondió: ${suya.trim().slice(0, 600)}` : '\n   → sin responder'));
      }
      continue;
    }
    if (b.tipo === 'control') { partes.push(`[punto de control ${b.numero}] ${aTexto(b.html)}`); continue; }
    if (b.tipo === 'aviso')   { partes.push(`[${b.clase}] ${aTexto(b.html)}`); continue; }
    partes.push(aTexto(b.html));
  }
  return partes.filter(Boolean).join('\n\n');
}

/** La instrucción. Separada para poder leerla —y probarla— sin llamar a nadie. */
export function armarInstruccion(lab, cajaId, respuesta) {
  const caja = (lab.bloques ?? []).find((b) => b.tipo === 'caja' && b.id === cajaId);
  if (!caja) throw new Error(`La caja «${cajaId}» no está en el enunciado`);

  const comoJuzgar = caja.formato === 'codigo'
    // Las cajas `codigo` piden pegar una salida. El modelo no puede saber qué
    // salió en el computador del alumno, pero **sí** puede saber si lo que pegó
    // corresponde a ese paso del laboratorio: si es la salida de otro comando, o
    // de otro momento, se nota.
    ? 'Esta caja le pide **pegar una salida** de su computador. No puedes saber ' +
      'exactamente qué le salió, así que no exijas valores idénticos a los del ' +
      'ejemplo. Lo que sí puedes juzgar: si lo que pegó es plausiblemente la ' +
      'salida de **ese** paso del laboratorio y no de otro, si está completa, y si ' +
      'contesta además la pregunta que la caja hace sobre ella.'
    : 'Esta caja le pide **explicar con sus palabras**. Juzga la idea, no las ' +
      'palabras: si entendió el concepto, dalo por logrado aunque lo diga distinto ' +
      'a como lo diría un libro. No exijas vocabulario técnico que el enunciado no ' +
      'usa.';

  return `Eres el ayudante de un laboratorio de un ramo de arquitectura de software
en un instituto profesional chileno. Un alumno respondió una caja y quiere saber si
lo que hizo está bien.

Abajo va **el laboratorio completo**, en orden, con la caja que tienes que revisar
marcada entre líneas dobles. Las otras cajas traen lo que el alumno respondió en
ellas, para que tengas el contexto de su trabajo.

${comoJuzgar}

CÓMO ELEGIR EL VEREDICTO
- «logrado»: capta la idea. Puede estar dicho con torpeza o incompleto en la forma.
- «parcial»: va bien encaminado pero le falta una parte importante, o mezcla algo.
- «incompleto»: está en blanco, no responde lo que se pregunta, o dice algo que
  contradice lo que el laboratorio acaba de mostrarle.

LA REGLA DEL MENSAJE, QUE ES LA MÁS IMPORTANTE DE TODAS
**No puedes escribir la respuesta, ni una parte de ella, ni parafraseada.**

Si el alumno no sabe, tiene que ir a mirar el laboratorio otra vez. Si tú le
explicas el concepto, no aprendió nada y además puede escribir de vuelta lo que
acabas de decirle. Eso rompe la función entera.

Concretamente, en el mensaje **solo** tienes permitido:
  a) nombrar dónde volver a mirar: el número del paso, una caja anterior, un
     bloque de código, un comando que vuelva a correr, una columna de Wireshark;
  b) señalar que algo se contradice con lo que vio, **sin decir cuál es lo correcto**;
  c) hacerle una pregunta que lo obligue a mirar.

Y te está **prohibido** afirmar un hecho técnico sobre el tema de la caja, aunque
sea para corregirlo. No completes, no aclares, no resumas la teoría.

Ejemplo con una caja que pregunta por qué un JWT no está protegido por base64:
  PROHIBIDO: «Base64 no es cifrado, solo codifica; la firma da integridad, no secreto.»
             (le entregaste la respuesta completa)
  PROHIBIDO: «Estás confundiendo base64 con cifrado, base64 no encripta nada.»
             (lo corregiste afirmando el hecho: sigue siendo la respuesta)
  PERMITIDO: «Eso no calza con lo que hiciste en el paso 2.3. Vuelve a mirar el
             comando con que decodificaste el token: ¿qué te pidió para poder
             leerlo? Y lee el comentario de las primeras líneas de token.mjs.»

CÓMO ESCRIBIR EL MENSAJE
- Dos o tres frases, máximo cuatro. Directo, sin rodeos y sin relleno.
- Español de Chile **de tú**: «mira», «revisa», «vuelve», «fíjate», «lee», «tienes».
  Nunca vos ni voseo: no escribas «mirá», «revisá», «volvé», «leé», «tenís»,
  «podés», «querés», «fijate».
- Respetuoso y sobrio. **Nunca garabatos ni apelativos**: ni «weón», ni «causa»,
  ni «cabro». Es un ayudante de un ramo, no un compañero de curso.
- Si escribió algo, no le digas que está en blanco. Lee lo que puso.
- Si está logrado, dile en una frase qué fue lo que entendió bien y para ahí. No lo
  felicites de más y no uses signos de exclamación.
- No menciones que eres un modelo, ni hables de «veredictos», ni le digas que esto
  no afecta su nota: eso ya lo dice la pantalla.

═══════════════ EL LABORATORIO ═══════════════
${lab.titulo ?? ''}

${armarContexto(lab, cajaId)}
═══════════════ FIN DEL LABORATORIO ═══════════════

LO QUE EL ALUMNO ESCRIBIÓ EN LA CAJA ${cajaId}:
${(respuesta ?? '').trim() || '(en blanco)'}`;
}

/**
 * Revisa una respuesta y devuelve la sugerencia.
 *
 * Revienta si el modelo falla, y eso es correcto: quien llama —`/api/laboratorio`—
 * traduce el fallo en un aviso gris en esa caja y **nada más**. Ni la escritura ni
 * la entrega se enteran.
 */
export async function revisar({ lab, cajaId, respuesta, modelo }) {
  const instruccion = armarInstruccion(lab, cajaId, respuesta);
  const opciones = {
    instruccion,
    esquema: ESQUEMA,
    nombreEsquema: 'revision',
    // Baja a propósito: acá no se quiere creatividad, se quiere el mismo criterio
    // para dos alumnos que escribieron lo mismo.
    temperatura: 0.2,
    segundos: 40,
    ...(modelo ? { modelo } : {}),
  };

  // Un reintento, y uno solo.
  //
  // `strict: true` debería garantizar JSON, pero midiendo esto salió un
  // «no devolvió JSON válido» en una de siete llamadas, y las cuatro siguientes
  // con el mismo texto salieron bien: es un hipo del proveedor, no del prompt.
  // Reintentar una vez lo tapa. Insistir más sería esconder una falla de verdad
  // y hacer esperar al alumno frente a una caja que no responde.
  let r;
  try {
    r = await completar(opciones);
  } catch (primera) {
    try {
      r = await completar(opciones);
    } catch {
      throw primera;
    }
  }
  const { datos, uso, modelo: usado } = r;

  return {
    veredicto: datos.veredicto,
    mensaje: (datos.mensaje ?? '').trim(),
    modelo: usado,
    costo: costo(uso),
    tokens: uso?.prompt_tokens ?? 0,
  };
}

/**
 * La llave de caché: el texto del alumno **más el enunciado de la caja**.
 *
 * Con el texto solo, un enunciado editado dejaría la sugerencia vieja pegada a una
 * pregunta que ya no es la misma.
 */
export async function huella(respuesta, enunciado) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256')
    .update(`${(respuesta ?? '').trim()} ${enunciado ?? ''}`)
    .digest('base64url')
    .slice(0, 22);
}
