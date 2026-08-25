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
 * código y si viene de abrir un bloque— y el vocabulario es cerrado: seis
 * clases, dos formatos de caja, diez llaves de encabezado. Fuera de eso, error
 * con número de línea del archivo de verdad.
 */
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

/**
 * Las seis clases de bloque. `caja`, `control` y `pauta` llevan argumento; los avisos no.
 *
 * `pauta` es la única que **no llega al navegador**: es la respuesta correcta que
 * el docente escribe al lado de cada caja para que el modelo tenga con qué
 * comparar. Se guarda en su propia columna, no entre los bloques, justamente para
 * que no pueda dibujarse por accidente. Ver `0030_pauta.sql`.
 */
const CLASES = ['caja', 'control', 'alerta', 'pista', 'ojo', 'pauta'];
const AVISOS = ['alerta', 'pista', 'ojo'];
/** Los dos formatos de caja que el navegador sabe dibujar (ver `laboratorio.component.ts`). */
const FORMATOS = ['corta', 'codigo'];
/** El encabezado es un juego cerrado: una llave de más suele ser una tildada. */
const LLAVES = ['codigo', 'titulo', 'descripcion', 'minutos', 'puntos', 'orden',
                'opcional', 'requiere', 'excluye', 'desde', 'hasta'];
/** `2026-08-24` o `2026-08-24 23:59`, con «T» o espacio en medio. */
const FECHA = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/;

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
 * @returns {{meta: object, bloques: object[], ids: string[], pautas: object,
 *            controles: number, avisos: number, problemas: string[]}}
 */
export function compilar(texto) {
  const problemas = [];
  const cabecera = leerEncabezado(texto, problemas);
  if (!cabecera) {
    return { meta: {}, bloques: [], ids: [], pautas: {}, controles: 0, avisos: 0, problemas };
  }

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
/**
 * Valida una fecha del plazo y la deja en hora local sin zona —`2026-08-24T23:59`—
 * que es lo que `new Date()` interpreta en la zona de quien sube el laboratorio.
 * La conversión a UTC la hace `subir-laboratorio.mjs`, que es el que habla con la
 * base; acá solo se comprueba y se completa.
 *
 * Sin hora, `desde` es el primer minuto del día y `hasta` el último. Que
 * «hasta: 2026-08-24» significara medianoche dejaría fuera el domingo entero, y el
 * domingo es justo el día en que entrega el que dejó el laboratorio para el final:
 * el docente escribiría la fecha correcta y el alumno cobraría cero.
 */
function leerFecha(valor, llave, problemas) {
  const m = FECHA.exec(valor.trim());
  if (!m) {
    problemas.push(`«${llave}: ${valor}» no es una fecha. Se escribe «2026-08-24» ` +
      'o «2026-08-24 23:59»');
    return null;
  }
  const [, anio, mes, dia, hh, mm] = m;
  const hora = hh ?? (llave === 'hasta' ? '23' : '00');
  const min  = mm ?? (llave === 'hasta' ? '59' : '00');
  const local = `${anio}-${mes}-${dia}T${hora}:${min}`;

  // La regex acepta el 31 de febrero y `new Date` lo corre al 3 de marzo sin
  // decir nada. Comparar el día y el mes de vuelta es lo que lo caza.
  //
  // Se comprueban solo el día y el mes, no la hora: en Chile la medianoche del
  // primer domingo de septiembre **no existe** —el reloj salta de 23:59 a 01:00— y
  // exigir que la hora vuelva igual haría que «desde: 2026-09-06» se rechazara por
  // «no existe en el calendario», que además de falso es indescifrable. Con el
  // salto, `new Date` deja el instante en la 01:00 de ese mismo día, que es
  // exactamente lo que se quiere decir con «desde el domingo».
  const d = new Date(`${local}:00`);
  if (isNaN(d.getTime()) || d.getDate() !== Number(dia) || d.getMonth() + 1 !== Number(mes)) {
    problemas.push(`«${llave}: ${valor}» no existe en el calendario`);
    return null;
  }
  return local;
}

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
    // Se quitan las comillas envolventes si las hay: un título con dos puntos
    // adentro se escribe entre comillas, y guardarlas haría que el alumno viera
    // «"Desafío 1 · Hablar HTTP a mano"» con comillas y todo.
    let valor = linea.slice(i + 1).trim();
    if (valor.length > 1 && ((valor.startsWith('"') && valor.endsWith('"'))
                          || (valor.startsWith("'") && valor.endsWith("'")))) {
      valor = valor.slice(1, -1).trim();
    }
    meta[llave] = valor;
  }

  for (const k of ['codigo', 'titulo', 'puntos']) {
    if (!meta[k]) problemas.push(`falta «${k}» en el encabezado`);
  }
  for (const k of ['puntos', 'minutos', 'orden']) {
    if (meta[k] !== undefined && !/^\d+$/.test(meta[k])) {
      problemas.push(`«${k}: ${meta[k]}» no es un número entero`);
    }
  }
  if (meta.opcional !== undefined && !['true', 'false'].includes(meta.opcional)) {
    problemas.push(`«opcional: ${meta.opcional}» tiene que ser true o false`);
  }
  // `requiere` sin `opcional` se acepta —un laboratorio de la línea principal
  // también podría tener prerrequisito— pero `opcional` sin `requiere` casi
  // siempre es un olvido: el desafío quedaría abierto desde el primer día.
  //
  // «Casi siempre», y hay un caso legítimo: un laboratorio opcional **autosuficiente**,
  // que se puede hacer suelto y no es premio por haber terminado otro. El L2B de
  // ITY1102 es exactamente eso y su guía docente lo dice: «es opcional y no es
  // requisito de nada», «si lo dicta suelto, es autosuficiente».
  //
  // Para ése se escribe «requiere: ninguno». No se acepta la ausencia a secas
  // porque entonces el olvido y la decisión se ven igual en el archivo, y el que
  // lea el encabezado en marzo no sabría cuál de las dos fue.
  // Local y no en `meta`: `meta` es lo que dice el archivo, y esto es una lectura
  // de eso. Guardarlo ahí le agregaría al publicador una llave que no existe en
  // ningún encabezado.
  const sinCandado = (meta.requiere ?? '').toLowerCase() === 'ninguno';
  if (sinCandado) delete meta.requiere;

  if (meta.opcional === 'true' && !meta.requiere && !sinCandado) {
    problemas.push('un laboratorio «opcional: true» sin «requiere» queda abierto ' +
      'desde el principio. Escribe el código del que hay que entregar antes ' +
      '—p.ej. «requiere: L1»— o, si de verdad va abierto porque se puede hacer ' +
      'suelto, dilo con «requiere: ninguno».');
  }
  if (sinCandado && meta.opcional !== 'true') {
    problemas.push('«requiere: ninguno» solo tiene sentido junto a «opcional: true»: ' +
      'un laboratorio de la línea principal ya está abierto. Quita la línea.');
  }
  if (meta.requiere && meta.requiere === meta.codigo) {
    problemas.push(`«requiere: ${meta.requiere}» apunta a sí mismo: nunca se desbloquearía`);
  }
  // `excluye` es el par alternativo: entregar uno cierra el otro. Apuntarse a sí
  // mismo lo cerraría al entregarlo, y entregarlo es justamente lo que hay que
  // poder hacer. Y excluir lo mismo que se requiere es un candado imposible: no se
  // abre hasta entregar aquello, y al entregarlo queda cerrado.
  if (meta.excluye && meta.excluye === meta.codigo) {
    problemas.push(`«excluye: ${meta.excluye}» apunta a sí mismo`);
  }
  if (meta.excluye && meta.requiere && meta.excluye === meta.requiere) {
    problemas.push(`«excluye» y «requiere» apuntan los dos a ${meta.excluye}: ` +
      'ese laboratorio no se podría abrir nunca, porque lo que lo abre es lo mismo ' +
      'que lo cierra');
  }

  // El plazo en que paga. Las dos son opcionales y cada una es independiente: solo
  // `hasta` es lo normal —«esta semana y no después»—, y solo `desde` sirve para
  // dejar programado el de la semana que viene.
  for (const k of ['desde', 'hasta']) {
    if (meta[k] === undefined) continue;
    const normal = leerFecha(meta[k], k, problemas);
    if (normal) meta[k] = normal;
    // Se borra la que no se entendió para que la comparación de abajo no opere
    // sobre basura y agregue un segundo problema que confunde al primero.
    else delete meta[k];
  }
  // Comparación de cadenas: `leerFecha` las devuelve normalizadas al mismo formato
  // de ancho fijo, así que el orden alfabético es el orden cronológico.
  if (meta.desde && meta.hasta && meta.hasta < meta.desde) {
    problemas.push(`«hasta: ${meta.hasta}» es anterior a «desde: ${meta.desde}»: ` +
      'el plazo terminaría antes de empezar y no pagaría nunca');
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

  /** id de caja → { texto, linea }. Se aplana al final, ya validado. */
  const pautas = {};

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
      cerrar(dentro, contenido, bloques, ids, numerosDeControl, pautas, problemas);
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
  // Una pauta que apunta a una caja que no existe no falla en ninguna parte: se
  // guarda, nadie la lee, y la caja que el docente creía cubierta se revisa a
  // ciegas. Es el mismo modo de falla que las cajas huérfanas, y se caza igual.
  for (const [id, p] of Object.entries(pautas)) {
    if (!ids.includes(id)) {
      problemas.push(`línea ${p.linea}: la pauta «${id}» no corresponde a ninguna caja. ` +
        `Las cajas son: ${ids.join(', ')}`);
    }
  }

  return {
    bloques,
    ids,
    pautas: Object.fromEntries(Object.entries(pautas).map(([id, p]) => [id, p.texto])),
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
function cerrar(dentro, contenido, bloques, ids, numerosDeControl, pautas, problemas) {
  const crudo = contenido.join('\n').trim();
  const { clase, arg, tieneLlave, linea } = dentro;

  // La pauta se guarda **en Markdown crudo** y no en HTML, porque su único lector
  // es el modelo: convertirla a HTML sería gastar tokens en etiquetas para después
  // volver a quitarlas. Y va antes de `marked.parse` para no pagar esa conversión.
  if (clase === 'pauta') {
    if (!tieneLlave || !arg) {
      problemas.push(`línea ${linea}: :::pauta necesita la caja a la que corresponde, ` +
        'p.ej. :::pauta{1.2}');
      return;
    }
    if (/\s/.test(arg)) {
      problemas.push(`línea ${linea}: :::pauta{${arg}} lleva solo el identificador de la caja`);
      return;
    }
    if (pautas[arg]) {
      problemas.push(`línea ${linea}: la caja «${arg}» ya tiene pauta en la línea ${pautas[arg].linea}`);
      return;
    }
    if (!crudo) {
      problemas.push(`línea ${linea}: la pauta de «${arg}» está vacía`);
      return;
    }
    pautas[arg] = { texto: crudo, linea };
    return;
  }

  const html = marked.parse(crudo);

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
