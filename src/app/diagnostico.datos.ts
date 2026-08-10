/**
 * Contenido del diagnóstico de entrada de DSY1107.
 *
 * Las preguntas viven acá y no en la base porque cambian poco y así el
 * diagnóstico funciona sin una consulta extra. Si algún día hay varios
 * diagnósticos, esto pasa a una tabla.
 */

export interface Pregunta {
  t: string;
  codigo?: string;
  /** Índice de la alternativa correcta. Ausente = pregunta de encuesta, no puntúa. */
  ok?: number;
  ops: string[];
  exp: string;
}

export interface SeccionDiagnostico {
  id: string;
  titulo: string;
  umbral: number;
  repaso: string;
  critica?: boolean;
  intro?: string;
  preguntas: Pregunta[];
}

export const NO_SE = 'No sé';

export const SECCIONES: SeccionDiagnostico[] = [
  {
    id: 'A', titulo: 'Web y HTTP', umbral: 4,
    repaso: 'Métodos HTTP y códigos de estado — semana 1',
    preguntas: [
      {
        t: 'Acabas de crear un usuario nuevo con una petición al servidor y todo salió bien. ¿Qué código de estado corresponde devolver?',
        ops: ['200', '201', '204'], ok: 1,
        exp: 'El 200 dice «salió bien»; el <b>201 Created</b> dice además «y creé algo nuevo». La diferencia importa cuando alguien consume tu API y necesita saber si hubo creación.',
      },
      {
        t: 'Intentas entrar a una sección y el servidor responde <b>403</b>. ¿Qué significa?',
        ops: ['El servidor no sabe quién eres', 'El servidor sabe quién eres, pero no tienes permiso', 'La dirección no existe'], ok: 1,
        exp: 'El <b>401</b> es «no sé quién eres» (falta el token o es inválido). El <b>403</b> es «sé quién eres y aun así, no». Vas a distinguirlos mucho en la unidad 1.',
      },
      {
        t: '¿Cuál es la diferencia entre <code>POST /usuarios</code> y <code>PUT /usuarios/15</code>?',
        ops: ['Ninguna, son sinónimos', 'POST crea un recurso nuevo; PUT reemplaza uno que ya existe', 'POST envía datos y PUT los lee'], ok: 1,
        exp: '<code>POST</code> crea; <code>PUT</code> reemplaza un recurso identificado. Por eso <code>PUT</code> lleva el id en la ruta y <code>POST</code> no.',
      },
      {
        t: '¿Qué es JSON?',
        ops: ['Un lenguaje de programación', 'Un formato de texto para representar datos, que casi cualquier lenguaje sabe leer', 'Una base de datos'], ok: 1,
        exp: 'No es lenguaje ni base de datos. Es la forma en que dos sistemas distintos se pasan información sin ponerse de acuerdo en nada más.',
      },
      {
        t: '¿Cuál de estas operaciones es <em>idempotente</em>, es decir, repetirla deja el sistema igual que hacerla una sola vez?',
        ops: ['POST /pedidos con el mismo cuerpo', 'PUT /pedidos/15 con el mismo cuerpo', 'Ninguna de las dos'], ok: 1,
        exp: '<code>PUT</code> reemplaza el recurso: llamarlo diez veces con el mismo cuerpo deja el pedido 15 idéntico. <code>POST</code> crea, así que diez llamadas crean diez pedidos. Esto importa cuando un cliente reintenta por timeout.',
      },
      {
        t: 'Intentas registrar un usuario con un correo que ya existe en el sistema. ¿Qué código de estado corresponde?',
        ops: ['400', '404', '409'], ok: 2,
        exp: 'El <b>409 Conflict</b> dice «tu petición está bien formada, pero choca con el estado actual del sistema». El 400 es para peticiones mal armadas y el 404 para recursos que no existen.',
      },
    ],
  },
  {
    id: 'B', titulo: 'Línea de comandos', umbral: 3,
    repaso: 'Navegación básica en terminal — semana 1',
    preguntas: [
      {
        t: 'Estás en <code>/home/ana</code> y quieres llegar a <code>/home/ana/proyectos/api</code>. ¿Qué escribes?',
        ops: ['cd proyectos/api', 'go /home/ana/proyectos/api', 'open proyectos api'], ok: 0,
        exp: 'Como ya estás en <code>/home/ana</code>, basta la ruta relativa. También sirve la absoluta completa.',
      },
      {
        t: '¿Para qué sirve una variable de entorno?',
        ops: ['Para guardar valores que cambian según dónde corre el programa, sin tocar el código', 'Para declarar variables dentro de una función', 'Para instalar programas'], ok: 0,
        exp: 'Es como le dices a un programa «esta es tu contraseña de base de datos» sin escribirla dentro del código. En la semana 17 hay una clase dedicada a por qué nunca se suben al repositorio.',
      },
      {
        t: '¿Qué muestra <code>ls -la</code>?',
        ops: ['La lista de programas instalados', 'El contenido de la carpeta actual, incluidos los ocultos, con sus permisos', 'El historial de comandos'], ok: 1,
        exp: 'La <code>a</code> muestra los ocultos (los que empiezan con punto, como <code>.env</code> o <code>.gitignore</code>) y la <code>l</code> muestra el detalle.',
      },
      {
        t: '¿Qué hace esta línea?',
        codigo: 'cat registro.log | grep ERROR | wc -l',
        ops: ['Muestra el archivo completo y lo guarda', 'Cuenta cuántas líneas del archivo contienen ERROR', 'Borra las líneas con ERROR'], ok: 1,
        exp: 'La tubería <code>|</code> pasa la salida de un comando como entrada del siguiente: <code>cat</code> lo lee, <code>grep</code> filtra y <code>wc -l</code> cuenta líneas. Vas a usar esta combinación para diagnosticar logs de contenedores.',
      },
    ],
  },
  {
    id: 'C', titulo: 'Git', umbral: 3,
    repaso: 'Commits, ramas y .gitignore — semana 7',
    preguntas: [
      {
        t: '¿Qué es un <em>commit</em>?',
        ops: ['Subir los archivos al servidor', 'Un punto guardado en la historia del proyecto, con los cambios y un mensaje', 'Una copia de seguridad automática'], ok: 1,
        exp: 'Un commit es una foto del proyecto en un momento, con un mensaje que explica qué cambió. Subirlo al servidor es otra cosa (<code>push</code>).',
      },
      {
        t: '¿Para qué sirve el archivo <code>.gitignore</code>?',
        ops: ['Para ocultar archivos del sistema operativo', 'Para indicarle a Git qué archivos <b>no</b> debe versionar ni subir', 'Para borrar archivos del repositorio'], ok: 1,
        exp: 'Le dice a Git qué ignorar. Este semestre entregan por GitHub y la pauta revisa que esté bien configurado.',
      },
      {
        t: '¿Cuál de estos <b>nunca</b> debería subirse a un repositorio?',
        ops: ['El archivo README.md', 'La carpeta node_modules', 'El código fuente'], ok: 1,
        exp: 'Son dependencias que cualquiera reinstala con un comando; pesan cientos de megas y no aportan nada. Peor todavía sería subir un <code>.env</code> con contraseñas — eso es un incidente de seguridad, no un descuido.',
      },
      {
        t: 'Trabajas con un compañero en el mismo repositorio. ¿Para qué sirve una <em>rama</em>?',
        ops: ['Para trabajar en un cambio sin afectar la versión principal hasta que esté listo', 'Para hacer una copia del proyecto en otra carpeta', 'Para dividir el repositorio en dos'], ok: 0,
        exp: 'Permite que dos personas trabajen a la vez sin pisarse.',
      },
      {
        t: 'Subiste por error un archivo <code>.env</code> con la contraseña de la base de datos. Lo borras y haces un commit nuevo. ¿Queda resuelto?',
        ops: ['Sí, el archivo ya no está', 'No: sigue en la historia del repositorio y hay que cambiar la contraseña', 'Sí, siempre que el repositorio sea privado'], ok: 1,
        exp: 'Git guarda todo lo que pasó. Cualquiera puede recuperar ese archivo de un commit anterior, y si el repositorio es público, asume que la credencial ya está comprometida: hay que rotarla. Borrarla del último commit no borra el pasado.',
      },
    ],
  },
  {
    id: 'D', titulo: 'Programación asíncrona en JavaScript', umbral: 5, critica: true,
    repaso: 'Promesas y async/await — semana 4',
    intro: 'Esta es la sección más importante del diagnóstico. Todo el backend del semestre es TypeScript asíncrono.',
    preguntas: [
      {
        t: '¿En qué orden se imprimen los números?',
        codigo: `async function tarea() {
  console.log(1);
  await esperar(1000);   // espera un segundo
  console.log(2);
}

console.log(3);
tarea();
console.log(4);`,
        ops: ['1, 2, 3, 4', '3, 1, 4, 2', '3, 4, 1, 2'], ok: 1,
        exp: 'El <code>3</code> va primero porque está antes. Al llamar <code>tarea()</code> se ejecuta hasta el <code>await</code>: imprime <code>1</code> y ahí <b>devuelve el control</b>. Por eso el <code>4</code> sale antes que el <code>2</code>.',
      },
      {
        t: '¿Qué imprime este código?',
        codigo: `async function dame() {
  return 5;
}

const x = dame();
console.log(x);`,
        ops: ['5', 'Una promesa, no el número', 'undefined'], ok: 1,
        exp: 'Una función <code>async</code> <b>siempre</b> devuelve una promesa. Para obtener el 5 hay que escribir <code>await dame()</code>. Este es el origen del clásico «me llegó <code>[object Promise]</code>».',
      },
      {
        t: '¿Qué pasa acá?',
        codigo: `const ids = [1, 2, 3];

ids.forEach(async (id) => {
  await guardarEnBase(id);
});

console.log('Todo guardado');`,
        ops: ['Imprime «Todo guardado» después de guardar los tres', 'Imprime «Todo guardado» de inmediato, sin esperar a que se guarde ninguno', 'Da error de sintaxis'], ok: 1,
        exp: '<code>forEach</code> no sabe nada de promesas: dispara las tres funciones y sigue de largo. Es un error frecuente y muy silencioso, porque no falla — simplemente hace las cosas en desorden.',
      },
      {
        t: 'Las dos versiones hacen lo mismo. Si cada tarea demora 1 segundo, ¿cuánto demora cada una?',
        codigo: `// Versión A
const a = await tarea1();
const b = await tarea2();

// Versión B
const [a, b] = await Promise.all([tarea1(), tarea2()]);`,
        ops: ['A: 2 s · B: 2 s', 'A: 2 s · B: 1 s', 'A: 1 s · B: 2 s'], ok: 1,
        exp: 'En A cada <code>await</code> espera a que termine el anterior. En B las dos parten juntas y esperas a que terminen ambas. Es la optimización más rentable que existe en código asíncrono.',
      },
      {
        t: '¿El <code>catch</code> captura el error si <code>obtenerDatos</code> falla?',
        codigo: `try {
  const datos = obtenerDatos();   // función async, sin await
} catch (e) {
  console.log('Error capturado');
}`,
        ops: ['Sí, siempre', 'No, porque falta el await', 'Sí, pero solo si el error es de red'], ok: 1,
        exp: 'Sin <code>await</code>, la promesa se rechaza <em>después</em> de que el bloque <code>try</code> ya terminó, y el <code>catch</code> no alcanza a verlo.',
      },
      {
        t: '¿Qué es una <em>promesa</em> en JavaScript?',
        ops: ['Un valor que todavía no está disponible, pero que llegará (o fallará) más adelante', 'Una función que se ejecuta más rápido', 'Una forma de declarar variables constantes'], ok: 0,
        exp: 'Es un compromiso: «todavía no tengo el resultado, pero te aviso cuando lo tenga o cuando falle».',
      },
      {
        t: 'De las tres llamadas, la segunda falla. ¿Qué ocurre?',
        codigo: `const [a, b, c] = await Promise.all([
  cargarCatalogo(),
  cargarUsuario(),   // esta lanza un error
  cargarPuntos()
]);`,
        ops: ['Se obtienen a y c, y b queda undefined', 'Todo el await falla: no se obtiene ninguno de los tres', 'Se reintenta la segunda automáticamente'], ok: 1,
        exp: '<code>Promise.all</code> rechaza en cuanto una falla, así que el <code>await</code> lanza y no recibes nada — aunque las otras dos hayan terminado bien. Si necesitas los resultados que sí llegaron, se usa <code>Promise.allSettled</code>.',
      },
      {
        t: '¿Cuál de las dos versiones espera de verdad a que se guarden todos los pedidos?',
        codigo: `// Versión A
for (const p of pedidos) {
  await guardar(p);
}

// Versión B
pedidos.map(async (p) => await guardar(p));`,
        ops: ['Solo la A', 'Solo la B', 'Las dos'], ok: 0,
        exp: 'La A espera uno a uno. La B crea un arreglo de promesas y nadie las espera: el código sigue de largo. Para que la B funcione hay que escribir <code>await Promise.all(pedidos.map(...))</code>.',
      },
    ],
  },
  {
    id: 'E', titulo: 'Bases de datos', umbral: 3,
    repaso: 'SELECT, relaciones y claves foráneas — semana 5',
    preguntas: [
      {
        t: '¿Qué hace esta consulta?',
        codigo: 'SELECT nombre, precio FROM juegos WHERE precio < 10000;',
        ops: ['Devuelve el nombre y el precio de los juegos que cuestan menos de 10.000', 'Cambia el precio de los juegos a 10.000', 'Borra los juegos que cuestan menos de 10.000'], ok: 0,
        exp: '<code>SELECT</code> lee, no modifica. <code>WHERE</code> filtra.',
      },
      {
        t: '¿Para qué sirve una clave foránea?',
        ops: ['Para cifrar los datos de una tabla', 'Para relacionar una fila de una tabla con una fila de otra', 'Para ordenar los resultados'], ok: 1,
        exp: 'Es lo que conecta las tablas entre sí y garantiza que la referencia apunte a algo que existe de verdad.',
      },
      {
        t: 'Tienes <code>usuarios</code> y <code>compras</code>. Un usuario puede tener muchas compras, y cada compra pertenece a un solo usuario. ¿Dónde va la referencia?',
        ops: ['En usuarios, apuntando a compras', 'En compras, apuntando a usuarios', 'En una tercera tabla'], ok: 1,
        exp: 'En una relación uno-a-muchos, la referencia va siempre <b>en el lado «muchos»</b>. Cada compra guarda a qué usuario pertenece.',
      },
      {
        t: 'Tienes 100 pedidos, y 20 de ellos apuntan a un usuario que fue eliminado. ¿Cuántas filas devuelve un <code>INNER JOIN</code> entre pedidos y usuarios?',
        ops: ['100', '80', '120'], ok: 1,
        exp: 'El <code>INNER JOIN</code> devuelve solo las filas que calzan en ambas tablas: los 20 pedidos huérfanos quedan fuera. Si los quisieras igual, con el usuario en nulo, sería un <code>LEFT JOIN</code>.',
      },
      {
        t: 'Una consulta que busca por correo funcionaba rápido y ahora, con un millón de filas, tarda varios segundos. ¿Qué es lo primero que revisarías?',
        ops: ['Si la tabla tiene un índice en la columna correo', 'Si el servidor tiene suficiente memoria', 'Si la consulta usa SELECT *'], ok: 0,
        exp: 'Sin índice, la base recorre la tabla completa en cada búsqueda, y ese costo crece con el tamaño. Con índice va directo. Es el problema de rendimiento más común y el más fácil de arreglar.',
      },
    ],
  },
  {
    id: 'F', titulo: 'Redes y despliegue', umbral: 2,
    repaso: 'Puertos y servicios — semana 8',
    preguntas: [
      {
        t: 'Tu aplicación corre en <code>http://localhost:3000</code>. ¿Qué es el <code>3000</code>?',
        ops: ['La versión del programa', 'El puerto donde el programa está escuchando', 'La cantidad de usuarios que soporta'], ok: 1,
        exp: 'Una misma máquina puede tener muchos programas escuchando a la vez; el puerto es el número que distingue a cuál le hablas.',
      },
      {
        t: '¿Qué significa que un servicio esté «en la nube»?',
        ops: ['Que corre en computadores de un proveedor, a los que accedes por internet', 'Que no necesita servidores', 'Que los datos se guardan en el navegador'], ok: 0,
        exp: '«La nube» es el computador de otra persona, alquilado y accesible por internet.',
      },
      {
        t: '¿Has usado Docker antes?',
        ops: ['Sí, sé crear imágenes y levantar contenedores', 'Lo he usado siguiendo instrucciones, pero no sabría explicarlo', 'Sé qué es, pero nunca lo he usado', 'Nunca lo he escuchado'],
        exp: 'Esta no tiene respuesta correcta: es la pregunta que más le sirve al docente. Si la mayoría del curso nunca lo ha usado, la clase de Docker de la semana 8 se alarga. No pasa nada si nunca lo has tocado.',
      },
      {
        t: '¿Cuál es la diferencia principal entre un contenedor y una máquina virtual?',
        ops: ['El contenedor comparte el núcleo del sistema anfitrión; la máquina virtual lleva su propio sistema operativo completo', 'El contenedor no puede guardar datos', 'La máquina virtual es siempre más rápida'], ok: 0,
        exp: 'Por eso un contenedor arranca en segundos y pesa megas, mientras una máquina virtual demora y pesa gigas. Es la razón por la que vas a levantar cinco servicios en tu notebook sin que se caiga.',
      },
    ],
  },
  {
    id: 'G', titulo: 'Seguridad', umbral: 3,
    repaso: 'Hash, cifrado y codificación — semana 2',
    preguntas: [
      {
        t: '¿Cuál es la diferencia entre <em>hashear</em> y <em>cifrar</em> una contraseña?',
        ops: ['Ninguna, son sinónimos', 'El cifrado se puede revertir con la clave; el hash está diseñado para no poder revertirse', 'El hash es más seguro porque usa más caracteres'], ok: 1,
        exp: 'Cifrar es reversible si tienes la clave. Hashear es de una sola vía: por eso los sistemas serios guardan el hash de tu contraseña y no la contraseña.',
      },
      {
        t: 'Recibes este texto: <code>eyJub21icmUiOiJhbmEifQ==</code>. ¿Está seguro su contenido?',
        ops: ['Sí, está cifrado', 'No, está codificado en Base64 y cualquiera lo puede leer', 'Depende de la longitud de la clave'], ok: 1,
        exp: 'Base64 <b>no es seguridad</b>, es una forma de representar datos como texto. Ese ejemplo dice <code>{"nombre":"ana"}</code>. Lo vas a comprobar tú mismo en la semana 2, y es clave para entender por qué un token va firmado y no solo codificado.',
      },
      {
        t: 'Un token JWT va firmado. ¿Qué garantiza esa firma?',
        ops: ['Que su contenido es secreto y nadie puede leerlo', 'Que nadie lo modificó después de emitirlo', 'Que nunca expira'], ok: 1,
        exp: 'La firma garantiza <b>integridad y origen</b>, no confidencialidad: cualquiera puede leer el contenido de un JWT, pero si le cambia una coma la firma deja de calzar. Por eso jamás se guardan datos sensibles dentro de un token.',
      },
      {
        t: '¿Qué riesgo tiene esta línea?',
        codigo: `const sql = "SELECT * FROM usuarios WHERE correo = '" + correo + "'";`,
        ops: ['Ninguno si el correo viene de un formulario', 'Permite inyección SQL: el usuario puede escribir SQL en el campo', 'Solo es lento'], ok: 1,
        exp: 'Si alguien escribe <code>\' OR 1=1 --</code> en el campo, la consulta cambia de significado y devuelve todos los usuarios. Se evita con consultas parametrizadas, donde el valor nunca se concatena.',
      },
    ],
  },
  {
    id: 'H', titulo: 'Tipado y estructura del código', umbral: 3,
    repaso: 'TypeScript, interfaces e inyección de dependencias — semana 5',
    preguntas: [
      {
        t: '¿Para qué sirve una <em>interfaz</em> en TypeScript?',
        ops: ['Para describir la forma que debe tener un objeto, sin generar código en tiempo de ejecución', 'Para crear objetos, igual que una clase', 'Para conectarse a una API'], ok: 0,
        exp: 'La interfaz existe solo mientras el compilador revisa tu código; en el JavaScript final desaparece. Es un contrato: dice qué campos y tipos se esperan.',
      },
      {
        t: '¿Qué problema tiene usar <code>any</code> como tipo?',
        ops: ['Hace el programa más lento', 'Apaga la verificación del compilador para ese valor', 'No compila'], ok: 1,
        exp: 'Con <code>any</code> TypeScript deja de avisarte: si escribes mal un nombre de campo, el error recién aparece cuando el programa se cae en ejecución. Es renunciar justo a lo que fuiste a buscar.',
      },
      {
        t: 'Compara las dos versiones. ¿Cuál se puede probar sin tocar la base de datos real?',
        codigo: `// Versión A
class ServicioPedidos {
  guardar(p) { new RepositorioOracle().insertar(p); }
}

// Versión B
class ServicioPedidos {
  constructor(private repo) {}
  guardar(p) { this.repo.insertar(p); }
}`,
        ops: ['La A', 'La B, porque el repositorio se le entrega desde afuera', 'Las dos igual'], ok: 1,
        exp: 'En la B puedes pasarle un repositorio falso al construirlo. En la A el repositorio real está incrustado adentro y no hay forma de reemplazarlo. Eso es inyección de dependencias, y es la base de cómo funciona NestJS.',
      },
      {
        t: 'Una función de 200 líneas valida el pedido, lo guarda en la base y envía el correo de confirmación. ¿Cuál es el problema principal?',
        ops: ['Es demasiado larga para leerla', 'Hace tres cosas distintas: no se puede cambiar ni probar una sin arrastrar las otras', 'Ninguno si funciona'], ok: 1,
        exp: 'El largo es el síntoma; la causa es que mezcla tres responsabilidades. Este semestre la pauta de evaluación revisa justamente eso: que la configuración de mensajería no esté enredada con la lógica de negocio.',
      },
    ],
  },
];

export function puntuables(sec: SeccionDiagnostico): number {
  return sec.preguntas.filter(p => p.ok !== undefined).length;
}

export function totalPreguntas(): number {
  return SECCIONES.reduce((n, s) => n + s.preguntas.length, 0);
}
