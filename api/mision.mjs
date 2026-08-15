/**
 * La misión del día: consultarla y generarla.
 *
 *   GET  /api/mision?matricula=…   estado del botón y la misión si ya existe
 *   POST /api/mision {matricula}   genera la de hoy, si todavía no la tiene
 *
 * El alumno aprieta un botón y espera unos segundos: la misión se genera en ese
 * momento, no por un cron. En el plan Hobby un cron corre una vez al día y
 * dispara en cualquier momento dentro de la hora, así que quien entra temprano
 * no encontraría nada; además así no se gastan generaciones en quien no entra.
 *
 * La escritura va con el rol `pulso_misiones`, cuyo único permiso en toda la base
 * es registrar una misión. La solución del puzzle la manda este servidor, y por
 * eso no puede ir con `pulso_app`: con ese rol, un alumno con su propio token
 * podría inscribirse una misión cuya respuesta él mismo eligió.
 *
 * Todo lo demás —el estado del botón, el término del día, releer la misión— va
 * con la identidad del alumno, donde el RLS ya hace el filtro que corresponde.
 */
import { neon } from '@neondatabase/serverless';
import { cuerpo, json, mensajeDeError } from '../lib/db.mjs';
import { comoUsuario } from '../lib/identidad.mjs';
import { parsearCookies, leerRefresco } from '../lib/sesion.mjs';
import { generar } from '../lib/misiones.mjs';

const PLANTILLA = 'quiz';   // la única mecánica por ahora

let _gen = null;
function generador() {
  if (!_gen) {
    if (!process.env.DATABASE_URL_MISIONES) throw new Error('Falta DATABASE_URL_MISIONES');
    _gen = neon(process.env.DATABASE_URL_MISIONES);
  }
  return _gen;
}

export default async function handler(req, res) {
  const usuarioId = await leerRefresco(parsearCookies(req));
  if (!usuarioId) return json(res, 401, { error: 'Sin sesión' });

  const url = new URL(req.url, `https://${req.headers.host}`);
  const datos = req.method === 'POST' ? await cuerpo(req) : {};
  const matricula = datos.matricula ?? url.searchParams.get('matricula');
  if (!matricula) return json(res, 400, { error: 'Falta la matrícula' });

  try {
    if (req.method === 'GET') {
      const filas = await comoUsuario(usuarioId, (s) =>
        s`select public.estado_mision(${matricula}::uuid, 'diaria') as estado,
                 public.mi_mision(${matricula}::uuid, 'diaria')    as mision`);
      return json(res, 200, filas[0] ?? {});
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });

    // ¿Ya tiene la de hoy? Se comprueba con la identidad del alumno, así que de
    // paso valida que la matrícula sea suya.
    const previo = await comoUsuario(usuarioId, (s) =>
      s`select public.estado_mision(${matricula}::uuid, 'diaria') as estado,
               public.mi_mision(${matricula}::uuid, 'diaria')    as mision`);
    if (previo[0]?.estado?.ya_tiene) {
      return json(res, 200, { ...previo[0], generada: false });
    }

    // El término se elige con la identidad del alumno, no con el rol generador.
    // No es un rodeo: la política de `mision_banco` ya dice «los términos de mis
    // ramos», así que el RLS hace el filtro solo y el rol generador se queda con
    // un único permiso —registrar la misión— en vez de poder recorrer la nómina.
    const contexto = await comoUsuario(usuarioId, (s) =>
      s`select b.termino, b.definicion, b.fuente, a.nombre as asignatura
          from public.mision_banco b
          join public.asignaturas  a on a.id = b.asignatura_id
         where b.activo
         order by random() limit 1`);
    const ctx = contexto[0];
    if (!ctx) {
      return json(res, 503, {
        error: 'Todavía no hay términos habilitados para tu ramo. Avísale al docente.',
      });
    }

    const hecha = await generar(PLANTILLA, ctx);

    const g = generador();
    await g`select public.mision_registrar(
              ${matricula}::uuid, ${PLANTILLA}, 'diaria',
              ${JSON.stringify(hecha.enunciado)}::jsonb,
              ${JSON.stringify(hecha.solucion)}::jsonb, 'modelo')`;

    // Se relee con la identidad del alumno: lo que se devuelve es exactamente lo
    // que él puede ver, sin la solución.
    const filas = await comoUsuario(usuarioId, (s) =>
      s`select public.estado_mision(${matricula}::uuid, 'diaria') as estado,
               public.mi_mision(${matricula}::uuid, 'diaria')    as mision`);
    return json(res, 200, { ...filas[0], generada: true });
  } catch (e) {
    console.error('mision', e?.message, e?.detalle ?? '');
    return json(res, 400, { error: mensajeDeError(e) });
  }
}
