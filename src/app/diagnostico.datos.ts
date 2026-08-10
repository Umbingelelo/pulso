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
    id: 'A', titulo: 'Web y HTTP', umbral: 3,
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
    ],
  },
  {
    id: 'B', titulo: 'Línea de comandos', umbral: 2,
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
    ],
  },
  {
    id: 'D', titulo: 'Programación asíncrona en JavaScript', umbral: 4, critica: true,
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
    ],
  },
  {
    id: 'E', titulo: 'Bases de datos', umbral: 2,
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
    ],
  },
  {
    id: 'G', titulo: 'Seguridad', umbral: 2,
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
    ],
  },
];

export function puntuables(sec: SeccionDiagnostico): number {
  return sec.preguntas.filter(p => p.ok !== undefined).length;
}

export function totalPreguntas(): number {
  return SECCIONES.reduce((n, s) => n + s.preguntas.length, 0);
}
