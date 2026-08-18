# Pulso

Plataforma de seguimiento de alumnos para las asignaturas de **Cristian Calderón** en Duoc UC,
Escuela de Informática y Telecomunicaciones.

**Es transversal:** una sola instalación atiende todas las asignaturas que dicto, en todos los
semestres. El alumno elige la suya y su sección al registrarse, puede **agregar más ramos** con la
misma cuenta, y en cada uno acumula **puntos** que más adelante podrá canjear por elementos que lo
ayuden durante el semestre.

Por eso vive en `2026-02/Pulso`, al mismo nivel que las asignaturas y no dentro de ninguna.

- **En producción:** https://pulso-rust.vercel.app
- **Base de datos:** Neon (Postgres 17), proyecto `pulso` en São Paulo
- **Material de clases:** Vercel Blob privado, store `pulso-clases`

## Estado

**v3 — ficha del alumno y tienda de canjes.** Lo que funciona hoy:

- Registro con nombre, correo institucional, contraseña, asignatura y sección
- **Varios ramos por alumno**, con una sola cuenta: se agregan desde *Mis ramos* y cada uno lleva
  sus propios puntos y sus propias actividades
- **Periodos**: `2026-2` hoy, `2027-1` cuando toque. Cerrar un semestre no borra nada
- Inicio de sesión y elección de avatar
- 100 puntos de bienvenida por ramo, otorgados por el servidor
- **Diagnóstico de entrada**: 40 preguntas en ocho secciones, se rinde una sola vez, **lo corrige el
  servidor** y suma 50 puntos
- **Ficha del alumno**: todo lo suyo en un ramo en una pantalla —puntos, movimientos, diagnóstico por
  sección, actividades y canjes—. El docente abre la de cualquiera de sus secciones desde la nómina;
  el alumno ve la suya
- **Tienda de canjes**: 16 artículos por ramo —décimas, desbloquear una pregunta, prórrogas, pistas—.
  Los que no tocan una nota ni un plazo se entregan al instante; el resto queda como solicitud y
  espera el visto bueno del docente, que puede aprobar o rechazar devolviendo los puntos
- **Vista de docente**: se elige la asignatura y el periodo, y desde ahí la nómina por sección, los
  promedios del diagnóstico, la bandeja de canjes por resolver, y otorgar o descontar puntos

En la hoja de ruta: avance por laboratorio y planes de estudio personales.

## Stack

| | |
|---|---|
| Frontend | Angular 20, componentes autónomos y señales |
| Datos | Neon (Postgres 17) por su Data API, con RLS |
| Autenticación | Propia: `crypt()` en Postgres, JWT ES256, cookie httpOnly |
| Archivos | Vercel Blob privado |
| Avatares | DiceBear, generados en el navegador |
| Despliegue | Vercel |

## Modelo de datos

```
periodos ─────┐
              ├──< secciones ──< matriculas ──< movimientos_puntos
asignaturas ──┤                      │   │          │
              │                      │   │    saldos_puntos (vista)
              │                      │   └──< canjes >── articulos
              ├──< actividades ──< resultados_actividad
              │           │
              │           └──< diagnostico_secciones ──< diagnostico_preguntas
              └──< clases ──< progreso_clase

docentes ──< docente_asignaturas    ← qué dicta cada docente, y en qué periodo
mis_ramos                           ← vista: los ramos del alumno con su saldo
mis_clases                          ← vista: las clases del ramo con el avance propio
resumen_alumnos                     ← vista: la nómina del docente
vitrina                             ← vista: la tienda de un ramo, con saldo y límites
canjes_detalle                      ← vista: los canjes con alumno y artículo resueltos
```

`perfiles` tiene una fila por usuario de `auth.users` y guarda a **la persona**: nombre y avatar. Lo
que cursa vive en `matriculas`, una fila por sección, así que un alumno puede llevar dos asignaturas
a la vez y volver el semestre siguiente por otra, siempre con la misma cuenta.

Los puntos cuelgan de la matrícula y no del perfil: lo que gana en un ramo lo gasta en ese ramo, y
cada semestre parte limpio. Viven en un **libro de movimientos** que solo crece —nunca se edita— y el
saldo es la suma.

La tienda respeta esa regla: un canje inserta un movimiento negativo y un rechazo inserta uno
positivo que lo devuelve. Nunca se borra ni se corrige una línea, así que el historial de un alumno
muestra la secuencia completa —«Canje: Una décima −50», «Devolución: Una décima +50»— y el saldo
siempre se puede reconstruir sumando.

Una sección pertenece a una asignatura **en un periodo**. El código `001D` se repite entre
asignaturas y volverá a repetirse cada semestre, así que lo único único es la terna completa. Lo
mismo vale para el código de una actividad.

El detalle, y cómo agregar una asignatura o un semestre, está en [`supabase/README.md`](supabase/README.md).

## Seguridad

Todo se apoya en Row Level Security, no en validaciones del cliente. Lo que el alumno puede ver o
escribir se decide contra **sus matrículas**, y lo que el docente puede ver, contra las secciones que
declaró dictar.

- **Catálogo** (`periodos`, `asignaturas`, `secciones`): lectura pública, porque los desplegables se
  llenan antes de iniciar sesión. No filtra por `activa`: ese flag decide qué se ofrece en el
  registro, no quién puede mirar. Si filtrara, al cerrar el semestre los alumnos perderían de vista
  sus propios ramos pasados.
- **Perfil**: cada alumno lee y modifica solo el propio; el docente ve los de sus secciones.
- **Matrícula**: el alumno se matricula solo, pero únicamente en una sección abierta de un periodo
  abierto. No la edita ni la borra: dar de baja es del docente, y queda `activa = false` para no
  perder el historial.
- **Actividades**: cada alumno ve **solo las de los ramos que cursa**. Un laboratorio de otra
  asignatura no aparece, y si intenta registrar su resultado lo rechaza el RLS y, detrás, un trigger.
- **Puntos**: el alumno **lee** los suyos y nunca los escribe. No existe política de `insert` para él,
  así que un intento desde el cliente recibe `403`. Los otorgan triggers `security definer` o el
  docente.
- **Diagnóstico**: el alumno **no tiene política de lectura** sobre `diagnostico_preguntas`. Entra por
  `diagnostico_cuestionario()`, que devuelve las preguntas sin la pauta, y entrega por
  `rendir_diagnostico()`, que corrige en el servidor. `correcta` y `explicacion` no salen de la base
  hasta que entrega.
- **Canjes**: `canjes` no tiene políticas de `insert`, `update` ni `delete`. Todo pasa por funciones
  `security definer` —`solicitar_canje`, `resolver_canje`, `cancelar_canje`— que son las que cobran,
  devuelven y comprueban precio, saldo, límite y stock. Si el alumno pudiera insertar en la tabla, se
  llevaría el artículo sin pagar.
- **Ficha**: una sola función para el alumno y para el docente, y la autorización se decide adentro.
  Cambiar el id de la matrícula en la URL no abre la ficha de nadie más.
- **Clases**: el deck vive en un store de Blob **privado**, y su ruta está en `clases.archivo`, una
  columna sobre la que `pulso_app` **no tiene grant**. La pauta de sus quiz, en `clases.pauta`,
  tampoco. Son grants por columna: la tabla se lee, esas dos no. El único camino al archivo es
  `/api/clase`, que exige cookie de sesión y matrícula vigente. `progreso_clase` no tiene políticas de
  `insert` ni `update`: todo pasa por `abrir_clase()` y `progreso_clase_guardar()`, que son las que
  corrigen y pagan.
- Ni un resultado ni un movimiento tienen políticas de `update` o `delete`: no se editan nunca.
- El perfil y su primera matrícula los crea `registrar_alumno()` en una sola transacción, junto con la
  cuenta. No hay trigger sobre una tabla ajena que pueda quedar a medias.
- La tabla de credenciales, `usuarios`, tiene RLS activo y **ninguna política ni grant**. Solo se entra
  por `autenticar()`, `registrar_alumno()` y `cambiar_clave()`, así que un error de programación en la
  API no puede filtrar un hash: el rol con el que se conecta no alcanza esa tabla.

### Este repositorio es público

Por eso el contenido de los diagnósticos **no se versiona**: vive en `.gitignore` y en la base. Solo se
versiona la estructura, en `neon/migrations/`.

Después de una migración que toque una **vista**, la firma de una función, o que **agregue una columna
que la app lea por la Data API** (como `puntua_desde` y `puntua_hasta` en `actividades`), corre
`node neon/refrescar-api.mjs`. La Data API cachea el esquema al arrancar: sin ese aviso la consulta
sigue respondiendo 200 pero con las columnas viejas, así que el campo nuevo llega `undefined` y la
pantalla se ve exactamente igual que antes de migrar. No da error en ninguna parte.

Y por eso los decks de clase tampoco: viven en Vercel Blob privado, no acá. Subirlos a `public/` habría
sido más simple y habría dejado el material de todo el semestre —y los apuntes docentes— a un clic de
cualquiera, además de volver los puntos por abrir la clase un adorno.

## Clases

Cada clase es un deck HTML **autocontenido**: fuentes, CSS, imágenes y JS incrustados, cero referencias
externas. Por eso se puede servir desde cualquier parte sin adaptarlo, y por eso el archivo que el
docente proyecta en sala es exactamente el mismo que estudia el alumno.

Se sube con:

```bash
set -a; . ./.env.local; set +a
node neon/subir-clase.mjs \
  --archivo "../Desarrollo_Cloud_Native/Clases/decks/S01-Presentacion-de-la-asignatura.html" \
  --sigla DSY1107 --periodo 2026-2 --codigo S01 \
  --titulo "Presentación de la asignatura" \
  --dictada 2026-08-10 --orden 1 --publicar
```

Sin `--publicar` queda cargada y **oculta**: así el deck de la próxima semana puede estar arriba sin que
nadie lo vea antes de tiempo. `--publicar-en "2026-08-17T08:30:00-04:00"` la programa. `--seco` informa
lo que haría sin subir ni escribir.

El script lee el deck para sacar dos cosas que el navegador no debe decidir: **cuántas diapositivas**
tiene y la **pauta de sus quiz**. La llave de la pauta es el índice de la diapositiva que contiene el
quiz, porque así lo guarda el deck (`slides.indexOf(el.closest('.slide'))`). Si eso cambia en la
plantilla hay que cambiarlo en el script el mismo día: una pauta con las llaves corridas no da error,
simplemente deja de pagar puntos.

### Los puntos

| Tramo | Por omisión | Cuándo |
|---|---|---|
| Abrir | 5 | La primera vez que la abre |
| Actividad | 10 | Por cada quiz del deck que responda bien, una vez cada uno |
| Terminar | 20 | Al llegar a la última diapositiva, **si pasó el mínimo de tiempo** |

El mínimo son 8 segundos por diapositiva. Sin él, saltar al final pagaría lo mismo que recorrerla.
Pero **pospone, no niega**: si todavía no se cumple, el servidor devuelve `faltan_segundos` y el
navegador vuelve a preguntar en ese instante; y si el alumno cerró la pestaña, `abrir_clase()` lo
liquida la próxima vez que entre. Antes negaba, y 19 alumnos se quedaron sin sus 20 puntos.

### La ventana: llegar a tiempo vale más

```
publicada_desde ──────────── ventana_hasta ──────────────▶
     │      puntos completos       │   puntos × factor_atrasado
     │                             │
  se puede abrir              cierra la ventana
```

Antes de `publicada_desde` la clase no existe para el alumno. Entre las dos fechas todo vale
completo. Después sigue sumando —queremos que repase igual— pero multiplicado por
`factor_atrasado`, que por omisión es la mitad. `ventana_hasta` en null significa que no caduca.

El factor se decide **en el momento de cada cobro**, no al abrir: quien abre durante la clase y
resuelve ahí mismo cobra completo; quien abre a tiempo pero la termina en tres semanas cobra
completo la apertura y reducido el resto. Es lo que se quiere premiar: haberla visto.

Con una excepción que importa. El término se valora con el instante en que el alumno **llegó a la
última diapositiva** (`progreso_clase.alcanzo_final_en`), no con el instante en que se le paga.
Entre los dos puede pasar el mínimo de tiempo, y sería absurdo que nuestra propia demora lo dejara
fuera de la ventana. Es el caso 5 de `neon/probar-ventana.mjs` y es el que más fácil se rompe si
alguien toca esto después.

El movimiento en el historial lo dice: «Terminó la clase D1 · … **(fuera de plazo)**».

### Programarla

Desde `/curso`, en la tarjeta **Clases**: horario de habilitación, cierre de la ventana, factor y los
puntos de cada tramo. **Habilitar ahora** abre la ventana por 90 minutos, que es el atajo del día de
clase. Todo pasa por `clase_programar()`, que es `security definer` y comprueba adentro que la clase
sea de una asignatura que dictas: cambiar el id en la petición no programa la clase de nadie más.

Hay un `check` que impide que la ventana cierre antes de que la clase se publique. En ese estado
nadie podría cobrar completo nunca, así que siempre es un error y no una intención.

### Cómo se entera Pulso

`/api/clase` sirve el deck y le pega un script al final del `body`, **al pasar**. Los archivos de la
carpeta de la asignatura no se tocan nunca: rehacer un deck no obliga a reinstrumentarlo.

Ese script hace dos cosas. Primero fuerza el modo estudio, porque el deck arranca en modo `clase`
—pensado para proyectar— y en ese modo no persiste nada; sin esto nadie sumaría un punto. Después
intercepta el `localStorage.setItem` con el que el deck guarda su avance completo y lo reenvía a
`/api/clase-avance`. Se apoya en la *forma* del objeto que el deck persiste, no en sus variables
internas, así que sobrevive a que el deck cambie por dentro.

La corrección la hace Postgres contra `clases.pauta`. La API no confía en un «acerté 3» del navegador.

> **Letra chica honesta:** el avance lo reporta el navegador, y el `data-correcta` sigue estando en el
> HTML que el alumno descarga. Quien abra las herramientas de desarrollo puede mentir. La base se
> defiende de lo que puede —paga una sola vez cada cosa y exige el mínimo de tiempo— pero estos puntos
> son un empujón para repasar, no una evaluación. Lo que evalúa son el diagnóstico y los laboratorios.

### Probarlo

Tres capas, porque cada una ve lo que la anterior no puede. Todas usan la cuenta
`alumno.prueba@duocuc.cl` y todas dejan su progreso limpio al empezar, así que se corren tantas veces
como haga falta.

```bash
set -a; . ./.env.local; set +a

node neon/probar-clase.mjs             # 1. la lógica: Postgres y el Blob
node neon/probar-clase-http.mjs        # 2. el cable: producción por HTTP
node neon/probar-clase-navegador.mjs   # 3. el navegador: que el inyector se ejecute
node neon/probar-ventana.mjs           # 4. la ventana: que llegar a tiempo valga más
```

**1. La lógica.** Abrir, reabrir sin cobrar, fallar, acertar, reenviar sin cobrar, mandar basura,
intentar terminar antes del mínimo, terminar de verdad. Y que `mis_clases` no exponga `archivo` ni
`pauta`, y que `pulso_app` reciba `permission denied` al intentar leer esas dos columnas. Acepta
`--sigla` y `--codigo`.

**2. El cable.** Lo mismo pero contra producción: sin sesión no se abre, con cookie llega el deck
completo, el `ETag` devuelve `304` sin reenviar 750 KB, y la ruta del blob no aparece en el HTML.

**3. El navegador.** La que de verdad importa, y la última que escribí. Las otras dos comprueban que el
script inyectado **está** en el HTML; ninguna comprueba que se **ejecute**. Y el inyector se apoya en
dos hechos del deck —que `cambiarModo` queda en el objeto global, y que envolver
`Storage.prototype.setItem` intercepta su guardado— que serán ciertos hasta que la plantilla cambie a un
módulo ES, y entonces dejarán de serlo **en silencio**: el alumno vería su clase igual de bien y no
sumaría un solo punto. Esta prueba maneja un Chrome real, recorre las 21 diapositivas con la flecha,
responde un quiz y verifica que el POST salga, que pague y que el aviso aparezca.

Necesita `puppeteer-core` —ya está como devDependency, no descarga navegador— y un Chrome instalado.
Usa un perfil temporal que borra al terminar, así que no toca el tuyo. Si tu Chrome está en otra parte:
`CHROME=/ruta/al/binario node neon/probar-clase-navegador.mjs`.

**Esa cuenta se mantiene a propósito** y está matriculada en DSY1107 001D y en ITY1102 001D. Aparece en
la nómina del docente, que es el precio de tenerla: si molesta, `matriculas.activa = false` la saca de
los promedios pero también la deja fuera de la prueba.

## Laboratorios

Un laboratorio es una actividad de tipo `laboratorio` con cuerpo: el enunciado, las cajas donde el
alumno escribe y los puntos de control que tú validas en sala. Se escriben en Markdown en la carpeta
de la asignatura y se publican con un script.

### El formato

Encabezado con `codigo`, `titulo`, `descripcion`, `minutos`, `puntos`, `orden` y —si tiene plazo—
`desde` y `hasta`, y después el enunciado con cinco bloques propios, todos cerrados con `:::`:

| Bloque | Para qué |
|---|---|
| `:::caja{1.2 corta}` | Donde el alumno responde. `corta` o `codigo` |
| `:::control{1}` | Punto de control: el alumno declara que llegó, tú lo validas en sala |
| `:::alerta` | Un aviso |
| `:::pista` | Una ayuda |
| `:::ojo` | Algo que mirar |

**El identificador de una caja no se cambia después de publicar.** Es la llave con la que se guarda esa
respuesta: si cambia, lo que el alumno ya escribió queda huérfano —la caja aparece vacía y su texto
sigue en la base sin que nadie lo lea— y eso no da error en ninguna parte. El publicador avisa cuando
detecta respuestas guardadas en cajas que ya no existen.

### Una línea con `:::` que no se entiende es un error

Es la regla que ordena todo lo demás, y está en `neon/laboratorio-md.mjs`. Antes no era así: el
escáner miraba línea por línea sin recordar nada y lo que no calzaba caía a prosa **sin decir nada**.
Un `:::pists` mal escrito se le imprimía tal cual al alumno. Una caja indentada dentro de una lista,
o con un espacio antes de la llave, **se perdía entera** —y con ella la respuesta que iba ahí—. Una
caja dentro de un aviso también. Y un laboratorio que *documentara* esta misma sintaxis en un bloque
de código quedaba con el código destrozado y una caja fantasma en medio. Ninguna fallaba: todas
llegaban a la pantalla del alumno.

Así que el vocabulario es cerrado y se revisa al subir, con el número de línea del archivo:

| Se rechaza | Por qué |
|---|---|
| `:::nota`, `:::pists` | Sólo existen las cinco de la tabla de arriba |
| `:::caja {1.2}`, `  :::caja{1.2}` | Espacio antes de la llave o indentación: la caja se perdía |
| Una caja o un aviso dentro de otro | Los bloques no se anidan; el de afuera cerraba donde no era |
| `:::caja{1.2 larga}` | Los formatos son `corta` y `codigo`, que son los que el navegador dibuja |
| Un identificador repetido o ausente | Es la llave de la respuesta |
| Controles `1, 3` o `1, 1` | El avance es **un** número: con un salto el alumno nunca llega al último |
| `puntos: 100 pts`, `descripción:` | Publicaba con cero puntos, o con la descripción en el suelo |

Y lo que va dentro de una cerca de ` ``` ` o `~~~` se respeta tal cual: ahí `:::caja{9.9}` es texto
que el alumno tiene que leer, no una caja.

### Publicarlo

```bash
set -a; . ./.env.local; set +a
node neon/subir-laboratorio.mjs --archivo ../Desarrollo_Cloud_Native/Laboratorios/L1-*.md \
  --sigla DSY1107 --periodo 2026-2            # valida e informa
node neon/subir-laboratorio.mjs --archivo … --escribir   # y ahora sí
```

Sin `--escribir` no toca nada: dice cuántos bloques, cuántas cajas y con qué identificadores quedó, o
la lista completa de problemas con su línea. Vale la pena mirarlo, porque de ahí salió que un `split`
mal usado se estaba comiendo el 95% del enunciado sin quejarse.

El enunciado se convierte a HTML y se parte en bloques **al subirlo**, no en el navegador: así el
alumno no baja un intérprete de Markdown y, sobre todo, no hay que adivinar dónde va cada caja dentro
del texto ya convertido.

### El plazo: paga en su semana y no después

Un laboratorio de la semana 1 valía lo mismo entregado el martes en clase que la noche antes del
examen. Eso convierte el laboratorio en una tarea acumulable, y acumularlas es lo que no queremos: se
hace en la sala, con el docente al lado, porque ahí es donde sirve.

```
puntua_desde ──────────────── puntua_hasta ─────────────────▶
     │        paga los puntos        │      no paga nada
```

Las dos fechas viven en `actividades`, que es donde el trigger que cobra ya lee los puntos. **Nulas
las dos = sin plazo**, que es como se comportaba todo antes: ninguna actividad ya subida cambió de
conducta al migrar. Sirven también para las entregas y el diagnóstico, aunque nazcan sin plazo.

**El plazo decide puntos, no acceso.** Fuera de plazo el laboratorio se abre igual, se escribe igual y
se entrega igual: solo no paga. Quién ve qué sigue siendo asunto de `activa` y de `requiere`, que son
cosas distintas. Y eso no es una concesión, es lo que hace que el resto funcione: la fila de
`resultados_actividad` se escribe igual, así que el alumno atrasado conserva su trabajo, aparece en el
avance del docente y **se le sigue desbloqueando el desafío opcional** —el candado mira esa fila, no
los puntos—. Bloquear la entrega dejaría al que se atrasó una vez con el laboratorio congelado a
medias y sin ningún desafío por el resto del semestre.

Cuenta el momento de la entrega y no el del cobro: el trigger valora `completada_en`, igual que la
0009 valora `alcanzo_final_en`.

Se administra en dos lugares, y el orden importa:

- **En el `.md`**, con `desde: 2026-08-18` y `hasta: 2026-08-24`. En hora local, y sin hora `desde` es
  el primer minuto del día y `hasta` el último —que `hasta: 2026-08-24` significara medianoche dejaría
  fuera el domingo entero, que es justo cuando entrega el que lo dejó para el final—.
- **En el panel**, en «Actividades y laboratorios», con dos campos de fecha y un botón **«Esta
  semana»** que rellena lunes 00:00 → domingo 23:59. Ahí también se quita, vaciando los dos campos.

Si el `.md` no trae las fechas, **volver a subirlo no pisa** las del panel: corregirle una tilde a un
laboratorio no puede borrarle el plazo, sobre todo porque borrarlo no da error —simplemente vuelve a
pagar siempre, para todos, sin que nadie se entere—.

La columna **«a tiempo»** de la tabla del panel es el control de ese error: si dice «24 entregas · 5 a
tiempo», la fecha está mal puesta, no es que el curso sea flojo.

### Cómo lo vive el alumno

El plazo se dice **antes**, no al entregar: descubrirlo después no es un plazo, es una trampa. La
tarjeta de Actividades muestra «Fuera de plazo» en vez de «Pendiente» y pone la fecha; la barra fija
del laboratorio muestra los puntos que se van a pagar de verdad —cero si ya cerró— y el aviso explica
que se puede entregar igual. Y el mensaje del final dice lo que se cobró, no lo que el laboratorio
vale: antes devolvía los puntos fijos y decía «Ganaste 100 puntos» aunque no se hubiera pagado nada.

Se guarda solo mientras escribe, dos segundos después de la última tecla, y también al salir de la
pantalla o cerrar la pestaña. Un laboratorio son dos horas de trabajo: pedirle que se acuerde de
apretar «Guardar» es garantizar que alguien va a perderlo todo.

Entregar es una sola vez —paga los puntos y cierra la edición— así que pide confirmación y avisa
cuántas cajas quedan en blanco. No se exige responderlas todas, porque hay laboratorios que se cortan
por tiempo, pero sí que haya al menos una: entregar en blanco por accidente sería irreversible desde
su lado.

### La sugerencia por IA

Al lado de cada caja hay un botón **«¿Voy bien?»**. El alumno escribe, lo aprieta, y el modelo le dice
si lo que hizo capta la idea. Tres veredictos, y ninguno dice «incorrecto»: **Vas bien**, **Te falta una
parte**, **Vuelve a mirarlo**.

**Nunca es un impedimento, y eso está sostenido donde no se puede romper por accidente.** Cuatro cosas:

- `laboratorio_entregar` **no mira** la columna de revisiones. Ni las exige, ni las cuenta, ni cambia de
  mensaje. La función que paga los puntos no sabe que existen.
- El botón no deshabilita la caja ni el de entregar.
- Si el modelo falla, se cae o tarda, el servidor responde **200 con `fallo`** —no un error— y la caja
  muestra un aviso gris. No hay camino en que una falla del modelo impida entregar.
- El vocabulario no reprueba, y ni el peor veredicto usa rojo. Un rojo de error diría «esto está mal»
  sobre algo que solo sugiere, y sería un impedimento psicológico aunque técnicamente no bloquee nada.

Se puede pedir **después de entregar**. Entregar cierra la edición, no el aprendizaje: es la única
retroalimentación que ese alumno va a recibir sobre lo que escribió. Por eso
`laboratorio_revisar_guardar` no comprueba `entregado_en`, a diferencia de `laboratorio_guardar`.

#### Qué se le manda al modelo

**El laboratorio completo**, no el enunciado de la caja sola. No es derroche: la caja 1.5 de L1 pregunta
por qué apareció una línea en la terminal donde corre `libros.mjs`, y para juzgar eso hay que haber visto
el bloque de código de ese microservicio y el `fetch` al 3001 que están unos párrafos antes. Van también
**las otras respuestas del propio alumno**, porque la caja 3.1 dice «responde de nuevo la pregunta del
principio, y si cambiaste de opinión dilo»: sin ver la 0.1, eso no se puede validar.

El enunciado entero de L1 son unos **11.400 tokens**, así que revisar sus 21 cajas para 30 alumnos cuesta
del orden de **medio dólar**. L0 sale en once centavos. No hay nada que optimizar.

#### Nada de reglas deterministas

Acá no hay un `if` que compruebe que la respuesta «empiece con `HTTP/1.1`». El juicio **es** el criterio,
y una regla lo empobrece: con el laboratorio entero en contexto el modelo puede hacer algo que ninguna
regla puede, que es ver si lo que el alumno pegó corresponde a **ese** paso y no a otro. Lo único
determinista es el esquema de salida, que es forma y no contenido.

A cambio, el modelo se equivoca de vez en cuando. Por eso el veredicto es una sugerencia que no toca los
puntos: es lo que hace que equivocarse salga barato.

#### El mensaje no da la respuesta

Es la regla que sostiene todo lo demás, porque si el modelo explica el concepto el alumno puede escribir
de vuelta lo que le acaban de decir. La instrucción le permite tres cosas —nombrar dónde volver a mirar,
señalar una contradicción sin corregirla, hacer una pregunta— y le **prohíbe afirmar un hecho técnico
sobre el tema de la caja, aunque sea para corregirlo**.

Eso costó dos vueltas. La primera versión decía «nunca le des la respuesta» y el modelo la soplaba
entera en cuatro de siete casos: «base64 no es cifrado, solo codifica; la firma da integridad, no
secreto». Lo que funcionó fue el ejemplo de lo prohibido junto al de lo permitido, incluyendo el caso
tramposo —corregirlo *es* dársela—. En la misma vuelta salieron dos cosas más: el modelo escribía en
voseo argentino («revisá», «mirá») y una vez trató al alumno de **«weón»**. Las tres están ahora en la
instrucción y las tres se comprueban en cada mensaje de la prueba.

### Probarlo

```bash
node neon/probar-compilador.mjs                                          # el Markdown
set -a; . ./.env.local; set +a
node neon/probar-revision.mjs --codigo L1                                  # el criterio de la IA
node neon/probar-laboratorio.mjs --codigo L1                              # la lógica
node neon/probar-plazo.mjs                                                 # el plazo de los puntos
node neon/probar-laboratorio-navegador.mjs https://pulso-rust.vercel.app  # el navegador
```

**El criterio** llama al modelo de verdad —no hay forma de probar un juicio sin el que juzga— pero no
escribe nada. No vigila que acierte siempre, porque no lo va a hacer: vigila lo que sí tiene que ser
cierto todas las veces. Que una respuesta en blanco o disparatada **no salga «logrado»**, que una buena
no salga «incompleto», que el mensaje **no sople la respuesta**, y que el contexto traiga de verdad el
laboratorio completo con la caja marcada en su lugar. Con `--caja 2.5` prueba una sola, para iterar la
instrucción sin pagar las demás.

Una lección de esa prueba: su primera versión revisaba los soplones en **un** caso de muestra y dio
«todo bien» mientras el modelo soplaba en cuatro de siete. Pasó por la razón equivocada. Ahora la
revisión corre sobre todos los mensajes — y la del soplón solo cuando el alumno **no** dio con la
respuesta, porque si ya la escribió él, repetírsela no le enseña nada.

**El compilador** no toca la base ni necesita `.env.local`: compila texto y mira lo que sale. Su
criterio no es «compila», es **«se queja de lo que tiene que quejarse»**: cada caso de la tabla de
arriba es una prueba que exige el rechazo. Después compila los laboratorios de verdad de
`../Desarrollo_Cloud_Native/Laboratorios/`, que es la red de seguridad para no rechazar de más.

**La lógica** llama a las mismas funciones de Postgres que llama `/api/laboratorio`, con la misma
identidad y el mismo rol con RLS. Entre otras cosas comprueba la garantía del párrafo de arriba: que con
las 21 sugerencias en «incompleto» la entrega dé exactamente lo mismo, que seguir escribiendo no las
borre, y que se pueda pedir una después de entregar. Además del camino feliz comprueba lo que duele: que no se entregue
en blanco, que no se pueda seguir escribiendo después de entregar, que no se entregue dos veces —serían
puntos duplicados— y que no se vea el laboratorio de otra matrícula. Y revisa el enunciado **ya
guardado**: que no queden `:::` sueltos, que los formatos y las clases sean de los que el navegador
dibuja, que los controles vayan correlativos y que las columnas `cajas` y `controles` calcen con los
bloques —de ahí salen la barra de progreso y el conteo del panel del docente—.

**El plazo** descubre solo con qué probar —el laboratorio opcional de la asignatura y el oficial que
requiere— y recorre los dos lados de la ventana. Lo que vigila de verdad no es que fuera de plazo no
pague, que es lo fácil, sino las cuatro cosas que se rompen solas si alguien toca esto: que la entrega
atrasada **quede registrada**, que **desbloquee el desafío opcional** igual, que lo que devuelve la
función sea lo que se pagó de verdad, y que **antes** de `puntua_desde` tampoco pague. Deja las fechas
como estaban y al alumno de prueba limpio.

**El navegador** cubre lo único que la anterior no puede: que el guardado automático de verdad viaje.
Es la parte donde una falla silenciosa le cuesta al alumno dos horas —escribe, se ve bien, y no salió
nada—. Escribe, espera, y va a mirar la fila en Postgres; después escribe en otra caja y se sale de la
pantalla de inmediato, que es la ventana donde se pierde texto.

De ahí salieron los dos errores que tenía esto: que `trim()` en Postgres quita **solo espacios**, así
que una caja con un Enter contaba como respondida y dejaba entregar en blanco; y que el `.trim()` de
JavaScript sí lo considera vacío, así que la cuenta del docente y la del alumno no coincidían. Las dos
salen ahora de `tiene_texto()`.

## Gacha y cosméticos

El pase reparte **tiradas**; el gacha es donde se gastan. Cada tirada entrega un cosmético: un
**título** que se muestra bajo el nombre, o una **cara** para el perfil.

### El sorteo es en dos pasos

Primero se sortea **la rareza** con los pesos de `gacha_rarezas`, y después se elige **uniforme entre
los cosméticos de esa rareza** que al alumno le faltan.

| Rareza | Peso | Qué hay |
|---|---|---|
| Común | 30 % | 7 títulos + **todas las imágenes** |
| Poco común | 28 % | 17 títulos |
| Rara | 25 % | 28 títulos |
| Épica | 12 % | 29 títulos |
| Legendaria | 4 % | 15 títulos |
| Mítica | 1 % | 4 títulos |

La alternativa —un peso por ítem y un solo sorteo— parece más simple y está mal: con 220 imágenes
comunes y 4 títulos míticos, el mítico saldría **una vez cada dos mil tiradas** y no lo vería nadie en
todo el semestre. Con dos pasos es exactamente 1 de cada 100, y sigue siéndolo cuando se suban más
imágenes.

Y de paso resuelve lo de las imágenes: como dentro de una rareza el sorteo es uniforme, **las 220
tienen exactamente la misma probabilidad entre sí**, hoy y cuando sean 400.

**Sin repetidos.** Se sortea solo entre lo que falta, y la rareza solo entre las que todavía tienen
algo — si no, al que ya tiene los cuatro míticos le saldría «rareza mítica» un 1 % de las veces y no
habría nada que entregarle. La tirada se gasta **después** de que hay algo que dar.

### La cara ya no se elige: se gana

Antes el alumno abría una galería de DiceBear, elegía un dibujo y la app escribía `perfiles.avatar`
por la Data API. Eso se acabó, y se cerró donde no se puede rodear: **un grant por columna**.

```sql
revoke update on public.perfiles from pulso_app;
grant  update (nombre) on public.perfiles to pulso_app;
```

No es una validación del cliente ni una pantalla escondida: `pulso_app` **no puede escribir esa
columna**. El único camino es `equipar_cosmetico`, que es `security definer` y comprueba que se haya
ganado. Es el mismo mecanismo con que `clases.archivo` y `clases.pauta` quedan fuera del alcance de la
API.

Dos detalles que valen la pena:

- **Las caras se ganan por matrícula pero se usan en todas.** El avatar vive en `perfiles` —es la cara
  de la persona— así que basta con haberla ganado en cualquiera de sus ramos: sería absurdo que la que
  se ganó en Cloud Native no la pueda usar en Arquitectura. Los títulos sí son por ramo, que es lo
  correcto: hablan de lo que hizo en ese curso.
- **A quien tenía un DiceBear no se le quita.** Su avatar sigue dibujándose hasta que gane una imagen.
  Quitárselo de golpe lo dejaría con un cuadro vacío, que es un castigo por haber llegado temprano.

Los doce «avatares» que existían antes eran **estilos de DiceBear** —el cosmético desbloqueaba
`bigSmile` y el dibujo lo generaba el navegador—. Al subir la colección quedan `activo = false`: no se
borran, porque hay alumnos que ya se los ganaron y `alumno_cosmeticos` apunta al id.

### Lo del pase no sale en el gacha

Un cosmético que es recompensa del pase **no entra al pozo**. Eso no se marca con una columna
`exclusivo` que alguien tenga que acordarse de poner: se deriva de `pase_recompensas`. Asignarlo a un
nivel **es** hacerlo exclusivo, y quitarlo de ahí lo devuelve al pozo. Una columna aparte podría quedar
en desacuerdo con la realidad —marcada exclusiva y sin nivel, o al revés— y ese desacuerdo no falla en
ninguna parte: simplemente un premio del pase empieza a salir tirando y deja de ser un premio.

El reparto lo hace `neon/repartir-pase.mjs`. Hoy son **30 frases y 30 imágenes** exclusivas —de 108 y
220— más los 3 marcos, que quedan solo en el pase.

```bash
set -a; . ./.env.local; set +a
node neon/repartir-pase.mjs              # informa y no toca nada
node neon/repartir-pase.mjs --escribir
```

**Al azar, pero siempre el mismo azar.** La elección se ve aleatoria y no cambia entre corridas: el
sorteo va con una semilla derivada del id del pase y del nivel. Importa porque esto se corre cada vez
que se suben cosméticos nuevos, y con azar de verdad cada corrida reordenaría la escalera: un alumno
vería cambiar el premio del nivel 19, y peor, la exclusividad se movería de un cosmético a otro y
devolvería al gacha algo que alguien ya ganó como premio del pase.

**El pase llega hasta legendaria, no hasta mítica.** Los cuatro títulos míticos se quedan solo en el
gacha. El pase es el camino garantizado —se llega al 30 trabajando— y si además diera lo más raro del
pozo, el 1% del gacha dejaría de significar algo. Lo garantizado sube hasta legendaria; lo mítico sigue
siendo suerte.

En la colección los del pase se ven igual, con borde punteado y la etiqueta del nivel en que tocan. Y
hay un filtro **«Puedo sacarlo»** que deja solo lo que de verdad puede salir de una tirada: sin eso, un
alumno puede quedarse tirando semanas esperando algo que el gacha no entrega.

### Ni el pase ni el gacha pagan puntos

Los puntos son de las actividades y se gastan en la tienda. El pase reparte XP, niveles, cosméticos y
tiradas; el gacha reparte cosméticos. Son dos economías y mezclarlas le quita sentido a las dos.

Había una mentira concreta: `mi_pase` devolvía `puntos_por_sobrante` —«lo que sigas ganando se
convierte en puntos: llevas N»— y **nadie los pagaba nunca**. No hay un solo `insert` sobre
`movimientos_puntos` en toda la lógica del pase. El alumno llegaba al nivel 30, la pantalla le prometía
puntos, y su saldo no se movía. Se fue eso y también la columna `xp_por_punto`, que era la tasa de una
conversión que no existe: dejarla puesta es dejar la trampa para que alguien vuelva a creerle.

El sobrante se sigue informando, porque es cierto y se ve en la barra. Lo que se quitó es la promesa.

### Subirlos

```bash
set -a; . ./.env.local; set +a
node neon/subir-cosmeticos.mjs --titulos ~/Downloads/titulos_perfil_rareza.txt \
  --avatares ~/Downloads/iconos_pulso              # valida e informa
node neon/subir-cosmeticos.mjs --titulos … --avatares … --escribir
```

Es idempotente: el `codigo` es estable —derivado del nombre del archivo o del número del título— así
que volver a correrlo actualiza en vez de duplicar y **no le quita a nadie lo que ya se ganó**. Las
imágenes que ya están en Blob no se vuelven a subir; se comparan por tamaño.

**Las imágenes van a Vercel Blob, no a `public/`.** Este repositorio es público y son personajes de
series con derechos: en `public/` quedarían publicadas a nombre del repositorio e indexables, que es
el mismo problema que ya se resolvió con los decks. Viven en el store **`pulso-cosmeticos`**, que es
público —un `<img>` tiene que poder leerlas sin token— y separado de `pulso-clases`, que es privado.

Ese segundo store se autoriza con **`COSMETICOS_STORE_ID` y el token OIDC**, no con una llave de
escritura: el OIDC dura poco y se renueva solo, así que no queda un secreto de larga vida en el disco.
Para que funcione, la conexión del store en Vercel tiene que cubrir **All Environments** — si deja
fuera *development*, el cargador falla con «OIDC is enabled for this project, but not for the
development environment». Y el prefijo de la conexión tiene que ser `COSMETICOS`: con el `BLOB` por
omisión choca con el token de los decks y Vercel no deja conectarla.

### Probarlo

```bash
set -a; . ./.env.local; set +a
node neon/probar-gacha.mjs [--tiradas 4000]
```

Un gacha es una promesa numérica: si la pantalla dice que un mítico sale 1 de cada 100 y en realidad
sale 1 de cada 2.000, eso **no falla en ninguna parte** —los alumnos simplemente nunca ven uno y nadie
sabe por qué—. Por eso el grueso de la prueba es contar: tira unos miles y compara la frecuencia
observada contra los pesos declarados.

Lo otro que vigila es la puerta: que `pulso_app` **no tenga** grant de `update` sobre `perfiles.avatar`
y sí sobre `nombre`, y que un `update` directo lo rechace Postgres. Se comprueba el grant y no que la
pantalla esconda el botón, porque el botón no es lo que lo impide.

## Modo reunión

Hay bloques en que el profesor está en reunión y no puede atender consultas. Antes eso se avisaba de
viva voz o no se avisaba, y el alumno lo descubría levantando la mano. Ahora se declara: en
**Curso** hay un botón por sección, y al encenderlo pasan dos cosas a la vez.

- A los alumnos **de esa sección** les aparece en la barra lateral que estás en reunión, con un aviso
  de que ahora no puedes atender.
- Su **tienda queda con 30% de descuento** mientras dure, como compensación por la hora en que no
  van a poder preguntarte.

No apaga nada más: ni las clases, ni las misiones, ni los laboratorios. Es un aviso más un descuento.
La parte de «no hagan ruido» la sostiene la sala, no el software — bloquear pantallas castigaría justo
a quien quiere seguir trabajando solo.

### Por sección, no por asignatura

Una reunión ocurre en un bloque, y en un bloque hay **una** sección en sala. El resto de las secciones
de la misma asignatura está en su casa o en otro horario, así que regalarles el descuento no tendría
nada que ver con lo que les pasa. La sección ya determina la asignatura y el periodo, así que
`seccion_id` alcanza para las dos cosas.

### El descuento se guarda en la reunión

`descuento` es una columna de la fila y no una constante del código. Si el número cambia el semestre
que viene, las reuniones de este semestre siguen diciendo lo que de verdad se cobró: un canje viejo
tiene que poder explicarse con lo que había ese día.

Por lo mismo, el movimiento de puntos anota el descuento en su motivo. Sin eso, el alumno mira «Mis
puntos» un mes después, ve que algo de 200 le costó 140, y no hay nada que lo explique.

### Dónde vive el precio

En dos lados, y hay que saber por qué:

| Dónde | Qué hace |
|---|---|
| `public.precio_con_descuento` | El precio que **se cobra**. Es la autoridad, y la usa `solicitar_canje` |
| `precioConDescuento` en `datos.service.ts` | El precio que **se muestra** en la tienda |

La pantalla no puede ser la autoridad, pero tampoco puede pedirle el número a la base: `vitrina` se
lee por la Data API, y agregarle una columna la dejaría sin precios mientras PostgREST no refresque su
caché del esquema —medido acá, entre veinte segundos y más de quince minutos—. Así que la fórmula está
escrita dos veces, y `neon/probar-reunion.mjs` **compara las dos** sobre un rango de precios para que
no se separen sin que nadie se entere.

Redondea hacia abajo, a favor del alumno, y nunca baja de un punto: un artículo gratis por redondeo no
es un descuento, es un error.

### Probarlo

```bash
set -a; . ./.env.local; set +a
node neon/probar-reunion.mjs                                            # la lógica
node neon/probar-reunion-navegador.mjs https://pulso-rust.vercel.app     # el navegador
```

Un descuento toca el saldo de los alumnos, así que lo que se vigila no es cosmético: que el descuento
**no se escape de la sección**; que se cobre lo que dice la pantalla; que encender dos veces no deje
dos reuniones abiertas —«terminar» cerraría una sola y la sección se quedaría con el descuento puesto—;
y sobre todo que **la devolución devuelva lo pagado y no el precio de lista**, porque canjear con
descuento y cancelar sin él sería una máquina de fabricar puntos que nadie notaría hasta que un alumno
tuviera el doble que el resto.

### El techo de doce funciones

Esto tuvo su propio `api/reunion.mjs` un rato, hasta que el despliegue empezó a fallar **sin decir
nada**: el build compilaba y moría en «Deploying outputs…». El plan Hobby admite **doce funciones
serverless** y ese archivo era la trece.

No hay error legible, así que queda escrito: **antes de agregar un archivo a `api/`, cuenta los que
hay.** Las cuatro acciones del modo reunión viven en `/api/docente`, que ya tenía la tabla de despacho,
y ese endpoint declara ahora con `ABIERTAS` quién puede llamar a cada cosa —`reunion-ver` la llama el
alumno y es la única que no exige ser docente—. Es una lista de lo permitido y no de lo prohibido, así
que una acción nueva queda protegida por omisión.

### Lo que falta

**Nada la cierra sola.** Si te olvidas de apretar «Terminar reunión», esa sección se queda con el 30%
puesto indefinidamente. El panel muestra cuántos minutos lleva encendida y lo dice en la tarjeta, pero
es un aviso, no un límite.

## Agregar una asignatura o un semestre

El desplegable del registro se llena desde la base, así que no hay que tocar código. El SQL, con el
periodo y la asignación al docente, está en [`supabase/README.md`](supabase/README.md).

Para dar de baja una sección o una asignatura, `activa = false`; para cerrar un semestre,
`periodos.activo = false`. Dejan de aparecer en el registro sin romper las matrículas que ya existen.

## Desarrollo

```bash
npm install
npm start          # http://localhost:4200
npm run build
```

## Desplegar

**Se despliega con `git push`.** El proyecto tiene la integración de Git de Vercel: cada push a `main`
construye y publica en producción solo.

> **No uses `npx vercel deploy --prod`. Pasó dos veces.** El 11 y el 16 de agosto de 2026 produjo un
> despliegue que respondía **404 en todas las rutas** —incluida la raíz— pese a que el build en Vercel
> terminó bien y el estado quedó en `Ready`; además se llevó el alias de producción y tumbó el sitio
> hasta promover a mano el anterior. La diferencia está en el log: el bueno dice `Cloning
> github.com/Umbingelelo/pulso`, el roto dice `Downloading 204 deployment files`. Mismo commit, mismo
> build, distinto resultado. Si vuelve a pasar:
>
> ```bash
> npx vercel ls pulso                    # busca el despliegue bueno
> npx vercel promote <url-del-bueno>     # devuélvele el alias
> ```

No hay archivo de configuración en `src/`: la app llega a la base por `/db`, que `vercel.json` reescribe
a la Data API de Neon, y la sesión la manejan las funciones de `api/auth/`. Los secretos están en las
variables de entorno del proyecto en Vercel y, para desarrollo, en `.env.local`, que no se versiona.

## Rutas

| Ruta | Quién entra |
|---|---|
| `/registro`, `/ingresar` | Solo sin sesión |
| `/inicio`, `/clases`, `/actividades`, `/laboratorio/:codigo`, `/diagnostico`, `/ramos`, `/perfil`, `/puntos`, `/tienda` | Alumnos |
| `/curso`, `/curso/clases`, `/curso/actividades`, `/curso/alumnos` | Docentes |
| `/ficha/:matriculaId` | Los dos: el alumno la suya, el docente las de sus secciones |

Y fuera de Angular, servidas por funciones:

| Ruta | Qué hace |
|---|---|
| `/api/auth/*` | Ingreso, registro, refresco y cierre de sesión |
| `/api/clase?id=…` | Sirve el deck de una clase, tras comprobar sesión y matrícula |
| `/api/clase-avance` | Recibe el avance dentro del deck y paga los puntos |
| `/api/laboratorio` | Leer, guardar y entregar un laboratorio |
| `/api/docente` | Las operaciones del panel del docente |
| `/.well-known/jwks.json` | La llave pública con la que Neon valida los tokens |
| `/db/*` | Reescritura a la Data API de Neon |
