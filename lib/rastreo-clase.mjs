/**
 * El script que se le agrega al deck al momento de servirlo.
 *
 * Nada de esto vive en los archivos de la asignatura: el deck se sube byte a byte
 * como está y la instrumentación se pega acá, al pasar. Así, rehacer un deck no
 * obliga a volver a instrumentarlo, y el archivo que el docente proyecta en sala
 * es exactamente el mismo que estudia el alumno.
 *
 * Se apoya en dos hechos del deck, y en nada más:
 *
 *   1. `cambiarModo('estudio')` es una función global.
 *   2. En modo estudio, el deck persiste TODO su avance en `localStorage` cada
 *      vez que cambia algo: `{ modo, slide, respuestas }`.
 *
 * El (1) hace falta porque el deck arranca en modo `clase` —pensado para
 * proyectar— y en ese modo `guardar()` sale temprano y no persiste nada. Sin
 * forzar el modo estudio no habría avance que reportar y nadie sumaría un punto.
 *
 * El (2) es la clave de que esto sea robusto: en vez de leer las variables
 * internas del deck, interceptamos el `setItem` con el que guarda. Si mañana
 * cambia cómo calcula sus pasos o sus widgets, esto sigue funcionando, porque lo
 * único que mira es la forma del objeto que persiste.
 *
 * Qué NO hace: corregir. Manda las respuestas crudas y el servidor las compara
 * contra la pauta, que vive en la base y no baja al navegador.
 */

/** Súbela al cambiar el script: entra en el ETag y rompe cachés viejas. */
export const VERSION_RASTREO = 5;

function guion({ claseId, docente }) {
  return `
<script data-pulso="rastreo">
(() => {
  'use strict';
  const CLASE   = ${JSON.stringify(claseId)};
  const DOCENTE = ${docente ? 'true' : 'false'};

  // El docente revisa su propio material: no se le anota avance ni se le fuerza
  // el modo, porque desde acá también prueba cómo se va a ver proyectado.
  if (DOCENTE) return;

  /* ---------- 1. Aviso de puntos ---------- */
  let aviso = null;
  function avisar(texto) {
    if (!aviso) {
      aviso = document.createElement('div');
      aviso.setAttribute('data-pulso', 'aviso');
      aviso.style.cssText = 'position:fixed;z-index:2147483647;right:18px;bottom:18px;' +
        'max-width:19rem;padding:12px 16px;border-radius:12px;background:#132a13;' +
        'color:#b7f7c0;border:1px solid #2ea043;font:600 14px/1.45 system-ui,sans-serif;' +
        'box-shadow:0 10px 30px rgba(0,0,0,.45);opacity:0;transition:opacity .25s;' +
        'pointer-events:none';
      document.body.appendChild(aviso);
    }
    aviso.textContent = texto;
    aviso.style.opacity = '1';
    clearTimeout(avisar._t);
    avisar._t = setTimeout(() => { aviso.style.opacity = '0'; }, 4000);
  }

  /* ---------- 2. Reportar avance ---------- */
  let slideMax   = 0;
  let respuestas = {};
  let ultimo     = '';
  let temporizador = null;
  let reintento  = null;
  let enVuelo    = false;

  async function enviar(conKeepalive, forzar) {
    const carga = JSON.stringify({ clase: CLASE, slide: slideMax, respuestas });
    // No repetimos lo mismo: el deck guarda en cada clic y muchos clics no
    // cambian nada de lo que nos importa. El parámetro forzar salta esa
    // comprobación, y hace falta para el reintento del término: al llegar al final
    // el avance ya no cambia más, así que sin esto un «todavía no» sería para
    // siempre.
    //
    // OJO: acá no se pueden escribir backticks. Todo este guion vive dentro de un
    // template literal y el primer backtick lo cierra, dejando código suelto que
    // no compila. Ya rompió producción una vez.
    if ((carga === ultimo && !forzar) || enVuelo) {
      // Si había algo que mandar y la petición anterior seguía en vuelo, se
      // reprograma en vez de perderse. Antes se descartaba, y lo que más se
      // descartaba era justo el último cambio antes de cerrar la pestaña.
      if (enVuelo && (carga !== ultimo || forzar)) programar();
      return;
    }
    enVuelo = true;
    try {
      const r = await fetch('/api/clase-avance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: carga,
        credentials: 'same-origin',
        keepalive: !!conKeepalive,
      });
      if (!r.ok) return;
      ultimo = carga;
      const d = await r.json();
      if (d.puntos_nuevos > 0) {
        avisar('+' + d.puntos_nuevos + ' puntos' + (d.terminada ? ' · clase terminada' : ''));
      }
      // El servidor dice cuánto falta para que el término cuente. Se vuelve a
      // preguntar en ese momento exacto, con un par de segundos de margen por si
      // los relojes no coinciden. Un solo reintento programado, no un sondeo.
      if (!d.terminada && d.faltan_segundos > 0) {
        clearTimeout(reintento);
        reintento = setTimeout(() => enviar(false, true), (d.faltan_segundos + 2) * 1000);
      }
    } catch (e) { /* sin red: se reintenta en el próximo cambio */ }
    finally { enVuelo = false; }
  }

  function programar() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => enviar(false), 1500);
  }

  function mirar(valor) {
    if (typeof valor !== 'string' || valor[0] !== '{') return;
    const d = JSON.parse(valor);
    // Reconocemos por forma, no por nombre de llave: así no dependemos de cómo
    // el deck arma su ID_DECK.
    if (typeof d !== 'object' || d === null) return;
    if (!('slide' in d) || !('respuestas' in d)) return;

    if (typeof d.slide === 'number' && d.slide > slideMax) slideMax = d.slide;
    if (d.respuestas && typeof d.respuestas === 'object') respuestas = d.respuestas;
    programar();
  }

  /* ---------- 3. La intercepción ---------- */
  // Se envuelve el prototipo, no la instancia: el deck llama
  // localStorage.setItem(...) y así pasa por acá igual.
  //
  // Va ANTES de forzar el modo estudio, y ese orden importa dos veces:
  // cambiarModo() termina llamando a guardar(), así que si la intercepción se
  // instalara después, ese primer guardado se perdería; y slideMax y respuestas
  // son 'let', así que una intercepción que se disparara antes de sus
  // declaraciones caería en la zona muerta y mirar() lanzaría.
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (llave, valor) {
    const salida = original.apply(this, arguments);
    try { mirar(valor); } catch (e) { /* jamás romper el guardado del deck */ }
    return salida;
  };

  /* ---------- 4. Modo estudio ---------- */
  // El deck arranca en modo de proyección, y en ese modo guardar() sale temprano
  // y no persiste nada. Sin esto no habría avance que reportar y nadie sumaría
  // un punto.
  //
  // cambiarModo es una declaración de función en el nivel superior del script del
  // deck, así que queda en el objeto global y este script —que va después— la
  // alcanza. Si algún día no estuviera, el respaldo es el botón del HUD, que
  // alterna: por eso solo se pulsa cuando el modo actual es el de proyección.
  try {
    if (typeof cambiarModo === 'function') cambiarModo('estudio');
    else if (document.body.dataset.modo === 'clase')
      document.querySelector('[data-hud="modo"]')?.click();
  } catch (e) { /* si la plantilla cambió, seguimos: el avance por slide igual sirve */ }

  /* ---------- 5. Cierre ---------- */
  // Al ocultar la pestaña se manda lo pendiente. 'visibilitychange' es el que de
  // verdad se dispara en móvil; 'pagehide' cubre el resto.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(temporizador); enviar(true); }
  });
  addEventListener('pagehide', () => { clearTimeout(temporizador); enviar(true); });

  // Y un primer reporte por si el alumno solo mira y no toca nada: el deck ya
  // guardó al forzar el modo estudio, pero si la plantilla cambiara y no lo
  // hiciera, este pulso deja constancia de la apertura igual.
  setTimeout(() => programar(), 2500);
})();
</script>`;
}

/**
 * Devuelve el HTML con el script agregado al final del `body`.
 * Si no encontrara `</body>` —no debería pasar— lo pega al final y ya: un script
 * suelto después del cierre igual lo ejecuta el navegador.
 */
export function instrumentar(html, opciones) {
  const script = guion(opciones);
  const i = html.lastIndexOf('</body>');
  return i === -1 ? html + script : html.slice(0, i) + script + html.slice(i);
}
