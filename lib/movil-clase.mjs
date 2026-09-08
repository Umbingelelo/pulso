/**
 * Lo que se le agrega al deck para que sirva en un celular.
 *
 * Se inyecta al servir, junto al rastreo y por la misma razón: los decks de la
 * carpeta de la asignatura no se tocan, así que esto vale para los que ya están
 * subidos sin volver a subir ninguno.
 *
 * ── Qué está roto en un teléfono ──
 *
 * El deck se autora en un escenario fijo de 1920x1080 y lo encoge entero con
 * `Math.min(innerWidth / 1920, innerHeight / 1080)`. En vertical manda el ancho,
 * y en un teléfono de 390 px eso da un factor de 0,20: el cuerpo de texto, que
 * son 31 px, sale a 6 px, y en las diapositivas densas —que lo escriben en 22—
 * a 4,5. No es «se ve chico», es que no se lee.
 *
 * Y hay algo peor que el tamaño: el deck **solo se navega con el teclado**
 * —flecha derecha, espacio—. No hay un solo `touchstart` en la plantilla. En un
 * teléfono no se puede pasar de la primera diapositiva, por muy grande que se vea.
 *
 * ── Las dos cosas que hace ──
 *
 * 1. **Gira el escenario** noventa grados cuando el teléfono está en vertical.
 *    El factor pasa a `min(ancho / 1080, alto / 1920)`, que en los mismos 390 px
 *    es 0,36: **1,78 veces más**, y las densas suben de 4,5 a 7,9 px. Sigue
 *    siendo poco —el techo lo pone el letterbox, y subirlo pide remaquetar—,
 *    pero se lee, y es más de lo que da el teléfono acostado (0,31), porque en
 *    horizontal la barra del navegador se come justo el alto que hacía falta.
 *
 *    Quien tenga el giro bloqueado —que es mucha gente— gana todo: voltea el
 *    aparato y lee. Quien no lo tenga bloqueado ve el texto de lado un segundo,
 *    voltea, la consulta de vertical deja de aplicar y el deck se dibuja solo con
 *    su propio escalado. En los dos casos el gesto es el mismo y en los dos
 *    termina bien.
 *
 * 2. **Deslizar y dos botones**, que es lo que arregla lo que de verdad estaba
 *    roto. Se despacha la misma tecla que mandaría un teclado en vez de llamar a
 *    `avanzar()`: la flecha es la interfaz que el propio deck documenta en su
 *    ayuda, y pasando por ella el revelado por pasos y los widgets siguen
 *    funcionando igual, sin que este archivo sepa nada de cómo lo hacen.
 *
 * El giro se impone con `!important` desde una hoja de estilos y no escribiendo
 * la transformación en línea. Tiene que ser así: `escalar()` del deck está
 * suscrito a `resize` y reescribe `escenario.style.transform` cada vez que la
 * ventana cambia, así que una transformación en línea nuestra duraría hasta el
 * primer giro del teléfono. Una regla con `!important` en una hoja le gana a la
 * línea, y entonces no hay carrera que perder.
 */

/** Súbela al cambiar algo de acá. Entra en el ETag junto con la del rastreo. */
export const VERSION_MOVIL = 1;

export function guionMovil() {
  return `
<style data-pulso="movil">
  /* Le gana a la transformación en línea que escalar() reescribe en cada resize. */
  body.pulso-girado #escenario { transform: var(--pulso-giro) !important; }

  /* El HUD del deck no se traduce a un teléfono. Sus cinco piezas son el
     cronómetro del docente, el contador, el botón de modo —que ya viene
     forzado—, las notas de orador, que se abren en una ventana emergente que el
     teléfono bloquea, y la tabla de atajos de un teclado que no existe. Encima,
     girado el escenario, queda leyéndose de lado y tapando el pie de la
     diapositiva. Se esconde entero y el contador se devuelve más abajo. */
  body.pulso-girado .hud { display: none !important; }

  [data-pulso="nav"] {
    position: fixed; z-index: 2147483646; left: 14px; bottom: 14px;
    display: flex; gap: 12px; align-items: center;
  }
  /* Girado, el eje de lectura corre de arriba abajo, así que los botones se
     apilan y el de avanzar va arriba. El galón no se rota: se cambia por el que
     ya apunta hacia donde toca (ver encajar()). Rotar el contenedor entero fue
     el primer intento y sale mal por partida doble —una fila de 108 px de ancho
     girada sobre su centro se sale de la pantalla por abajo, y las puntas
     terminan apuntando al revés—. */
  body.pulso-girado [data-pulso="nav"] { flex-direction: column; }
  body.pulso-girado [data-pulso="nav"] [data-ir="siguiente"] { order: 0; }
  body.pulso-girado [data-pulso="nav"] [data-ir="atras"] { order: 1; }

  [data-pulso="nav"] button {
    width: 48px; height: 48px; border-radius: 999px;
    background: rgba(18, 24, 31, .74); color: #e6edf3;
    border: 1px solid rgba(255, 255, 255, .24);
    font: 600 24px/1 system-ui, -apple-system, sans-serif;
    display: grid; place-items: center; padding: 0;
    -webkit-tap-highlight-color: transparent;
  }
  /* Con su propio fondo, y no texto suelto: el deck tiene tema claro y tema
     oscuro, y un gris claro sin nada detrás desaparece sobre el pie blanco de la
     diapositiva. Es la misma píldora de los botones, más baja. */
  [data-pulso="nav"] [data-pulso="cuenta"] {
    font: 600 12px/1 system-ui, -apple-system, sans-serif;
    color: rgba(230, 237, 243, .92);
    background: rgba(18, 24, 31, .74);
    border: 1px solid rgba(255, 255, 255, .24);
    border-radius: 999px; padding: 0 10px;
    display: grid; place-items: center; white-space: nowrap;
  }
  /* Girado, el texto del contador ocupa a lo alto lo que medía a lo ancho. Se le
     reserva esa caja a mano: sin ella la rotación se sale del pie y el «1 / 38»
     aparece cortado por el borde de la pantalla. */
  /* Fuera de la columna, y colocado como la pista. Girándolo dentro del flujo la
     caja mide a lo ancho lo que el texto necesita a lo largo, y «1 / 38» se sale
     de su propia píldora. Va a la esquina contraria a los botones: volteado el
     teléfono, uno cae bajo el pulgar derecho y el otro bajo el izquierdo. */
  body.pulso-girado [data-pulso="nav"] [data-pulso="cuenta"] {
    position: fixed; left: 50%; top: 50%; padding: 4px 11px;
    transform: translate(-50%, -50%) rotate(90deg)
               translate(calc(38px - 50vh), calc(50vw - 38px));
  }

  /* Volteado el teléfono en contra de las agujas del reloj —que es como se
     endereza el escenario— el borde izquierdo de la pantalla queda abajo y el
     derecho arriba. Por eso la pista va a la izquierda, que es donde el lector
     espera un pie, y el aviso de puntos a la derecha, que es su cabecera. */
  [data-pulso="pista"] {
    position: fixed; z-index: 2147483647; left: 50%; bottom: 76px;
    transform: translateX(-50%);
    max-width: 20rem; padding: 11px 16px; border-radius: 12px;
    background: rgba(18, 24, 31, .92); color: #e6edf3;
    border: 1px solid rgba(255, 255, 255, .18);
    font: 500 13px/1.45 system-ui, -apple-system, sans-serif; text-align: center;
    transition: opacity .4s;
  }
  /* Se centra primero y se corre después **por el eje ya girado**, que es lo que
     hace que la cuenta sea una sola resta. Colocarlo con «left» y girarlo encima
     no funciona: la rotación es sobre el centro del elemento, y el centro de una
     caja de 20rem de ancho cae en mitad de la pantalla por mucho que su borde
     izquierdo esté pegado al margen. Así quedaba tapando el título. */
  body.pulso-girado [data-pulso="pista"] {
    left: 50%; bottom: auto; top: 50%;
    transform: translate(-50%, -50%) rotate(90deg) translateY(calc(50vw - 52px));
  }
  body.pulso-girado [data-pulso="aviso"] {
    left: 50% !important; right: auto !important;
    bottom: auto !important; top: 50% !important;
    transform: translate(-50%, -50%) rotate(90deg) translateY(calc(52px - 50vw)) !important;
  }
</style>
<script data-pulso="movil">
(() => {
  'use strict';

  // Un puntero grueso es un dedo. No se mira el ancho: un notebook con pantalla
  // táctil no necesita nada de esto, y un teléfono acostado sí necesita deslizar.
  if (!matchMedia('(pointer: coarse)').matches) return;

  const escenario = document.getElementById('escenario');
  if (!escenario) return;

  /* ---------- 1. Girar el escenario ---------- */

  const ANCHO = 1920, ALTO = 1080;

  // El escenario tiene transform-origin en 0 0, así que después de rotarlo
  // noventa grados ocupa x de -1080f a 0 e y de 0 a 1920f: hay que devolverlo
  // con la traslación, y de paso centrarlo. Si el origen dejara de ser 0 0,
  // esto se ve mal de inmediato y no falla en silencio.
  function encajar() {
    const girar = innerHeight > innerWidth && innerWidth < 700;
    document.body.classList.toggle('pulso-girado', girar);
    // El galón apunta a donde de verdad se avanza, y girado eso es hacia arriba.
    // Mismo botón, distinto símbolo: rotar el galón es lo que deja las puntas
    // mirando al revés.
    botones.atras.textContent = girar ? '\\u2193' : '\\u2039';
    botones.siguiente.textContent = girar ? '\\u2191' : '\\u203a';
    if (!girar) return;
    const f = Math.min(innerWidth / ALTO, innerHeight / ANCHO);
    const tx = (innerWidth + ALTO * f) / 2;
    const ty = (innerHeight - ANCHO * f) / 2;
    document.body.style.setProperty('--pulso-giro',
      'translate(' + tx + 'px,' + ty + 'px) rotate(90deg) scale(' + f + ')');
  }

  /* ---------- 2. Avanzar ---------- */

  // La flecha y no avanzar(): es la interfaz que el deck documenta en su propia
  // tabla de ayuda, y pasando por ella el revelado por pasos sigue igual.
  //
  // El deck ignora las teclas cuando se está escribiendo en un control, mirando
  // e.target.tagName. Acá el evento se despacha sobre window, que no tiene
  // tagName, así que no lo confunde con un campo de texto.
  function ir(siguiente) {
    dispatchEvent(new KeyboardEvent('keydown', {
      key: siguiente ? 'ArrowRight' : 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    }));
  }

  /* ---------- 3. Los botones ---------- */

  // Abajo a la izquierda a propósito. El HUD del deck y el aviso de puntos viven
  // abajo a la derecha, y —con el escenario girado— el teléfono se voltea en
  // contra de las agujas del reloj, así que esta esquina es la que queda bajo el
  // pulgar cuando por fin se está leyendo.
  const nav = document.createElement('div');
  nav.setAttribute('data-pulso', 'nav');

  const botones = {};
  for (const [clave, etiqueta, siguiente] of [
    ['atras', 'Diapositiva anterior', false],
    ['siguiente', 'Diapositiva siguiente', true],
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.ir = clave;
    b.setAttribute('aria-label', etiqueta);
    b.addEventListener('click', () => ir(siguiente));
    nav.appendChild(b);
    botones[clave] = b;
  }

  // El contador que se le quitó al HUD, devuelto donde sí se lee. Se copia del
  // suyo en vez de llevar la cuenta aparte: el deck lo reescribe en cada render,
  // así que esto sigue estando bien sin saber nada de cómo cuenta.
  const cuenta = document.createElement('span');
  cuenta.setAttribute('data-pulso', 'cuenta');
  nav.appendChild(cuenta);
  document.body.appendChild(nav);

  const suyo = document.getElementById('contador');
  const copiarCuenta = () => { cuenta.textContent = suyo?.textContent ?? ''; };
  copiarCuenta();
  if (suyo) {
    new MutationObserver(copiarCuenta)
      .observe(suyo, { childList: true, characterData: true, subtree: true });
  }

  // Recién ahora, que los botones existen: encajar() les cambia el símbolo.
  addEventListener('resize', encajar);
  addEventListener('orientationchange', encajar);
  encajar();

  /* ---------- 4. Deslizar ---------- */

  let x0 = 0, y0 = 0, t0 = 0, sirve = false;

  addEventListener('touchstart', (e) => {
    // Un dedo, y no sobre algo que ya hace lo suyo con el toque: las
    // alternativas de un quiz son botones, y las respuestas largas, textareas.
    sirve = e.touches.length === 1 &&
      !e.target?.closest?.('button, a, input, textarea, select, [contenteditable]');
    if (!sirve) return;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    t0 = Date.now();
  }, { passive: true });

  addEventListener('touchend', (e) => {
    if (!sirve) return;
    sirve = false;
    if (Date.now() - t0 > 800) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    // Con el escenario girado, el eje de lectura corre de arriba abajo en la
    // pantalla: pasar la página deja de ser hacia la izquierda y pasa a ser
    // hacia arriba. El otro eje es el que descarta los deslizamientos torcidos.
    const girado = document.body.classList.contains('pulso-girado');
    const avance = girado ? -dy : -dx;
    const cruce = girado ? dx : dy;
    if (Math.abs(avance) < 55 || Math.abs(avance) <= Math.abs(cruce)) return;
    ir(avance > 0);
  }, { passive: true });

  /* ---------- 5. La pista, una vez por sesión ---------- */

  // En sessionStorage y no en localStorage porque la pista es de esta visita.
  // Ojo: el rastreo envuelve Storage.prototype.setItem, que es el mismo para los
  // dos almacenes, así que esto también le pasa por delante. No molesta: mirar()
  // descarta cualquier valor que no empiece con una llave.
  try {
    if (!sessionStorage.getItem('pulso.movil.pista')) {
      sessionStorage.setItem('pulso.movil.pista', '1');
      const pista = document.createElement('div');
      pista.setAttribute('data-pulso', 'pista');
      pista.textContent = 'Gira el teléfono. Desliza o usa las flechas para avanzar.';
      pista.addEventListener('click', () => pista.remove());
      document.body.appendChild(pista);
      setTimeout(() => { pista.style.opacity = '0'; }, 6000);
      setTimeout(() => pista.remove(), 6600);
    }
  } catch (e) { /* modo privado: sin pista y sin drama */ }
})();
</script>`;
}
