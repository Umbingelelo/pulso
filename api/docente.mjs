/**
 * Las operaciones que necesitan conexión directa a Postgres.
 *
 *   POST /api/docente  { accion, … }
 *
 * ── Por qué el modo reunión vive acá y no en su propio archivo ──
 *
 * Tuvo su `api/reunion.mjs` un rato, hasta que el despliegue empezó a fallar sin
 * decir nada: el build compilaba y moría en «Deploying outputs…». El plan Hobby
 * admite **doce funciones serverless** y ese archivo era la trece. No hay error
 * legible, así que queda escrito acá: **antes de agregar un archivo a `api/`,
 * cuenta los que hay.**
 *
 * Por eso este endpoint dejó de ser solo del docente, y por eso `ACCIONES` declara
 * ahora quién puede llamar a cada cosa. `reunion-ver` la llama el **alumno** —para
 * su barra y su tienda— y es la única que no exige ser docente.
 *
 * ── Por qué no van por la Data API como todo lo demás ──
 *
 * PostgREST cachea el esquema y no ve una función nueva hasta que recarga. Ese
 * refresco es de Neon y no se puede forzar: `notify pgrst, 'reload schema'` no lo
 * gatilla. Medido acá, una función tardó 20 segundos en aparecer y otras tres
 * seguían invisibles quince minutos después; dos funciones triviales creadas para
 * probarlo tampoco aparecieron en cinco minutos.
 *
 * Para una pantalla de alumno eso es un mal rato al desplegar. Para el panel de
 * administración es inaceptable: el docente cambia algo, no funciona, y no hay
 * nada que pueda hacer salvo esperar sin saber cuánto.
 *
 * Acá la conexión es directa, así que una función existe apenas se crea.
 *
 * ── Lo que NO cambia ──
 *
 * La seguridad. Cada llamada pasa por `comoUsuario`, que pone la identidad del
 * docente y adopta el rol `pulso_app`: el RLS y las comprobaciones de
 * `docente_ve_seccion` dentro de cada función se aplican igual que antes. Esto
 * cambia el transporte, no quién puede hacer qué.
 */
import { cuerpo, json, mensajeDeError } from '../lib/db.mjs';
import { comoUsuario } from '../lib/identidad.mjs';
import { parsearCookies, leerRefresco } from '../lib/sesion.mjs';

/**
 * Cada acción declara qué consulta hace. El despacho es una tabla y no un
 * `switch` con SQL suelto: así se ve de una qué puede pedir el panel, y agregar
 * una operación es agregar una línea y su función en la base.
 */
const ACCIONES = {
  // ---------- Modo reunión ----------

  /**
   * La única que puede llamar un alumno: si su docente está en reunión y con
   * cuánto descuento queda su tienda. `mi_reunion` exige adentro que la matrícula
   * sea suya, así que acá no hay nada que comprobar.
   */
  'reunion-ver': (s, d) =>
    s`select public.mi_reunion(${d.matricula}::uuid) as r`,

  'reunion-secciones': (s, d) =>
    s`select * from public.reuniones_que_dicto(${d.asignatura}::uuid, ${d.periodo}::uuid)`,

  'reunion-iniciar': (s, d) =>
    s`select public.reunion_iniciar(
        ${d.seccion}::uuid, ${d.descuento == null ? 30 : Number(d.descuento)}::integer) as r`,

  'reunion-terminar': (s, d) =>
    s`select public.reunion_terminar(${d.seccion}::uuid) as r`,

  // ---------- Panel del docente ----------

  secciones: (s, d) =>
    s`select * from public.secciones_que_dicto(${d.asignatura}::uuid, ${d.periodo}::uuid)`,

  alumnos: (s, d) =>
    s`select * from public.docente_alumnos(${d.asignatura}::uuid, ${d.periodo}::uuid)`,

  actividades: (s, d) =>
    s`select * from public.actividades_que_dicto(${d.asignatura}::uuid, ${d.periodo}::uuid)`,

  'cambiar-seccion': (s, d) =>
    s`select public.alumno_cambiar_seccion(${d.matricula}::uuid, ${d.seccion}::uuid) as r`,

  activar: (s, d) =>
    s`select public.alumno_activar(${d.matricula}::uuid, ${d.activa === true}) as r`,

  clave: (s, d) =>
    s`select public.alumno_reiniciar_clave(${d.matricula}::uuid, ${d.clave}) as r`,

  'guardar-actividad': (s, d) =>
    s`select public.actividad_guardar(
        ${d.id ?? null}::uuid, ${d.asignatura}::uuid, ${d.periodo}::uuid,
        ${d.codigo}, ${d.titulo}, ${d.descripcion ?? null}, ${d.tipo},
        ${Number(d.puntos) || 0}::integer, ${Number(d.orden) || 0}::integer,
        ${d.activa !== false}) as r`,
};

/**
 * Las que puede llamar cualquiera con sesión. Todo lo demás exige ser docente.
 *
 * Es una lista de lo permitido y no de lo prohibido a propósito: agregar una
 * acción nueva la deja protegida por omisión, que es el lado correcto en el que
 * equivocarse.
 */
const ABIERTAS = new Set(['reunion-ver']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });

  const usuarioId = await leerRefresco(parsearCookies(req));
  if (!usuarioId) return json(res, 401, { error: 'Sin sesión' });

  const datos = await cuerpo(req);
  const consulta = ACCIONES[datos.accion];
  if (!consulta) return json(res, 400, { error: 'Acción desconocida' });

  try {
    // Que sea docente lo comprueba cada función de la base contra las secciones
    // que declaró dictar. Acá solo se rechaza de entrada a quien no lo es, para
    // no gastar una consulta en algo que va a fallar igual.
    if (!ABIERTAS.has(datos.accion)) {
      const [quien] = await comoUsuario(usuarioId, (s) =>
        s`select public.es_docente() as si`);
      if (!quien?.si) return json(res, 403, { error: 'Esto es solo para docentes' });
    }

    const filas = await comoUsuario(usuarioId, (s) => consulta(s, datos));
    return json(res, 200, { filas });
  } catch (e) {
    return json(res, 400, { error: mensajeDeError(e) });
  }
}
