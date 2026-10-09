/**
 * La llamada al modelo, en un solo lugar.
 *
 * Vive en el servidor y nada más: la key es un secreto y el repositorio es
 * público, así que esto no se importa nunca desde `src/`. La app pide su misión
 * a `/api/mision`, y es esa función la que habla con OpenRouter.
 *
 * Se pide **salida estructurada** con `strict: true`, que obliga al modelo a
 * responder con un JSON que calce con el esquema. Ojo con lo que eso significa y
 * lo que no: garantiza la **forma**, no que el contenido sirva. Un quiz con dos
 * respuestas correctas cumple el esquema perfectamente. Por eso después de esto
 * viene siempre un validador de la mecánica, que es quien tiene la última palabra.
 */

const URL_OR = 'https://openrouter.ai/api/v1/chat/completions';

/** Barato, rápido y con contexto de sobra para lo que hacemos. */
export const MODELO_POR_OMISION = 'deepseek/deepseek-v4-flash';

export class ErrorModelo extends Error {
  constructor(mensaje, detalle) {
    super(mensaje);
    this.name = 'ErrorModelo';
    this.detalle = detalle;
  }
}

/**
 * Pide una respuesta que calce con `esquema` y la devuelve ya parseada.
 *
 * @returns {Promise<{ datos: object, uso: object, modelo: string }>}
 */
export async function completar({
  instruccion,
  esquema,
  nombreEsquema = 'respuesta',
  modelo = MODELO_POR_OMISION,
  temperatura = 0.8,
  segundos = 45,
  maxTokens,
  sinRazonamiento = false,
}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new ErrorModelo('Falta OPENROUTER_API_KEY');

  // Sin esto, una llamada colgada se lleva por delante el tiempo de la función.
  const corte = AbortSignal.timeout(segundos * 1000);

  let r;
  try {
    r = await fetch(URL_OR, {
      method: 'POST',
      signal: corte,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        // OpenRouter los usa para atribuir el uso; ayudan a saber qué gastó qué.
        'HTTP-Referer': 'https://pulso-rust.vercel.app',
        'X-Title': 'Pulso',
      },
      body: JSON.stringify({
        model: modelo,
        temperature: temperatura,
        // Tope de salida por mecánica: sin él, un modelo que se enreda escribe
        // hasta agotar su contexto y se paga cada token. Cada mecánica sabe
        // cuánto pesa su respuesta y deja holgura sobre eso.
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        // El modelo piensa o no según el proveedor al que OpenRouter lo enrute.
        // En algunos (AtlasCloud, OpenInference) piensa **por omisión**, y esos
        // tokens se cobran como salida y cuentan contra `max_tokens`: medido sobre
        // el mismo prompt, con tope de 500 la mitad de las respuestas llegaban con
        // el contenido vacío (`finish_reason: length`, 500 tokens de razonamiento) y
        // sin tope el pensamiento pasaba de 1.500 tokens para escribir 150. Las
        // misiones no necesitan razonar: redactan con una definición delante.
        ...(sinRazonamiento ? { reasoning: { enabled: false } } : {}),
        messages: [{ role: 'user', content: instruccion }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: nombreEsquema, strict: true, schema: esquema },
        },
      }),
    });
  } catch (e) {
    throw new ErrorModelo(
      e.name === 'TimeoutError' ? `El modelo no respondió en ${segundos}s` : 'No se pudo llamar al modelo',
      e.message);
  }

  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '');
    throw new ErrorModelo(`OpenRouter respondió ${r.status}`, cuerpo.slice(0, 300));
  }

  const j = await r.json().catch(() => null);
  if (j?.error) throw new ErrorModelo('OpenRouter devolvió un error', JSON.stringify(j.error).slice(0, 300));

  const texto = j?.choices?.[0]?.message?.content;
  if (typeof texto !== 'string' || !texto.trim()) {
    throw new ErrorModelo('El modelo respondió vacío', JSON.stringify(j ?? {}).slice(0, 300));
  }

  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    // Con strict:true no debería pasar, pero si el proveedor de turno no lo
    // respeta, es mejor enterarse con un mensaje claro que con un stack trace.
    throw new ErrorModelo('El modelo no devolvió JSON válido', texto.slice(0, 300));
  }

  return { datos, uso: j.usage ?? {}, modelo: j.model ?? modelo };
}

/**
 * Lo que costó una llamada, en dólares, para poder mirarlo sin adivinar.
 *
 * OpenRouter informa el costo real en `usage.cost`; es el que se usa si viene.
 * Las constantes de abajo son el respaldo, y se quedaron cortas: en una
 * generación medida daban 0,000045 contra 0,000069 que cobró de verdad.
 */
export function costo(uso, precios = { entrada: 0.064e-6, salida: 0.129e-6 }) {
  if (typeof uso?.cost === 'number') return uso.cost;
  const e = uso?.prompt_tokens ?? 0;
  const s = uso?.completion_tokens ?? 0;
  return e * precios.entrada + s * precios.salida;
}
