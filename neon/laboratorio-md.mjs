/**
 * El compilador: de un laboratorio en Markdown a la lista de bloques que guarda
 * la base y dibuja el navegador.
 *
 * Vive aparte de `subir-laboratorio.mjs` por una razón concreta: así se puede
 * probar con archivos de mentira, sin base de datos, y `probar-compilador.mjs`
 * puede exigirle que **rechace** lo que antes aceptaba en silencio.
 *
 * ── Por qué se compila acá y no en el navegador ──
 *
 * El enunciado se convierte a una lista ordenada de bloques y así se guarda. Si
 * el navegador recibiera Markdown tendría que traer un intérprete y, peor, ubicar
 * dónde va cada caja dentro del texto ya convertido. Partirlo al subir deja el
 * trabajo hecho una vez y del lado donde se puede revisar.
 *
 * ── La regla que ordena todo lo demás ──
 *
 * **Una línea que empieza con `:::` y no se entiende es un error, no es prosa.**
 *
 * Antes no era así, y ese era el problema: el escáner miraba línea por línea sin
 * recordar nada, y todo lo que no calzaba con su regex caía a prosa sin decir ni
 * pío. Un `:::pists` mal escrito le imprimía «:::pists» al alumno. Una caja
 * indentada dentro de una lista, o con un espacio antes de la llave, **se perdía
 * entera** —y con ella la respuesta que iba ahí—. Y como no sabía distinguir un
 * bloque de código, un laboratorio que *documentara* esta sintaxis terminaba con
 * el código destrozado y una caja fantasma en medio.
 *
 * Ninguna de esas fallaba. Todas llegaban a la pantalla del alumno.
 *
 * Así que ahora el escáner recuerda dos cosas —si viene de abrir una cerca de
 * código y si viene de abrir un bloque— y el vocabulario es cerrado: cinco
 * clases, dos formatos de caja, seis llaves de encabezado. Fuera de eso, error
 * con número de línea del archivo de verdad.
 */
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

/** Las cinco clases de bloque. `caja` y `control` llevan argumento; los avisos no. */
const CLASES = ['caja', 'control', 'alerta', 'pista', 'ojo'];
const AVISOS = ['alerta', 'pista', 'ojo'];
/** Los dos formatos de caja que el navegador sabe dibujar (ver `laboratorio.component.ts`). */
const FORMATOS = ['corta', 'codigo'];
/** El encabezado es un juego cerrado: una llave de más suele ser una tildada. */
const LLAVES = ['codigo', 'titulo', 'descripcion', 'minutos', 'puntos', 'orden'];

/** Cualquier línea que empiece con `:::`, con o sin indentación. */
const MARCA = /^(\s*):::(.*)$/;
/** Un marcador bien escrito: `:::pista` o `:::caja{1.2 corta}`, y nada más en la línea. */
const BIEN = /^([a-z]+)(?:\{([^{}]*)\})?$/;
/** Apertura y cierre de cerca de código: ``` o ~~~, hasta con tres espacios delante. */
const CERCA = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Compila el texto completo de un laboratorio.
 *
 * Nunca revienta ni escribe: devuelve `problemas` y quien llama decide. Y los
 * junta todos en vez de morir en el primero, porque el docente está arreglando
 * su guía y quiere la lista entera de una vez, no una vuelta por error.
 *
 * @returns {{meta: object, bloques: object[], ids: string[],
 *            controles: number, avisos: number, problemas: string[]}}
 */
export function compilar(texto) {
  const problemas = [];
  const cabecera = leerEncabezado(texto, problemas);
  if (!cabecera) return { meta: {}, bloques: [], ids: [], controles: 0, avisos: 0, problemas };

  const { meta, cuerpo, desplazamiento } = cabecera;
  const cuerpoCompilado = compilarCuerpo(cuerpo, desplazamiento, problemas);

  return { meta, ...cuerpoCompilado, problemas };
}

// ============================== El encabezado ==============================

/**
 * Lee el YAML de arriba y devuelve el resto.
 *
 * Ojo con dos cosas que ya mordieron acá:
 *
 * `split('---\n', 3)` **trunca** el arreglo en JavaScript, no deja el resto en el
 * último elemento como en Python. Y estos laboratorios usan `---` como separador
 * horizontal cada pocas secciones, así que eso se comía el 95% del enunciado sin
 * decir nada: quedaban 6 bloques de 40 y una caja de diecisiete. Por eso se busca
 * el cierre con `indexOf` y se corta ahí.
 *
 * Y `Number(x) || 0` convertía «100 pts» en cero puntos, sin queja. Un laboratorio
 * de dos horas publicado con cero puntos no falla en ninguna parte: simplemente no
 * le paga al alumno. Ahora eso es un error.
 */
function leerEncabezado(texto, problemas) {
  if (!texto.startsWith('---\n')) {
    problemas.push('falta el encabezado entre --- y --- al principio del archivo');
    return null;
  }
  const cierre = texto.indexOf('\n---\n', 4);
  if (cierre === -1) {
    problemas.push('el encabezado no se cierra: falta la línea --- que lo termina');
    return null;
  }

  const meta = {};
  const cabeza = texto.slice(4, cierre);
  let n = 1;
  for (const linea of cabeza.split('\n')) {
    n++;
    if (!linea.trim()) continue;
    const i = linea.indexOf(':');
    if (i <= 0) {
      problemas.push(`línea ${n}: «${linea.trim()}» no es «llave: valor»`);
      continue;
    }
    const llave = linea.slice(0, i).trim();
    if (!LLAVES.includes(llave)) {
      problemas.push(
        `línea ${n}: «${llave}» no es una llave del encabezado. Son: ${LLAVES.join(', ')}`);
      continue;
    }
    meta[llave] = linea.slice(i + 1).trim();
  }

  for (const k of ['codigo', 'titulo', 'puntos']) {
    if (!meta[k]) problemas.push(`falta «${k}» en el encabezado`);
  }
  for (const k of ['puntos', 'minutos', 'orden']) {
    if (meta[k] !== undefined && !/^\d+$/.test(meta[k])) {
      problemas.push(`«${k}: ${meta[k]}» no es un número entero`);
    }
  }

  return {
    meta,
    cuerpo: texto.slice(cierre + 5),
    // Para que los números de línea apunten al archivo y no al cuerpo suelto: el
    // docente los va a buscar en su editor.
    desplazamiento: texto.slice(0, cierre + 5).split('\n').length - 1,
  };
}

// ============================== El cuerpo ==============================

function compilarCuerpo(cuerpo, desplazamiento, problemas) {
  const bloques = [];
  const ids = [];
  const numerosDeControl = [];

  let prosa = [];
  let dentro = null;
  let contenido = [];
  /** El delimitador de la cerca abierta, o null. Es toda la memoria que hace falta. */
  let cerca = null;

  const volcarProsa = () => {
    const t = prosa.join('\n').trim();
    if (t) bloques.push({ tipo: 'html', html: marked.parse(t) });
    prosa = [];
  };

  const lineas = cuerpo.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const n = desplazamiento + i + 1;

    // ── Las cercas de código, primero que todo ──
    // Dentro de una cerca no hay marcadores: hay texto que el alumno tiene que
    // leer tal cual. Sin esto, un laboratorio que enseñe esta misma sintaxis se
    // compila roto.
    const esCerca = linea.match(CERCA);
    if (esCerca) {
      if (!cerca) cerca = esCerca[1];
      else if (esCerca[1][0] === cerca[0] && esCerca[1].length >= cerca.length
               && !esCerca[2].trim()) cerca = null;
    }
    if (cerca) {
      if (dentro) contenido.push(linea);
      else prosa.push(linea);
      continue;
    }

    const marca = linea.match(MARCA);
    if (!marca) {
      if (dentro) contenido.push(linea);
      else prosa.push(linea);
      continue;
    }

    // ── De acá abajo, la línea empieza con `:::` y tiene que entenderse ──

    const [, sangria, resto] = marca;
    if (sangria) {
      problemas.push(`línea ${n}: el marcador «:::${resto.trim()}» está indentado. ` +
        'Los bloques van pegados al margen izquierdo, o se pierden.');
      continue;
    }

    if (!resto.trim()) {
      if (!dentro) {
        problemas.push(`línea ${n}: hay un ::: de cierre sin bloque abierto`);
        continue;
      }
      cerrar(dentro, contenido, bloques, ids, numerosDeControl, problemas);
      dentro = null;
      continue;
    }

    const bien = resto.trim().match(BIEN);
    if (!bien) {
      problemas.push(`línea ${n}: no entiendo «:::${resto.trim()}». ` +
        'Se escribe :::pista o :::caja{1.2 corta}, sin espacios antes de la llave.');
      continue;
    }
    const [, clase, arg] = bien;
    if (!CLASES.includes(clase)) {
      problemas.push(`línea ${n}: «:::${clase}» no existe. Son: ${CLASES.join(', ')}`);
      continue;
    }
    if (dentro) {
      problemas.push(`línea ${n}: «:::${clase}» abre dentro del «:::${dentro.clase}» de la ` +
        `línea ${dentro.linea}. Los bloques no se anidan: cierra el anterior con :::`);
      continue;
    }

    volcarProsa();
    dentro = { clase, arg: (arg ?? '').trim(), tieneLlave: arg !== undefined, linea: n };
    contenido = [];
  }

  volcarProsa();

  if (cerca) problemas.push(`la cerca de código «${cerca}» no se cierra`);
  if (dentro) problemas.push(`el bloque «:::${dentro.clase}» de la línea ${dentro.linea} no se cierra`);
  if (!ids.length) problemas.push('el laboratorio no tiene ninguna caja de respuesta');

  revisarControles(numerosDeControl, problemas);

  return {
    bloques,
    ids,
    controles: numerosDeControl.length,
    avisos: bloques.filter((b) => b.tipo === 'aviso').length,
  };
}

/**
 * Cierra el bloque abierto y lo valida.
 *
 * El identificador de una caja es la llave con la que se guarda la respuesta. Si
 * se repite, dos cajas escriben en el mismo lugar y una se come a la otra; si
 * falta, no hay dónde guardar. Nada de eso da error en tiempo de ejecución, así
 * que se caza acá o no se caza nunca.
 */
function cerrar(dentro, contenido, bloques, ids, numerosDeControl, problemas) {
  const html = marked.parse(contenido.join('\n').trim());
  const { clase, arg, tieneLlave, linea } = dentro;

  if (clase === 'caja') {
    if (!tieneLlave) {
      problemas.push(`línea ${linea}: :::caja necesita identificador, p.ej. :::caja{1.2 corta}`);
      return;
    }
    const partes = arg.split(/\s+/).filter(Boolean);
    const [id, formato, ...sobra] = partes;
    if (!id) {
      problemas.push(`línea ${linea}: :::caja sin identificador`);
      return;
    }
    if (ids.includes(id)) {
      problemas.push(`línea ${linea}: el identificador «${id}» está repetido`);
      return;
    }
    if (formato !== undefined && !FORMATOS.includes(formato)) {
      problemas.push(`línea ${linea}: «${formato}» no es un formato de caja. ` +
        `Son: ${FORMATOS.join(', ')} (y sin poner nada queda ${FORMATOS[0]})`);
      return;
    }
    if (sobra.length) {
      problemas.push(`línea ${linea}: sobra «${sobra.join(' ')}» en :::caja{${arg}}. ` +
        'Va el identificador y, si acaso, el formato.');
      return;
    }
    ids.push(id);
    bloques.push({ tipo: 'caja', id, formato: formato ?? FORMATOS[0], enunciado: html });
    return;
  }

  if (clase === 'control') {
    if (!/^\d+$/.test(arg)) {
      problemas.push(`línea ${linea}: :::control necesita un número, p.ej. :::control{1}`);
      return;
    }
    numerosDeControl.push(Number(arg));
    bloques.push({ tipo: 'control', numero: Number(arg), html });
    return;
  }

  if (tieneLlave) {
    problemas.push(`línea ${linea}: «:::${clase}» no lleva llave, y trae {${arg}}`);
    return;
  }
  bloques.push({ tipo: 'aviso', clase, html });
}

/**
 * Los controles se numeran 1, 2, 3… sin saltos ni repetidos.
 *
 * No es capricho: el avance del alumno se guarda como **un** número, `tramo`, y
 * la pantalla marca alcanzado todo control con `numero <= tramo`. Con un salto,
 * el alumno nunca llega al último; con un repetido, marcar uno marca los dos.
 */
function revisarControles(numeros, problemas) {
  const esperado = numeros.map((_, i) => i + 1);
  if (numeros.join(',') !== esperado.join(',')) {
    problemas.push(`los puntos de control van ${numeros.join(', ') || '(ninguno)'} y tienen que ` +
      `ir ${esperado.join(', ') || '(ninguno)'}: correlativos desde 1, en orden y sin repetir`);
  }
}

export { CLASES, AVISOS, FORMATOS, LLAVES };
