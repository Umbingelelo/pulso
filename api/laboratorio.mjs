/**
 * El laboratorio del alumno: leerlo, ir guardando y entregarlo.
 *
 *   POST /api/laboratorio  { accion: 'ver' | 'guardar' | 'entregar', … }
 *
 * Va por conexión directa y no por la Data API por lo mismo que el panel del
 * docente: PostgREST cachea el esquema y una función recién creada tarda un rato
 * impredecible en aparecer —acá se midieron veinte segundos una vez y más de
 * quince minutos otra—. Un alumno que abre su laboratorio y ve un error que no
 * puede resolver ni entender es peor que un despliegue lento.
 *
 * La seguridad no cambia: cada llamada pasa por `comoUsuario`, que adopta el rol
 * `pulso_app` con la identidad del alumno, y las funciones de la base comprueban
 * que la matrícula sea suya.
 */
import { cuerpo, json, mensajeDeError } from '../lib/db.mjs';
import { comoUsuario } from '../lib/identidad.mjs';
import { parsearCookies, leerRefresco } from '../lib/sesion.mjs';
import { huella, revisar } from '../lib/revision-lab.mjs';

const ACCIONES = {
  ver: (s, d) =>
    s`select public.mi_laboratorio(${d.matricula}::uuid, ${d.codigo}) as r`,

  guardar: (s, d) =>
    s`select public.laboratorio_guardar(
        ${d.matricula}::uuid, ${d.codigo},
        ${JSON.stringify(d.respuestas ?? {})}::jsonb,
        ${Number(d.tramo) || 0}::integer) as r`,

  entregar: (s, d) =>
    s`select public.laboratorio_entregar(${d.matricula}::uuid, ${d.codigo}) as r`,

  // Qué laboratorios tiene, cuáles son opcionales y cuáles están cerrados. Lo
  // usa la pantalla de Actividades para no ofrecer «Empezar» sobre un candado.
  estado: (s, d) =>
    s`select * from public.mis_laboratorios(${d.matricula}::uuid)`,

  // Para el docente: cómo va el curso en este laboratorio.
  avances: (s, d) =>
    s`select * from public.laboratorio_avances(
        ${d.asignatura}::uuid, ${d.periodo}::uuid, ${d.codigo})`,
};

/**
 * La sugerencia del modelo sobre una caja.
 *
 * Va fuera del mapa `ACCIONES` porque aquello es SQL puro y esto son tres pasos:
 * leer el enunciado de la base, preguntarle al modelo, guardar lo que dijo.
 *
 * ── Lo que el navegador NO manda ──
 *
 * El enunciado. Lo busca el servidor con `mi_laboratorio`, que además comprueba
 * que la matrícula sea suya. Si el enunciado viniera del cliente, un alumno se
 * inventaría uno fácil y se aprobaría lo que quisiera.
 *
 * ── Lo que el navegador NO recibe ──
 *
 * La pauta: la respuesta correcta que escribió el docente. Se pide aparte, con
 * `laboratorio_pauta()`, precisamente para que no viaje pegada al enunciado — y
 * de acá **no sale nunca** hacia la respuesta HTTP: entra a la instrucción del
 * modelo y muere ahí. Lo que vuelve al navegador es el veredicto y el mensaje,
 * los mismos dos campos de antes. Ver `0030_pauta.sql`.
 *
 * ── Y no vive en su propio archivo ──
 *
 * Por el techo de doce funciones serverless del plan: ver la cabecera de
 * `api/docente.mjs`, donde el modo reunión aprendió lo mismo a la mala.
 */
async function accionRevisar(usuarioId, d) {
  // Las dos cosas en una consulta: el enunciado y la pauta de **esta** caja. La
  // pauta se pide de la caja sola y no del laboratorio entero porque la
  // instrucción revisa una, y las otras veintinueve no tienen nada que hacer en
  // la memoria de esta función. Puede venir null y está bien: hay laboratorios
  // sin pauta y el criterio funciona igual, solo con menos apoyo.
  const [fila] = await comoUsuario(usuarioId, (s) =>
    s`select public.mi_laboratorio(${d.matricula}::uuid, ${d.codigo})               as r,
             public.laboratorio_pauta(${d.matricula}::uuid, ${d.codigo}, ${d.caja}) as p`);
  const lab = fila?.r;
  if (!lab) return { estado: 404, cuerpo: { error: 'No encontré ese laboratorio en tu ramo.' } };

  const caja = (lab.bloques ?? []).find((b) => b.tipo === 'caja' && b.id === d.caja);
  if (!caja) return { estado: 400, cuerpo: { error: `La caja «${d.caja}» no existe.` } };

  const pauta = fila.p ?? null;

  // El texto que se revisa es el que manda el navegador, no el guardado: el
  // guardado automático espera dos segundos, y si esperáramos a que viaje, el
  // alumno pediría sugerencia sobre lo que escribió hace dos frases.
  const respuesta = typeof d.respuesta === 'string' ? d.respuesta : '';
  if (!respuesta.trim()) {
    return { estado: 400, cuerpo: { error: 'Escribe algo antes de pedir sugerencia.' } };
  }

  // Si no cambió nada desde la última vez, se devuelve lo mismo sin pagar de nuevo.
  const marca = await huella(respuesta, caja.enunciado, pauta);
  const previa = (lab.revisiones ?? {})[d.caja];
  if (previa?.hash === marca) {
    return { estado: 200, cuerpo: { revision: { ...previa, cacheada: true } } };
  }

  const r = await revisar({ lab, cajaId: d.caja, respuesta, pauta });

  await comoUsuario(usuarioId, (s) =>
    s`select public.laboratorio_revisar_guardar(
        ${d.matricula}::uuid, ${d.codigo}, ${d.caja},
        ${r.veredicto}, ${r.mensaje}, ${marca}) as r`);

  return {
    estado: 200,
    cuerpo: { revision: { veredicto: r.veredicto, mensaje: r.mensaje, hash: marca, cacheada: false } },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });

  const usuarioId = await leerRefresco(parsearCookies(req));
  if (!usuarioId) return json(res, 401, { error: 'Sin sesión' });

  const datos = await cuerpo(req);

  if (datos.accion === 'revisar') {
    try {
      const { estado, cuerpo: salida } = await accionRevisar(usuarioId, datos);
      return json(res, estado, salida);
    } catch (e) {
      // Que el modelo falle no es un error de la aplicación: es una sugerencia
      // que no llegó. Se devuelve 200 con el motivo para que la pantalla lo
      // muestre como aviso en esa caja y nada más se entere.
      return json(res, 200, { fallo: mensajeDeError(e) });
    }
  }

  const consulta = ACCIONES[datos.accion];
  if (!consulta) return json(res, 400, { error: 'Acción desconocida' });

  try {
    const filas = await comoUsuario(usuarioId, (s) => consulta(s, datos));
    return json(res, 200, { filas });
  } catch (e) {
    return json(res, 400, { error: mensajeDeError(e) });
  }
}
