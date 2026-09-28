/**
 * El correo diario al docente: lo que está esperando que haga algo.
 *
 * Lo dispara el cron de Vercel (`vercel.json`) contra `/api/docente?avisos=1` una
 * vez al día. Lee `avisos_docentes()` —canjes por aprobar, puntos para
 * evaluaciones por aplicar, reuniones que quedaron encendidas— y, si hay algo,
 * manda un correo por Resend. Si no hay nada, no manda nada: un correo diario que
 * dice «todo bien» se aprende a borrar sin abrir, y el día que importa también se
 * borra.
 *
 * ── Por qué Resend y por `fetch` ──
 *
 * Es una llamada HTTP con una llave, sin dependencia ni SMTP. Sin dominio propio
 * verificado, Resend solo entrega desde `onboarding@resend.dev` y **solo al correo
 * de la cuenta de Resend**: por eso existe `AVISOS_PARA`, que manda todo a esa
 * dirección en vez de al correo institucional guardado en la base.
 *
 * ── Una vez al día, aunque el cron corra dos ──
 *
 * `avisos_enviados` tiene una fila por docente y día. Vercel no garantiza que un
 * cron corra una sola vez; con esto, una segunda corrida el mismo día no vuelve a
 * mandar. `?forzar=1` se la salta, para probar la configuración.
 *
 * ── Con el rol del servidor, no con el de la app ──
 *
 * `avisos_docentes()` devuelve nombres y correos de todos los cursos, así que su
 * `execute` es solo de `pulso_misiones`, el rol que la Data API no puede adoptar.
 * La razón —la guarda por token falla abierta— está en la migración 0039.
 */
import { neon } from '@neondatabase/serverless';

let _servidor = null;
function servidor() {
  if (!_servidor) {
    if (!process.env.DATABASE_URL_MISIONES) throw new Error('Falta DATABASE_URL_MISIONES');
    _servidor = neon(process.env.DATABASE_URL_MISIONES);
  }
  return _servidor;
}
const URL_PULSO = process.env.PULSO_URL ?? 'https://pulso-rust.vercel.app';
const REMITENTE = process.env.AVISOS_REMITENTE ?? 'Pulso <onboarding@resend.dev>';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** «hace 3 días», «hace 5 horas»: lo que importa es cuánto lleva esperando. */
function hace(iso) {
  const horas = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (horas < 1) return 'hace menos de una hora';
  if (horas < 48) return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  return `hace ${Math.floor(horas / 24)} días`;
}

/** Cuántas cosas esperan. Es lo que decide si hay correo y lo que va en el asunto. */
export function contar(avisos) {
  return (avisos.canjes?.length ?? 0) + (avisos.decimas?.length ?? 0)
    + (avisos.reuniones?.length ?? 0);
}

/** El correo, en HTML y en texto. Una sección por tipo, y solo las que tienen algo. */
export function redactar(nombre, avisos) {
  const secciones = [];
  if (avisos.canjes?.length) {
    secciones.push({
      titulo: `Canjes por resolver (${avisos.canjes.length})`,
      filas: avisos.canjes.map((c) =>
        `${c.sigla} ${c.seccion} · ${c.alumno}: «${c.articulo}»` +
        (c.nota ? ` — «${c.nota}»` : '') + ` · ${hace(c.desde)}`),
    });
  }
  if (avisos.decimas?.length) {
    secciones.push({
      titulo: `Puntos para evaluaciones por aplicar (${avisos.decimas.length})`,
      filas: avisos.decimas.map((u) =>
        `${u.sigla} ${u.seccion} · ${u.alumno}: ${u.decimas} ${u.decimas === 1 ? 'décima' : 'décimas'}` +
        ` en «${u.evaluacion}» · ${hace(u.desde)}`),
    });
  }
  if (avisos.reuniones?.length) {
    secciones.push({
      titulo: 'Modo reunión encendido',
      filas: avisos.reuniones.map((r) =>
        `${r.sigla} ${r.seccion}: ${r.descuento}% de descuento en la tienda desde ${hace(r.desde)}.` +
        ' Si ya terminó, apágalo en el panel.'),
    });
  }

  const n = contar(avisos);
  const asunto = `Pulso · ${n} ${n === 1 ? 'cosa espera' : 'cosas esperan'} tu visto bueno`;
  const enlace = `${URL_PULSO}/curso`;

  const texto = [
    `Hola, ${nombre}.`, '',
    ...secciones.flatMap((s) => [s.titulo, ...s.filas.map((f) => `  - ${f}`), '']),
    `Se resuelven en ${enlace}`,
  ].join('\n');

  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1b1f24;max-width:640px">
<p>Hola, ${esc(nombre)}.</p>
${secciones.map((s) => `<h3 style="font-size:15px;margin:22px 0 6px">${esc(s.titulo)}</h3>
<ul style="margin:0;padding-left:20px">${s.filas.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`).join('\n')}
<p style="margin-top:26px"><a href="${esc(enlace)}">Abrir el panel del curso</a></p>
<p style="color:#6b7280;font-size:13px">Este correo llega una vez al día y solo si hay algo pendiente.</p>
</div>`;

  return { asunto, texto, html };
}

async function enviar({ para, asunto, texto, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: REMITENTE, to: [para], subject: asunto, text: texto, html }),
  });
  if (!r.ok) throw new Error(`Resend respondió ${r.status}: ${await r.text()}`);
}

/**
 * Recorre los docentes y manda a cada uno lo suyo.
 *
 * @param {{ forzar?: boolean, seco?: boolean }} opciones
 *   `forzar` manda aunque ya se haya mandado hoy; `seco` arma los correos y no los manda.
 * @returns {Promise<Array>} qué pasó con cada docente, para la respuesta del cron.
 */
export async function mandarAvisos({ forzar = false, seco = false } = {}) {
  if (!seco && !process.env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY');
  const s = servidor();
  const filas = await s`select * from public.avisos_docentes()`;
  const informe = [];
  for (const f of filas) {
    const n = contar(f.avisos);
    if (n === 0) { informe.push({ docente: f.nombre, pendientes: 0, enviado: false }); continue; }
    if (f.ya_enviado && !forzar) {
      informe.push({ docente: f.nombre, pendientes: n, enviado: false, motivo: 'ya se envió hoy' });
      continue;
    }
    const correo = redactar(f.nombre, f.avisos);
    const para = process.env.AVISOS_PARA || f.correo;
    if (!seco) {
      await enviar({ para, ...correo });
      await s`select public.aviso_enviado(${f.docente_id}::uuid, ${n}::integer)`;
    }
    informe.push({ docente: f.nombre, pendientes: n, enviado: !seco, para, asunto: correo.asunto,
      ...(seco ? { texto: correo.texto } : {}) });
  }
  return informe;
}
