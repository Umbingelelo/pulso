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
- **Puntos para evaluaciones**: las décimas se compran al instante, se guardan en el perfil y se usan
  cuando el alumno quiera; el docente marca el uso como aplicado al poner la nota. Cada compra
  encarece la siguiente. Ver [Puntos para evaluaciones](#puntos-para-evaluaciones)
- **Vista de docente**: se elige la asignatura y el periodo, y desde ahí la nómina por sección, los
  promedios del diagnóstico, la bandeja de canjes por resolver, y otorgar o descontar puntos —en
  «Resumen» y también en «Alumnos», que es donde se busca: es la pantalla que lleva el nombre y que
  muestra la columna de puntos
- **Pase de batalla por parcial**: un pase por evaluación, con su escalera de 30 niveles, y un ranking
  por sección que cuenta solo el XP del parcial, así que se reinicia con cada uno. Ver
  [Pase y ranking](#pase-y-ranking)
- **Gacha con bolsas de puntos**: una de cada cuatro tiradas entrega puntos en vez de un cosmético
- **Avisos por correo**: una vez al día, lo que espera al docente —canjes, décimas por aplicar,
  reuniones que quedaron encendidas—. Ver [Avisos por correo](#avisos-por-correo)
- **Misión diaria variada**: cinco mecánicas —emparejar, verdadero o falso, completar un diagrama,
  alternativas y desarrollo— sorteadas por alumno y por día, con tope de tokens. Ver
  [Misión diaria](#misión-diaria)
- **Ruleta de nota dentro de Pulso**: el docente la tira desde la bandeja de canjes y el servidor
  sortea. Ver [Ruleta de nota](#ruleta-de-nota)
- **Modo oscuro**, que sigue al sistema hasta que se elige. Ver [Modo oscuro](#modo-oscuro)

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
- **Décimas**: `usos_decimas` tampoco tiene políticas de escritura. `usar_decimas` comprueba el saldo
  con la matrícula bloqueada, y solo el docente de la sección puede marcar un uso aplicado o
  rechazado (`resolver_uso_decimas`).
- **Ficha**: una sola función para el alumno y para el docente, y la autorización se decide adentro.
  Cambiar el id de la matrícula en la URL no abre la ficha de nadie más.
- **Clases**: el deck vive en un store de Blob **privado**, y su ruta está en `clases.archivo`, una
  columna sobre la que `pulso_app` **no tiene grant**. La pauta de sus quiz, en `clases.pauta`,
  tampoco. Son grants por columna: la tabla se lee, esas dos no. El único camino al archivo es
  `/api/clase`, que exige cookie de sesión y matrícula vigente. `progreso_clase` no tiene políticas de
  `insert` ni `update`: todo pasa por `abrir_clase()` y `progreso_clase_guardar()`, que son las que
  corrigen y pagan.
- **Laboratorios**: la pauta de cada caja vive en `laboratorios.pautas`, y la tabla `laboratorios` no
  tiene política de lectura para `pulso_app`: se lee por `mi_laboratorio()`, que **no selecciona esa
  columna**. El único camino a la pauta es `laboratorio_pauta()`, que se niega a contestarle a quien
  llega con token de navegador y solo responde por la vía del servidor. Detalle en *La pauta*, más abajo.
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

**Ojo con los puntos por omisión: son 5/10/20**, los de un arranque corto como el L3A. Una clase de
materia o un pre-laboratorio con contenido va con `--abrir 25 --terminar 55`. El L7A de Cloud Native se
subió sin ellos, 28 alumnos la abrieron pagando 5, y hubo que abonar la diferencia a mano.

`--experiencia N` la pone en el grupo de la EA*N* en la pantalla de Clases. Ver *Experiencias*, abajo.

La ruta en Blob lleva el hash del contenido —`clases/DSY1107/2026-2/D7-9a0e638656c9.html`— y
`clases.archivo` apunta a la última. El CDN guarda cada ruta un año y sobrescribirla no lo invalida a
tiempo: el D7 de Cloud Native se resubió con 29 diapositivas y `/api/clase` siguió entregando la versión
vieja. Con el hash, corregir un deck es volver a correr el script; la ruta vieja queda huérfana y nadie
la lee.

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

Esos tres números son **por clase**, y hay que mirarlos cuando el deck no es una sesión de materia. El
primero que no lo fue es **L3A**, el arranque del laboratorio L3: cinco diapositivas, sin un solo quiz,
quince minutos proyectados antes de repartir la guía. Con los 25/10/55 del resto habría pagado 80
puntos por cuarenta segundos de recorrido, más que el diagnóstico completo. Va con 5/0/15. El mínimo de
tiempo sí se deja en la fórmula de siempre —8 segundos por diapositiva— porque tener dos criterios de
«¿ya la vio?» conviviendo es exactamente lo que el comentario de `subir-clase.mjs` pide no hacer.

Pero lo que decide no es la etiqueta: es la densidad. El **L3A de ITY1102** también es un pre-laboratorio
y va con 25/0/55, como una clase de materia, porque son 19 diapositivas y treinta y cinco minutos de
clase de verdad —el diagrama que sale de ahí es una figura del informe de EP1—. Es lo mismo que paga
`D6` de Cloud Native, que son 20 diapositivas y tampoco tiene un quiz. Antes de elegir los tres números
hay que abrir el deck y contar diapositivas, no leer el nombre de la carpeta.

El `0` del tramo del medio no es un castigo: es el único valor honesto. `subir-clase.mjs` solo saca pauta
de `data-widget="quiz"` con `data-correcta`, y los widgets que se autocorrigen en el navegador
—`clasificar`, `completar`, `emparejar`— no escriben en `estado.respuestas` ni llegan al servidor. El L3A
de ITY1102 tiene tres de ésos y cero quiz, así que `actividades` queda en 0 y dejar `--actividad 10`
sería prometer puntos que ninguna diapositiva puede pagar.

Un deck de arranque se registra como cualquier clase, con el código del laboratorio y una letra:
`--codigo L3A --orden 5`. La vista ordena por `orden` y después por `codigo`, y el `orden` que se elige
es el que lo deja en su lugar del calendario sin renumerar nada. En Cloud Native eso es el `orden` de la
clase de materia de esa semana —`D4` el lunes, `L3A` el martes, y `D4` gana por código—. En ITY1102 la
semana viene al revés: el pre-lab es el martes y `D4` el jueves, así que va con el `orden` de `D3`, el
jueves anterior, y queda `D3 → L3A → D4`. Con el de `D4` habría aparecido después de una clase que
todavía no se ha dado.

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

### En el celular

El deck se autora en un escenario fijo de 1920x1080 y se encoge entero con
`min(ancho/1920, alto/1080)`. En un teléfono en vertical manda el ancho, y 390 px dan un factor de
0,20: el cuerpo de texto, que son 31 px, sale a **6 px**, y en las diapositivas densas —que lo
escriben en 22 px— a **4,5 px**. Y hay algo peor que el tamaño: el deck solo se navega con el teclado
—no hay un solo `touchstart` en la plantilla—, así que en un teléfono no se podía pasar de la primera
diapositiva.

`lib/movil-clase.mjs` se inyecta junto al rastreo, por la misma vía y con el mismo criterio de no
tocar los decks. Hace dos cosas:

- **Gira el escenario** noventa grados cuando el teléfono está en vertical. El factor pasa a
  `min(ancho/1080, alto/1920)` — 0,36, **1,78 veces más**. Es más de lo que da el teléfono acostado
  (0,31), porque en horizontal la barra del navegador se come el alto que hacía falta. Quien tenga el
  giro bloqueado gana todo: voltea el aparato y lee. Quien no, ve el texto de lado un segundo,
  voltea, y el deck se dibuja solo con su propio escalado.
- **Deslizar y dos botones**, que es lo que arregla lo que de verdad estaba roto. Despacha la misma
  flecha que mandaría un teclado en vez de llamar a `avanzar()`: es la interfaz que el deck documenta
  en su tabla de ayuda, y por ahí el revelado por pasos y los widgets siguen funcionando igual.

El giro va con `!important` desde una hoja de estilos y no escribiendo la transformación en línea:
`escalar()` está suscrito a `resize` y reescribe `escenario.style.transform` cada vez que la ventana
cambia, así que una transformación en línea nuestra duraría hasta el primer giro del teléfono.

Girado el escenario, el HUD del deck se esconde: sus cinco piezas son el cronómetro del docente, el
contador, el botón de modo —que ya viene forzado—, las notas de orador, que se abren en una ventana
emergente que el teléfono bloquea, y una tabla de atajos de un teclado que no existe. El contador se
devuelve aparte, en una esquina que sí se lee.

**Ocho píxeles siguen siendo poco.** El 1,78 es una constante de la geometría, así que la portada
sube de 6,3 a 11,2 px pero las diapositivas densas —código, tablas, quiz, que son justo las que uno
repasa— van de 4,5 a **7,9 px**. Eso es legible con el teléfono volteado, y era imposible antes, pero
no es cómodo. El techo lo pone el letterbox: los 1080 px del alto del escenario tienen que caber en
los 390 del ancho del teléfono, y ninguna transformación arregla eso.

Subirlo de verdad pide remaquetar en vez de escalar —soltar el escenario de los 1920 px, apilar las
diapositivas y reescribir la escala tipográfica—, y eso rompe los diagramas y las rejillas hechas a
mano de varios decks. Antes de meterse ahí, mirar las capturas que deja `probar-clase-movil.mjs`.

### Llevárselo

El botón **Descargar** de cada tarjeta entrega `/api/clase?id=…&descargar=1`: el mismo archivo como
adjunto, sin el rastreo —una copia en el teléfono no tiene cookie ni tiene a quién llamar— y en modo
estudio, que importa porque con `data-modo="clase"` el deck esconde los `.solo-estudio` («Ver
respuesta explicada»). No abre ninguna puerta nueva: el deck es un HTML autocontenido y un Ctrl+S ya
hacía esto.

Va por `descargar_clase()` y no por `abrir_clase()`, que además de autorizar **escribe**: bajarse el
deck no cuenta como haberlo abierto ni paga puntos. Si pagara, bajar los 18 decks de un ramo de una
sentada pagaría por no haber leído ninguno, y cada tarjeta quedaría para siempre en «En curso · vas en
la diapositiva 1 de 38». Las dos funciones preguntan a los mismos helpers de la 0007, así que hay una
sola definición de quién puede ver qué. Ver la migración 0034.

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
node neon/probar-clase-movil.mjs       # 5. el teléfono: que se lea y se pueda avanzar
```

**La 5 no necesita nada de lo anterior** —ni base, ni red, ni desplegar—: coge un deck de la carpeta
de la asignatura, le pega lo que `/api/clase` le pegaría al pasar y lo sirve desde un servidor local.
Es la única que se puede correr mientras se pelea con una transformación CSS. Acepta `--archivo`.

**1. La lógica.** Abrir, reabrir sin cobrar, fallar, acertar, reenviar sin cobrar, mandar basura,
intentar terminar antes del mínimo, terminar de verdad. Y que `mis_clases` no exponga `archivo` ni
`pauta`, y que `pulso_app` reciba `permission denied` al intentar leer esas dos columnas. Acepta
`--sigla` y `--codigo`.

Las diapositivas por las que pasa salen del deck que se le apunte, y los pasos que corrigen respuestas
se saltan cuando no hay quiz. Antes iban escritas a mano —la 3, la 5 y la 6— y eso ataba la prueba a un
deck largo con quiz: contra L3A, que tiene cinco diapositivas y ninguno, dejaba `slide_max` en 6 y
después se quejaba de un avance imposible, «vas en la 7 de 5». Tres fallos que no eran de la clase sino
de la prueba, que es la peor clase de fallo que puede dar una prueba.

**2. El cable.** Lo mismo pero contra producción: sin sesión no se abre, con cookie llega el deck
completo, el `ETag` devuelve `304` sin reenviar 750 KB, y la ruta del blob no aparece en el HTML. Y la
descarga: que salga como adjunto, sin rastreo y en modo estudio, y que **no** anote progreso ni pague
—para eso borra la fila de progreso antes, porque con la del paso 3 puesta no se distinguiría una
descarga que no anota de una que anota sobre lo ya anotado—.

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

**5. El teléfono.** En un iPhone emulado de 390x750: que el escenario gire y quepa entero, que el
texto crezca 1,78 veces —medido en la diapositiva **más densa** del deck, no en la portada, que es
donde todo se ve bien—, que los botones midan lo que mide un dedo, y que se avance tanto con
ellos como deslizando —hacia arriba girado, hacia la izquierda acostado, y nada con un deslizamiento
torcido—. Comprueba también que la copia descargable no traiga el rastreo y sí arranque en modo
estudio. El primer paso mide el deck **sin nada** encima: si esa referencia dejara de salir ilegible,
la prueba estaría aprobando sin probar.

Y deja capturas en `/tmp/pulso-movil/` —la portada antes y después, acostado, y las tres diapositivas
más densas del deck con todos sus pasos revelados—. Están para mirarlas: si una tabla o un diagrama se
rompe al girar, ningún número lo va a decir.

**Esa cuenta se mantiene a propósito** y está matriculada en DSY1107 001D y en ITY1102 001D. Aparece en
la nómina del docente, que es el precio de tenerla: si molesta, `matriculas.activa = false` la saca de
los promedios pero también la deja fuera de la prueba.

## Laboratorios

Un laboratorio es una actividad de tipo `laboratorio` con cuerpo: el enunciado, las cajas donde el
alumno escribe y los puntos de control que tú validas en sala. Se escriben en Markdown en la carpeta
de la asignatura y se publican con un script.

### El formato

Encabezado con `codigo`, `titulo`, `descripcion`, `minutos`, `puntos`, `orden` y —si tiene plazo—
`desde` y `hasta`, y después el enunciado con seis bloques propios, todos cerrados con `:::`:

| Bloque | Para qué |
|---|---|
| `:::caja{1.2 corta}` | Donde el alumno responde. `corta` o `codigo` |
| `:::pauta{1.2}` | La respuesta correcta de esa caja. **El alumno no la ve nunca**: es para el modelo |
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
| `:::nota`, `:::pists` | Sólo existen las seis de la tabla de arriba |
| `:::caja {1.2}`, `  :::caja{1.2}` | Espacio antes de la llave o indentación: la caja se perdía |
| Una caja o un aviso dentro de otro | Los bloques no se anidan; el de afuera cerraba donde no era |
| `:::caja{1.2 larga}` | Los formatos son `corta` y `codigo`, que son los que el navegador dibuja |
| Un identificador repetido o ausente | Es la llave de la respuesta |
| Controles `1, 3` o `1, 1` | El avance es **un** número: con un salto el alumno nunca llega al último |
| `puntos: 100 pts`, `descripción:` | Publicaba con cero puntos, o con la descripción en el suelo |
| `:::pauta{7.7}` sin caja 7.7 | La pauta quedaba guardada, nadie la leía, y esa caja se revisaba a ciegas |
| Dos `:::pauta{1.2}`, o una vacía | Una se comía a la otra, o no había criterio que mandar |

Y lo que va dentro de una cerca de ` ``` ` o `~~~` se respeta tal cual: ahí `:::caja{9.9}` es texto
que el alumno tiene que leer, no una caja.

### Publicarlo

```bash
set -a; . ./.env.local; set +a
node neon/subir-laboratorio.mjs --archivo ../Desarrollo_Cloud_Native/Laboratorios/L1-*.md \
  --sigla DSY1107 --periodo 2026-2            # valida e informa
node neon/subir-laboratorio.mjs --archivo … --escribir   # y ahora sí
```

Sin `--escribir` no toca nada: dice cuántos bloques, cuántas cajas y con qué identificadores quedó,
**en cuántas de ellas hay pauta y cuáles no la tienen**, o la lista completa de problemas con su línea. Vale la pena mirarlo, porque de ahí salió que un `split`
mal usado se estaba comiendo el 95% del enunciado sin quejarse.

El enunciado se convierte a HTML y se parte en bloques **al subirlo**, no en el navegador: así el
alumno no baja un intérprete de Markdown y, sobre todo, no hay que adivinar dónde va cada caja dentro
del texto ya convertido.

`experiencia: 2` en el encabezado lo pone en el grupo de la EA2 en la pantalla de Actividades.

### Experiencias

Clases y Actividades se muestran **agrupadas por experiencia de aprendizaje** —EA1, EA2, EA3, las del
programa—, cada una plegable, con la experiencia en curso abierta y las anteriores cerradas. Con dieciséis
semanas de material la lista plana obligaba a pasar por encima de toda la EP1 para llegar al laboratorio
de la semana.

Es una columna, `experiencia`, en `clases` y en `actividades`, y los nombres viven en `experiencias`
(0041). **No se deduce de las fechas del pase**: en ITY1102 la EA2 empieza el 15 de septiembre y el pase
2 el 28, y sus laboratorios no tienen plazo del que colgarse. Se escribe al subir; si no viene, volver a
subir conserva la que había, igual que el plazo. Nula = fuera de toda experiencia —el diagnóstico de
entrada—, y va primero bajo «Para empezar».

Un deck o un laboratorio nuevo que se suba **sin** experiencia cae en «Para empezar», arriba de todo.
No se pierde, pero se ve fuera de lugar: hay que pasarla siempre.

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

#### La pauta: la respuesta correcta, para el modelo y para nadie más

Cada caja puede traer un `:::pauta{1.2}` con lo que el docente considera una respuesta correcta. Con el
enunciado solo, el modelo tenía que reconstruir el criterio en cada llamada, y en las cajas
conceptuales —«¿por qué esa firma no sirve de nada?»— eso se nota: dos alumnos que escribieron lo mismo
podían salir con veredictos distintos. La pauta es el criterio escrito una vez, por quien hizo la guía.
También arregla el caso contrario, que era el más injusto: la caja que pregunta «¿cuánto te demoró?»
salía «incompleto» porque el modelo buscaba contenido técnico donde no hay ninguno.

**Y no llega al navegador por ningún camino.** Eso no es una promesa, son tres cosas:

- Vive en `laboratorios.pautas`, una columna que **`mi_laboratorio()` no selecciona**. Guardarla entre
  los bloques la habría hecho viajar con el enunciado —invisible en la pantalla, perfectamente legible
  en la pestaña de red—, que es literalmente el laboratorio con las respuestas adentro.
- La lee `laboratorio_pauta()`, que **se niega a contestarle a quien llega con token de navegador**. El
  navegador habla con la Data API llevando su JWT, así que `uid_del_token()` devuelve su uid;
  `/api/laboratorio` pone la identidad a mano con `pulso.usuario_id` y ahí es null. La función exige la
  segunda vía. Comprobado desde la consola del navegador con un token válido: `La pauta no se entrega
  por la Data API`, mientras `mi_laboratorio` en la misma línea responde 200.
- De `/api/laboratorio` **no sale**: entra a la instrucción del modelo y muere ahí. Lo que vuelve son
  el veredicto y el mensaje, los mismos dos campos de antes.

Tenerla adentro **empeora** el riesgo de que el modelo suelte la respuesta, porque ahora la tiene
escrita al lado. Por eso la prohibición aparece dos veces en la instrucción —una donde se entrega la
pauta y otra donde se explica cómo escribir el mensaje— y por eso `probar-revision.mjs` corre las
pruebas de soplo sobre las cajas conceptuales de L2, que son las que tienen pauta.

Se publica sin pauta perfectamente: así están L0, L1 y X1. El publicador dice en cada corrida cuántas
cajas quedaron sin una, porque una caja sin pauta se revisa con menos criterio que sus vecinas y eso no
se nota mirando la pantalla — el alumno recibe un veredicto igual de seguro.

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

## Misión diaria

El botón «Generar mi misión» arma la misión del día en el momento, una por alumno y por día (`unique
(matricula_id, fecha, tipo)`; el día cambia a las 23:59 de Santiago). Hasta la `0043` era siempre un quiz
de cuatro alternativas, y el docente lo dijo con todas sus letras: es monótono, y los alumnos ya
detectaron el patrón de que **la más larga es la correcta**. Ahora hay cinco mecánicas y se sortea una
por alumno y por día.

| Mecánica | Qué hace el alumno | Quién la escribe | Quién la corrige | Pago |
|---|---|---|---|---|
| `emparejar` | une 4 términos con sus 4 definiciones | **nadie**: salen tal cual del banco del docente | Postgres, determinista | 75 si las 4 |
| `verdadero_falso` | marca 4 afirmaciones | el modelo, solo con la definición | Postgres, determinista | 75 si las 4 |
| `diagrama` | completa el paso «?» de una cadena de 4 o 5 pasos | el modelo | Postgres, determinista | 75 |
| `quiz` | una pregunta, cuatro alternativas | el modelo | Postgres, determinista | 75 |
| `desarrollo` | responde en ≤ 600 caracteres con sus palabras | el modelo | **el modelo**, en el servidor | 75 / 37 / 0 |

Cada mecánica es un archivo de `lib/mecanicas/` con la misma forma —esquema, instrucción, validador y
armado— y se enchufa en el registro de `lib/misiones.mjs`. La corrección de las cuatro primeras es una
rama del `case` de `mision_responder()`, contra una pauta que nunca baja al navegador (`misiones.solucion`
no tiene grant para `pulso_app`; `mi_mision()` la entrega recién cuando la misión está resuelta). La
rama `quiz` no cambió ni una línea.

### La rotación

`elegirMecanica()` sortea con estos pesos y **nunca repite la mecánica de la misión anterior del alumno**:

| emparejar | verdadero_falso | diagrama | quiz | desarrollo |
|---|---|---|---|---|
| 25 | 20 | 20 | 20 | 15 |

Los pesos favorecen lo barato: `emparejar` no gasta tokens y es la más frecuente; `desarrollo` gasta dos
llamadas (redactar y corregir) y es la menos. Entran al sorteo solo las plantillas **activas**, así que
apagar una no necesita despliegue: `update mision_plantillas set activa = false where codigo = 'diagrama'`.
Lo que hoy no se puede hacer se descarta antes de sortear: sin `OPENROUTER_API_KEY` solo queda `emparejar`,
y sin cuatro pares compatibles en el banco no sale `emparejar`.

Si la mecánica sorteada falla —el proveedor no responde, o el modelo agota sus dos intentos sin pasar el
validador, o el concepto no se presta a un diagrama— se cae a `emparejar` (cuesta cero) y, si tampoco
alcanza, al quiz. Lo que se gastó en el intento fallido se **suma** a lo registrado: el costo de la misión
es lo que costó de verdad. El botón no devuelve error por culpa del modelo mientras haya un banco que
emparejar.

### Presupuesto de tokens

Medido contra el modelo real (`deepseek/deepseek-v4-flash`), con el contexto completo que arma
`/api/mision` (curso, clase en curso, perfil), una misión por llamada, ocho llamadas por mecánica:

| Mecánica | Tokens por misión | Costo (USD) | Tope de salida |
|---|---|---|---|
| `emparejar` | **0** | 0 | — |
| `verdadero_falso` | ≈ 625 | ≈ 0,00009 | 500 |
| `diagrama` | ≈ 610 | ≈ 0,00005 | 500 |
| `quiz` | 590 – 850 | ≈ 0,00005 | 450 |
| `desarrollo`: redactar | ≈ 665 | ≈ 0,00005 | 350 |
| `desarrollo`: corregir | 530 – 670 | ≈ 0,00003 – 0,00004 | 250 |

Con la rotación, la esperanza es de unos **550 tokens por misión** (≈ 0,00005 USD): treinta alumnos todos
los días del semestre cuestan centavos. Ojo con lo que esto **no** dice: el quiz de antes ya era barato, así
que la rotación no ahorra mucho respecto de «solo quiz». Lo que sí ahorra —y lo que importaba— es no
descontrolarse, y eso lo hacen tres cosas:

1. **Se apagó el razonamiento** (`reasoning: { enabled: false }` en `completar()` cuando la llama una misión).
   El modelo piensa o no según el proveedor al que OpenRouter lo enrute: en algunos piensa por omisión, y
   esos tokens se cobran como salida y cuentan contra `max_tokens`. Con el mismo prompt y tope de 500, **la
   mitad de las respuestas llegaban vacías** (`finish_reason: length`, 500 tokens de pensamiento y ningún
   JSON), y sin tope el pensamiento pasaba de 1.500 tokens para escribir 150. Con el razonamiento apagado,
   cuatro de cuatro. Los laboratorios (`revision-lab`) **no** lo usan: ahí sí puede importar pensar, y no
   se tocó.
2. **`max_tokens` por mecánica** (`completar({ maxTokens })`), con holgura sobre lo que cada una pesa.
3. **Prompt recortado**: el recorrido del alumno viaja con sus últimas 5 clases, no las 16, y el
   verdadero/falso, que se corrige contra la definición, va sin el contexto del curso.

Además `misiones.tokens` y `misiones.costo_usd` quedan escritos al registrar la misión (y `desarrollo` les
suma la corrección). `costo()` ahora usa el `usage.cost` que informa OpenRouter: las constantes de antes
daban 0,000045 contra 0,000069 cobrados. Sin grant para `pulso_app`; para mirarlo:

```sql
select p.codigo, count(*), round(avg(m.tokens)) tokens, round(sum(m.costo_usd), 4) usd
  from misiones m join mision_plantillas p on p.id = m.plantilla_id
 where m.tokens is not null group by 1 order by 4 desc;
```

### Contra los patrones que detectan los alumnos

La queja era concreta, así que cada patrón tiene su defensa, y todas son **deterministas**: el prompt
pide, pero el validador no confía en que el modelo cumpla.

* **Quiz**: se rechaza si la correcta es la más larga por más de un 10% sobre la más larga de las
  incorrectas (antes, por más de 1,6× el *promedio*, que dejaba pasar una correcta un 40% más larga que
  las otras). Además, en el 40% de las generaciones —lo sortea el servidor— se le exige que la correcta
  sea la **más corta**. En una muestra de once quices, la correcta fue la más larga en dos (dentro del
  10%), la más corta en cuatro. El validador además prohíbe «siempre/nunca/únicamente» como delator, y la
  posición de la correcta la decide el servidor al barajar (no el modelo; ver `quiz.mjs`).
* **Verdadero/falso**: cuántas son verdaderas lo decide el servidor (1, 2 o 3, el 2 más seguido) y se
  lo dice al modelo, para que no sea siempre dos y dos. Se rechaza si «siempre/nunca/solo…» está en dos o
  más falsas y en ninguna verdadera, o si el largo promedio de las verdaderas se aleja más de ~45% del de
  las falsas. Se corrige todo o nada: al azar paga 1 de 16.
* **Diagrama**: el servidor sortea cuántos pasos y cuál se oculta —nunca el primero ni el último— antes de
  llamar al modelo, y se lo dice por posición para que sus tres distractores sean *de ese paso*. Si trae 4 pasos cuando se
  pidieron 5 se acepta igual mientras el oculto siga siendo interior, y una explicación larga se recorta
  en vez de pagar otra llamada. Rige la
  misma regla del 10% y ninguna opción puede ser 2,5 veces más larga que otra. Un distractor que repite un
  paso ya visible se rechaza. Si el concepto no se presta a un flujo, el modelo puede decir `apto: false`
  y no se reintenta: se cae a otra mecánica.
* **Emparejar**: se tapa el término dentro de su propia definición («TLS es el protocolo que cifra…»
  se empareja sola) y no se juntan dos pares donde una definición nombra al otro término. Al azar paga
  1 de 24.

### Por qué `desarrollo` paga XP con el veredicto de un modelo y los laboratorios no

Es la decisión que más conviene dejar escrita. En `lib/revision-lab.mjs` el veredicto del modelo es una
**sugerencia que nunca toca los puntos**, porque los puntos de laboratorio cuentan para la nota y una nota
no se le delega a algo que se equivoca de vez en cuando. La experiencia de las misiones es **otra moneda**:
alimenta el pase y el ranking, no la evaluación. Que un modelo se equivoque en 75 XP de pase es un error
que el alumno ni nota; en una nota sería un reclamo. Por eso acá el veredicto sí paga:

| Veredicto | Paga | `acertada` |
|---|---|---|
| `logrado` | 75 | sí |
| `parcial` | 37 (la mitad, hacia abajo) | sí: «pagó algo» |
| `incompleto` | 0 | no |

El escalón existe para que un veredicto dudoso pese menos que uno limpio. Una consecuencia a tener en
cuenta: con 75 por misión se llega al nivel 30 acertando 26 de 28; un `parcial` vale la mitad, así que
quien responda desarrollo «a medias» varias veces se queda sin el margen de las dos misiones que se
podían fallar.

**Quién puede calificar.** El navegador nunca manda un veredicto: manda su texto a
`/api/mision-responder`, que (1) con el rol `pulso_misiones` lee la pauta con `mision_pauta()` —la
definición del docente y las ideas clave, que el alumno no puede leer antes de responder, y de paso
comprueba que la misión es de ese usuario, de hoy, sin resolver y de desarrollo—, (2) le pide el veredicto
al modelo y (3) lo anota con `mision_calificar()`. **Solo `pulso_misiones` puede ejecutar esas dos
funciones**: si las ejecutara la app, un alumno con su propio token se pondría «logrado». Y
`mision_responder()` —la que sí puede llamar— se niega a corregir esta mecánica. `mision_calificar` bloquea
la fila (`for update`), así que dos envíos simultáneos no pagan doble, y el id de usuario que recibe sale de
la cookie firmada ya verificada, no del cuerpo.

**Si el modelo falla** (corte, 401, respuesta vacía, veredicto inutilizable), no se anota nada: la misión
sigue sin responder, la pantalla conserva lo escrito y el alumno reenvía sin penalización
(`503 { reintentable: true }`). Un corte del proveedor no se paga con una misión perdida.

El texto del alumno va al modelo **entre marcas y como dato**, con la orden de ignorar instrucciones
dentro de él. No es infalible y no tiene por qué serlo: lo peor que consigue quien lo engaña son 75 XP de
pase. El mensaje se recorta a tres frases y el comentario del modelo se guarda junto con lo que escribió el
alumno (`solucion.respuesta`, `veredicto`, `explicacion`), para que el docente pueda ver qué escribió
cuando alguien reclama un veredicto. El tope de 240 caracteres por valor de `/api/mision-responder` sigue
valiendo para todas las demás mecánicas; solo `respuesta.texto` pasa de ahí (a 600).

### El tono, comprobado y no solo pedido

En la primera corrida de navegador, la corrección de una respuesta sin sentido empezó con **«Weón, tu
respuesta no tiene nada que ver…»** y siguió con «no cachai». Es el mismo tropiezo que tuvieron los
laboratorios (ver [El mensaje no da la respuesta](#el-mensaje-no-da-la-respuesta)), y la causa era que
la instrucción decía «español de Chile» a secas. Ahora `ESTILO` (`lib/mecanicas/comun.mjs`) pide tuteo
sin voseo y prohíbe garabatos, apelativos y jerga, y además `problemasDeTono()` lo **comprueba**: en la
generación de cualquier mecánica es un motivo de rechazo más del validador, y en la corrección de
`desarrollo` gatilla un reintento con el motivo; si el modelo insiste, no se anota nada y el alumno
reenvía. La regla en la instrucción baja la frecuencia; la comprobación es la que impide que llegue.

### Qué se guarda, y qué no

Antes no se guardaba lo que el alumno contestó. Para las mecánicas nuevas queda en
`solucion.respuesta` (acotado a las claves que cada una espera: `mision_responder` la puede llamar
cualquiera con su token y no hay razón para guardar un jsonb de tamaño libre). Sirve para que la pantalla,
al recargar, marque **cuáles** de las cuatro parejas estaban mal y no solo cuáles eran las correctas. El
quiz no lo guarda —su rama no cambió— y al recargar sigue mostrando la correcta sin marcar el error, como
antes.

### Compatible con lo que está publicado

Como siempre, la base migra antes que el frontend (ver «La base migra antes que el frontend»). La `0043`
no rompe lo desplegado:

* `mision_registrar` ganó tokens y costo como una **segunda firma de ocho argumentos, sin valores por
  omisión**; la de seis queda como envoltorio que llama a la nueva con nulos. Con omisiones, la llamada
  de seis calzaría con las dos y Postgres la rechazaría por ambigua.
* Las plantillas nuevas se insertan activas, pero nadie las sortea hasta que se despliegue la `/api/mision`
  que rota; la publicada sigue pidiendo siempre `quiz`.
* `contexto_mision` cuenta ahora también los cuatro términos de un emparejar como «ya preguntados»
  (`enunciado.terminos`) y filtra los nulos. Sin el filtro, un solo nulo en el arreglo dejaba sin
  candidatos a todo el banco: `x = any(array[null,'a'])` da nulo y `not nulo` es nulo.
* `mis_misiones` y `mi_mision` no cambiaron, y las misiones viejas (quiz) siguen funcionando.

### Datos del banco

Con cuatro mecánicas más, la calidad del banco se nota más: una entrada como `scp — «imagina una
herramienta de terceros que genera estadísticas de tu plataforma»` es una analogía de una diapositiva, no
una definición, y el modelo escribe sobre ella lo que puede. Para `verdadero_falso` se le exige que las
falsas lo sean también *en el mundo real*, no solo según la definición. El SQL de emparejar filtra lo que
no se sostiene solo (menos de 25 o más de 200 caracteres, o que parta con viñeta o número); lo demás es
curaduría del banco.

### Cómo probarlo

```bash
set -a; . ./.env.local; set +a
node neon/probar-misiones-variadas.mjs            # una misión real de cada mecánica; ~USD 0,0005
node neon/probar-mision.mjs                       # el ciclo del quiz, que no cambió
node neon/probar-mision-http.mjs                  # contra producción: ver nota
```

`probar-misiones-variadas.mjs` genera una misión de cada mecánica, responde mal y bien, comprueba el pago,
que `pulso_app` **no** pueda calificar ni leer la pauta ni registrarse una misión, el fallo del modelo, el
escalón 75/37/0, que la rotación no repita y que sin modelo caiga a `emparejar`; imprime los tokens
medidos y limpia al alumno de prueba. Llama a los handlers de `api/` en el mismo proceso, con una cookie
firmada con un secreto de prueba (los de producción son *Sensitive*).

Para ver las pantallas **antes de desplegar**, `neon/servir-api-local.mjs` levanta `/api/mision` y
`/api/mision-responder` con el código local y el proxy de `ng serve` les desvía solo esas dos rutas (el
resto sigue yendo a producción; ver el encabezado del archivo):

```bash
node neon/servir-api-local.mjs &
npx ng serve --proxy-config /tmp/proxy.json      # con "/api/mision" → localhost:3999 primero
BASE=http://localhost:4200 TEMA=claro node neon/probar-misiones-variadas-navegador.mjs
```

La prueba de navegador siembra misiones armadas a mano (cero tokens), las responde mal y bien en cada
mecánica, recarga y comprueba lo marcado, mira un celular, y deja capturas en `/tmp/misiones-*.png`.
`probar-mision-http.mjs` y `probar-mision-navegador.mjs` apretan el botón de verdad, así que ya no saben
qué mecánica les va a tocar: el primero arma la respuesta correcta de la que salga (y esperaba 25 XP,
un número que quedó viejo con la `0039`; ahora lee los 75 de la plantilla), y el segundo, si no sale
quiz, comprueba que el botón armó la misión y termina: el recorrido de las otras cuatro es el de
`probar-misiones-variadas-navegador.mjs`, que siembra en vez de sortear. Corrida contra el proxy con la
API local, `probar-mision-http` pasa con la rotación nueva (sacó `verdadero_falso` y `emparejar` en las
dos corridas).

## Pase y ranking

Un pase por evaluación parcial y por asignatura, de 30 niveles. La experiencia sale **solo de las
misiones** y se cuenta **dentro de la ventana del pase**: si no, el pase de la EP2 empezaría completo
con el XP de la EP1.

| | DSY1107 | ITY1102 |
|---|---|---|
| Primer parcial | 10/08 → 28/09 | 10/08 → 28/09 |
| Segundo parcial | 28/09 → 26/10 | 28/09 → 26/10 |
| Tercer parcial | 26/10 → 30/11 | 26/10 → 07/12 |

Los bordes van a las 00:00 de Santiago. En ITY1102 la planificación ponía el Segundo parcial el 14 de
septiembre, pero la EP1 se rindió después: la `0039` corrió el borde al 28 en los dos ramos, y las dos
semanas que ya habían contado para la EP2 volvieron a contar donde se ganaron, en el Primer parcial.

### 75 XP por misión

La escalera pide **1.910 XP** para el nivel 30 (40 por nivel del 1 al 10, 65 del 11 al 20, 90 del 21 al
30). Con 25 por misión, en los 28 días del Segundo parcial el techo era el nivel 15 **acertando todas**:
nadie podía terminar un pase, y en la EP1 el que más llegó fue al 20. Con 75 se llega al 30 en 26
misiones acertadas, así que hay que ir todos los días pero se pueden fallar dos. El número vive en
`mision_plantillas.xp` y `estado_mision` lo devuelve, así que la pantalla no lo escribe.

### La tirada de un nivel es de un pase

Hasta la `0039`, `sincronizar_pase` decidía si ya había pagado la tirada de un nivel buscando el
motivo `'Pase nivel 5'` en el libro, **sin mirar de qué pase**. Quien llegó al nivel 5 en la EP1 no iba
a cobrar nunca la del nivel 5 de la EP2: el pase decía «+1 tirada» y el contador no se movía. Ahora cada
tirada del pase lleva `pase_id` y `nivel`, y un índice único sobre `(matrícula, pase, nivel)` es el que
impide cobrar dos veces.

Y la sincronización recorre **todos los pases del ramo que ya empezaron**, no solo el vigente. Antes,
quien subía de nivel el último día de un parcial y no abría el pase antes del cierre perdía esos
premios: al día siguiente el vigente era otro. Al abrir la EP2 el celebrado dice de qué pase venía.

### El ranking es del parcial

`tabla_posiciones` cuenta el XP **dentro de la ventana del pase**, la misma cuenta que decide el
nivel, así que se reinicia sola con cada parcial. Antes sumaba todo el semestre, y la EP2 arrancaba
con los mismos arriba por lo que hicieron en agosto. Los que van en cero no compiten —el primer día
serían cuarenta empatados en el primer lugar—; la fila propia sí viene, para mostrarla aparte.

El pase que se mira sale de `pase_de_matricula()`: el vigente, y si no hay, el último que cerró. La
usan `mi_pase` y el ranking; dos copias de esa pregunta terminan contestando distinto.

## Gacha y cosméticos

El pase reparte **tiradas** y la tienda las vende; el gacha es donde se gastan. Cada tirada entrega un
cosmético: un **título** que se muestra bajo el nombre, o una **cara** para el perfil. Son **dos pozos
separados** y una sola moneda: el alumno elige en cuál tira.

### Una tirada se compra con puntos, y eso estuvo roto doce veces

La tienda tenía dos artículos —«Tirada exclusiva de íconos» y «Tirada exclusiva de títulos», 150 puntos
cada uno— que **no entregaban nada**. `solicitar_canje` descontaba los puntos y escribía el canje; las
tiradas viven en `movimientos_tiradas` y nadie las escribía desde un canje: las únicas fuentes eran los
niveles del pase y el −1 de `gacha_tirar`. Entre el 17 y el 24 de agosto, diez alumnos pagaron doce
veces por nada. El canje quedaba «entregado», el saldo bajaba, y la pantalla del gacha seguía diciendo
que no les quedaban tiradas: sin un error en ninguna parte.

Lo arregla la `0031`. Los dos artículos se retiran —se dejan `activo = false`, no se borran, porque hay
canjes apuntándolos y `canjes.articulo_id` es `on delete restrict`—, se devuelve lo pagado al
`precio_pagado` de cada uno, y queda **uno solo**: «Una tirada de gacha», que se gasta en el pozo que
el alumno quiera.

Y el mecanismo pasa a estar en el catálogo, no en un `if`: **`articulos.tiradas`** dice cuántas entrega
cada artículo. Así un paquete de cinco tiradas es una fila y no una migración. Con un check que prohíbe
combinar `tiradas` con `requiere_aprobacion`: la tirada se entrega al solicitar, en la misma
transacción que cobra, así que un artículo que además esperara visto bueno la entregaría antes de que
el docente aprobara nada. En vez de dejar ese camino a medias, la combinación no se puede escribir.

### El sorteo es en dos pasos, y a veces el premio es una bolsa

Primero se sortea **la rareza** con los pesos de `gacha_rarezas`, entre las seis. Después, con
`prob_puntos` de esa rareza —hoy 25 % en todas— el premio es una **bolsa de puntos** de esa rareza. Si
no, se elige **uniforme entre los cosméticos de esa rareza** que al alumno le faltan.

Los pesos son los mismos en los dos pozos. Lo que hay en cada uno, contando solo lo **sacable** —lo
que es recompensa del pase no entra, ver más abajo—, y lo que paga la bolsa:

| Rareza | Peso | Imágenes | Títulos | Bolsa |
|---|---|---|---|---|
| Común | 30 % | 70 | 9 | 20 |
| Poco común | 28 % | 48 | 17 | 40 |
| Rara | 25 % | 35 | 20 | 75 |
| Épica | 12 % | 18 | 18 | 150 |
| Legendaria | 4 % | 9 | 8 | 300 |
| Mítica | 1 % | 5 | 4 | 750 |

La alternativa —un peso por ítem y un solo sorteo— parece más simple y está mal: con 220 imágenes
comunes y 4 títulos míticos, el mítico saldría **una vez cada dos mil tiradas** y no lo vería nadie en
todo el semestre. Con dos pasos es exactamente 1 de cada 100, y sigue siéndolo cuando se suban más
imágenes.

**Sin repetidos.** Se sortea solo entre lo que falta. Si la rareza que salió ya no tiene nada para ese
alumno, se vuelve a sortear entre las que sí —el peso de la agotada se reparte en proporción, que es
exactamente el reparto de antes de las bolsas—. Y si al alumno **ya no le falta nada en ese pozo**, la
tirada es una bolsa: antes era un error y el botón quedaba apagado con tiradas en la mano. La tirada se
gasta **después** de que hay algo que dar.

### Dos pozos, y por qué las imágenes dejaron de ser todas comunes

Hasta la `0035` había un pozo y las 220 imágenes eran **todas comunes**. Tenía sentido: dentro de una
rareza el sorteo es uniforme, así que compartir rareza era lo que les daba la misma probabilidad entre
sí. Pero el pozo único quedaba torcido, y se puede calcular: de 269 cosméticos sorteables, 189 eran
imágenes comunes, así que común era 30 % de las tiradas y dentro de común el 95 % era imagen.
Resultado real: **~71 % de las tiradas entregaba título y ~29 % imagen**, y ninguna imagen podía salir
con brillo. Épica y para arriba eran siempre títulos.

La `0035` los separa. Cada pozo reparte sus seis rarezas, y para eso cada imagen necesita una rareza
propia. El reparto es **al azar y no curado** —un personaje secundario puede quedar mítico y el
protagonista común— y se deriva del código con `rareza_de_imagen(codigo)`: `md5 % 100` con cortes
fijos. Es una función y no un sorteo de una vez porque `subir-cosmeticos.mjs` se corre muchas veces y
hace `set rareza = excluded.rareza`; un `order by random()` se lo llevaría a la primera subida y —peor—
la segunda corrida le cambiaría la etiqueta a imágenes que el alumno ya tiene. Las del pase no se
recalculan: su rareza se puso a mano, y el `on conflict` del subidor tiene la guarda que lo impide.

**Una sola moneda.** `movimientos_tiradas` no cambia: la tirada se gana una vez y el pozo se elige al
gastarla, con `gacha_tirar(matricula, pozo)`. Una moneda por pozo obligaría a repartir los 30 niveles
del pase entre los dos, a migrar los saldos que ya existen y a duplicar el artículo de la tienda; y al
que completó las imágenes le dejaría tiradas muertas.

`p_pozo` tiene **omisión nula** —nulo es el pozo completo, como antes— y eso no es comodidad: es lo que
permite aplicar la migración antes del despliegue sin que el sitio publicado, que llama con un solo
argumento, se caiga en el medio. El filtro por pozo entra en los **dos** lugares donde se mira el pozo,
el sorteo de rareza y la elección del ítem: solo en el segundo, se sortearía «mítica» mirando ambos
pozos y después no habría mítica de ese tipo que entregar.

### Los títulos se leen en masculino o en femenino

De los 108 títulos activos, **56 marcaban género masculino**, así que a más de la mitad del curso el
juego le ponía un texto que no la nombra: «El Elegido del Algoritmo», «Rey del Carrete», «El Compañero
de Todas». La `0037` les da segunda forma.

**La forma femenina es dato y no una regla.** Derivarla —`el → la`, `-o → -a`— falla en silencio: «Rey»
no da «Reya», «GOAT» daría «GOATa», y hay dos casos que cierran la discusión. «El Caballero de la Mesa»
hay que reescribirlo («La Dama de la Mesa»), y «El Compañero de Todas» gira **también el complemento**
(«La Compañera de Todos»). Así que va en `cosmeticos.valor_femenino` y la escribe una persona, en
`neon/titulos-femenino.txt`. Nulo ahí significa «este título ya sirve para todos», y es además la
degradación elegante: un título con género cuya forma no está escrita se muestra en masculino, así que
el mecanismo se pudo desplegar antes de tener el archivo completo.

**La forma sigue a quien lleva el título, no a quien mira.** Es la restricción que ordena todo el resto:
en la tabla de posiciones veo el título de una compañera y ahí tiene que leerse en **su** forma. Eso
descarta resolverlo en el navegador con una preferencia local, y obliga a resolverlo en los cinco
lugares donde un título se junta con una persona: `mis_ramos`, `tabla_posiciones`, `mis_cosmeticos`,
`mi_pase` y `gacha_tirar`. Cada uno con `titulo_texto(valor, valor_femenino, forma)` y con el perfil de
quien lleva el título.

**La preferencia es de redacción, no de identidad.** `perfiles.forma_titulo`, con omisión `'masculino'`
—que es exactamente lo que había, así que la migración no le cambió el texto a nadie—. En «Mi perfil»
hay dos botones y un ejemplo en vivo: no se le pregunta su género ni se infiere del nombre, que en un
curso de cuarenta es misgendering garantizado y además un dato que la app no necesita para nada más.

**Y se resuelve `nombre`, no solo `valor`.** Esto salió mirando la pantalla y no el esquema, y era el
error que habría hecho fracasar el cambio sin que nada fallara: la escalera del pase dibuja
`cosmetico.nombre`, y la colección dibuja las dos —la chapa con `valor` y la etiqueta con `nombre`—.
Resolver solo `valor` dejaba el pase entero en masculino y la colección contradiciéndose consigo misma
a dos centímetros. Para un título las dos columnas son la misma cadena, y ese invariante ahora lo
vigila la migración: el día que alguien las separe, revienta en vez de mentir.

**Lo que esto obligó a arreglar.** El pase averiguaba cuál título llevabas puesto **comparando texto**
entre `tabla_posiciones` y `mi_pase`. Calzaba por casualidad —dos funciones distintas devolviendo la
misma cadena— y con dos formas habría dejado la escalera sin marcar «Puesto» para toda alumna que
eligiera femenino, sin error en ninguna parte. Ahora `mis_ramos` y `tabla_posiciones` devuelven
`titulo_id` y la comparación es por id. Las columnas van **al final** porque una vista solo acepta
columnas nuevas ahí, y porque así el sitio publicado sigue sirviendo durante la ventana en que la Data
API tiene el esquema viejo.

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

El reparto lo hace `neon/repartir-pase.mjs`. Hoy son **32 frases y 35 imágenes** exclusivas —de 108 y
220— más los 3 marcos, que quedan solo en el pase.

```bash
set -a; . ./.env.local; set +a
node neon/repartir-pase.mjs                                   # informa y no toca nada
node neon/repartir-pase.mjs --escribir                        # sortea los que no empiezan
node neon/repartir-pase.mjs --resortear DSY1107:2 --escribir  # y además uno que ya empezó
```

**Un pase que ya empezó queda congelado.** Solo se sortean los que todavía no parten; los otros se
leen de la base y cuentan como usados. Antes cada corrida re-sorteaba todo, y como el pozo cambia —se
suben cosméticos, el gacha entrega otros— la misma semilla daba otra escalera: un alumno vería cambiar
el premio del nivel 19, y la exclusividad se movería devolviendo al gacha algo que alguien ya ganó en
el pase. `--resortear` es la excepción explícita: así se le dieron premios nuevos a la EP2 el 28 de
septiembre.

**Solo lo que nadie tiene.** El sorteo elige entre cosméticos que ningún alumno tiene todavía: un
premio que ya sacó tirando es un nivel vacío. Los marcos son la excepción —son tres— pero no se
repiten dentro de un mismo pase.

**Al azar, pero siempre el mismo azar.** La semilla sale del id del pase y del nivel: dos corridas
sobre el mismo pozo dan la misma escalera.

**Las caras también suben de rareza.** Desde la EP2 la escalera tiene quince cosméticos —caras de poco
común a legendaria, frases de rara a legendaria— porque con 75 XP por misión el pase se puede
terminar. Al escribir, toda imagen que no queda en un pase congelado se realinea a
`rareza_de_imagen(codigo)`: las que salen de un pase vuelven al pozo con su rareza de código, no con
la que tenían puesta a mano. René Puente conserva la suya.

**El pase llega hasta legendaria, no hasta mítica.** Los cuatro títulos míticos se quedan solo en el
gacha. El pase es el camino garantizado —se llega al 30 trabajando— y si además diera lo más raro del
pozo, el 1% del gacha dejaría de significar algo. Lo garantizado sube hasta legendaria; lo mítico sigue
siendo suerte.

En la colección los del pase se ven igual, con borde punteado y la etiqueta del nivel en que tocan. Y
hay un filtro **«Puedo sacarlo»** que deja solo lo que de verdad puede salir de una tirada: sin eso, un
alumno puede quedarse tirando semanas esperando algo que el gacha no entrega.

### El pase no paga puntos; el gacha sí, en bolsas

Los puntos son de las actividades y se gastan en la tienda. El pase reparte XP, niveles, cosméticos y
tiradas, y **no paga puntos**. Había una mentira concreta: `mi_pase` devolvía `puntos_por_sobrante`
—«lo que sigas ganando se convierte en puntos: llevas N»— y nadie los pagaba nunca. Se fue eso y la
columna `xp_por_punto`. El sobrante se sigue informando, porque es cierto y se ve en la barra.

El gacha sí paga, desde la `0039`, y de verdad: la bolsa escribe su movimiento en `movimientos_puntos`
en la misma transacción que gasta la tirada —«Gacha: bolsa rara de 75 puntos»—. Lo que impide que eso
se vuelva una máquina de farmear la tienda es la cuenta:

```
lo esperado de una tirada = Σ peso × prob_puntos × bolsa / Σ peso ≈ 18 puntos
```

Una tirada cuesta 150 en la tienda: comprar tiradas para sacar puntos pierde unos 132 cada vez. Épica
devuelve lo que costó; legendaria y mítica son la suerte. La migración revienta si alguien sube las
bolsas hasta que una tirada cueste menos del doble de lo que devuelve.

### Subirlos

```bash
set -a; . ./.env.local; set +a
node neon/subir-cosmeticos.mjs --titulos ~/Downloads/titulos_perfil_rareza.txt \
  --titulos-f neon/titulos-femenino.txt \
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
node neon/probar-gacha.mjs [--tiradas 8000]
```

Un gacha es una promesa numérica: si la pantalla dice que un mítico sale 1 de cada 100 y en realidad
sale 1 de cada 2.000, eso **no falla en ninguna parte** —los alumnos simplemente nunca ven uno y nadie
sabe por qué—. Por eso el grueso de la prueba es contar: tira unos miles y compara la frecuencia
observada contra los pesos declarados.

Las tiradas se **reparten entre los dos pozos** y cada uno se mide por separado, porque el promedio de
ambos escondería que uno está torcido: si el de imágenes entregara siempre común y el de títulos
compensara, el total seguiría cuadrando. De ahí que el `--tiradas` útil sea el doble que antes. Y se
vigilan dos cosas más: que cada imagen tenga la rareza que le toca por su código —lo que atrapa una
corrida de `subir-cosmeticos.mjs` que las vuelva a dejar todas comunes— y que **ninguna rareza del
pozo de imágenes quede con menos de tres**, porque una rareza con un ítem se agota en la primera
tirada y desaparece del sorteo.

Lo otro que vigila es la puerta: que `pulso_app` **no tenga** grant de `update` sobre `perfiles.avatar`
y sí sobre `nombre`, y que un `update` directo lo rechace Postgres. Se comprueba el grant y no que la
pantalla esconda el botón, porque el botón no es lo que lo impide.

## Puntos para evaluaciones

«0,2», «0,5» y «1 punto en una evaluación» ya no son solicitudes atadas a una evaluación. Son dos pasos:

1. **Comprar** es inmediato: las décimas entran al saldo del alumno, que vive en *Mi perfil*.
2. **Usarlas** es cuando él quiera: elige la evaluación y cuántas décimas. Eso sí espera al docente, que
   lo ve en `/curso`, tarjeta *Puntos para evaluaciones por aplicar*, y lo marca **Aplicado** al poner
   la nota. **Rechazar** devuelve las décimas al saldo, no los puntos: la compra ya se hizo.

Un uso pendiente ya no está disponible —si no, las mismas décimas se podrían pedir para dos
evaluaciones mientras el docente no responde— y el alumno lo puede cancelar mientras siga pendiente.

### El precio sube con cada compra

```
precio = base × (1 + 0,5 × compras previas de ese mismo artículo)
```

| | Base | 2.ª compra | 3.ª compra |
|---|---|---|---|
| 0,2 | 300 | 450 | 600 |
| 0,5 | 675 | 1013 | 1350 |
| 1 punto | 1350 | 2025 | 2700 |

Tres decisiones, las tres a propósito:

- **Sobre la base, no sobre el último pagado**: el aumento es lineal, no compuesto.
- **La cuenta es por artículo** (`0040`). Comprar un 0,2 sube solo el siguiente 0,2; el 0,5 y el punto
  siguen a su precio. Hasta la `0039` era compartida entre los tres, y eso castigaba a quien empezaba
  por lo barato. Esquivarla comprando 0,2 muchas veces no sirve: cada 0,2 sube el siguiente y el tope
  es 3.
- **Al cambiar la regla se anuló lo comprado**. La `0040` devolvió entero lo que cada compra vigente
  había pagado, las canceló —y con ellas sus décimas— y canceló los usos que seguían pendientes. Quien
  las quiera las vuelve a comprar con el precio nuevo.

El tope de 3 por artículo sigue. El descuento de reunión se aplica **después**, sobre el precio ya
escalado. Cancelados y rechazados no cuentan, porque se devolvieron.

### Dónde vive cada número

- `articulos.decimas` dice cuántas décimas entrega un artículo, igual que `tiradas`. No se usa
  `categoria = 'nota'` porque la ruleta también es de nota y no entrega décimas.
- `precio_escalado(base, previos)` es pura y la usan las dos: `vitrina.precio` —lo que se muestra— y
  `solicitar_canje` —lo que se cobra—. En la vitrina, `precio` es **el precio de ese alumno ahora** y
  `precio_base` el de lista; así la pantalla publicada mostró el precio correcto desde el minuto en que
  se aplicó la migración, sin esperar a que la Data API viera las columnas nuevas.
- El saldo no tiene libro propio: son los canjes de décimas entregados menos los usos pendientes y
  aplicados. La vista es `saldos_decimas`.

### Probarlo

```bash
set -a; . ./.env.local; set +a
node neon/probar-decimas.mjs [--sigla ITY1102]
```

Con la cuenta de prueba: la escalada por artículo, que se cobre lo que muestra la vitrina, el tope de 3,
usar, no pasarse del saldo, cancelar, rechazar y aplicar, y que nadie inserte en `usos_decimas` a mano.
Borra lo que creó al terminar.

## Ruleta de nota

«No dar la prueba y tirar la ruleta» (`ruleta-nota`, 1.800 puntos) promete un sorteo: **50 %** un 1,0 ·
**40 %** un 4,0 · **9 %** un 5,0 · **0,8 %** un 6,0 · **0,2 %** un 7,0. Hasta la `0042` el docente lo
resolvía con una ruleta de una página externa —casi ninguna admite pesos— y escribía el resultado a mano
en «Entregar». Eso no deja registro, no se puede verificar y ofrece la tentación de «girar hasta que salga
lo que quiero». Ahora se tira dentro de Pulso: en **Curso → Canjes por resolver**, el botón de un canje de
la ruleta no dice *Entregar* sino **Tirar la ruleta**, y abre una rueda a pantalla completa para proyectar.

### El servidor decide, la rueda solo lo muestra

Al apretar **¡Girar!** lo primero que ocurre es `tirar_ruleta(canje)`, que sortea **en la base** y deja el
canje `entregado` con la nota guardada, todo en la misma transacción. Recién con la nota ya decidida la
rueda gira unos 5 segundos y frena en un punto al azar **dentro** del tramo que salió. Consecuencias:

- Cerrar la pestaña a mitad de la animación no cambia nada: el sorteo ya ocurrió y el canje ya no está
  `solicitado`, así que no hay forma de «volver a girar».
- El alumno ve el resultado en su tienda como respuesta del docente («La ruleta salió 4,0 · se aplica a
  «Para la Evaluación Parcial 2»») y queda además en `canjes.ruleta_nota` / `ruleta_en` (y al final de
  `canjes_detalle`).
- Con `prefers-reduced-motion` la rueda no gira: muestra la nota de una vez.

### Pesos por mil, en tabla

`ruleta_tramos(nota, peso, orden)` guarda **500 · 400 · 90 · 8 · 2**: suman 1000, así que cada porcentaje
es exacto y el 0,2 % es un entero. El sorteo (`ruleta_sortear()`) usa el mismo mecanismo que el gacha: **un**
`random()` escalado al total, fuera de la comparación. La rueda del navegador se dibuja con **esas mismas
filas**, así que lo que se ve y lo que se sortea no pueden separarse.

Las proporciones son las verdaderas, y eso tiene un costo visual: el 6,0 es una franja de menos de tres
grados y el 7,0 de menos de uno. Se dejó así —esconderlo para que se vea más lindo sería otra forma de
mentir— y la leyenda del costado dice cada porcentaje. `orden` es el de la rueda (1,0 · 6,0 · 4,0 · 7,0 ·
5,0) y no el de las notas, para que las dos franjas finas no queden pegadas entre sí.

Los colores salen de los tokens de `styles.css` (`--rojo`, `--celeste`, `--verde`, `--amarillo`,
`--turquesa`), así que la rueda sigue sola al modo oscuro.

### Una sola vez, y sin carreras

`tirar_ruleta` solo la puede tirar un docente que vea esa matrícula, solo sobre un canje de `ruleta-nota`
y solo si está `solicitado`. La fila se bloquea con `for update` **antes** de mirar el estado: dos clics o
dos pestañas hacen cola y el segundo encuentra el canje ya entregado y falla. Sin el bloqueo ambos leerían
«solicitado» y sortearían dos veces, quedándose el docente con el que más le gustara.

Dos funciones viejas se reemplazaron (misma firma: el frontend desplegado las sigue llamando igual):

- **`resolver_canje`** ya no entrega la ruleta: «entregado» o «aprobado» sobre un canje de `ruleta-nota`
  falla con *La ruleta se resuelve tirándola*. Si no, el botón viejo —o un RPC directo— cerraría el canje
  sin sorteo. **Rechazar** sigue valiendo y devuelve los puntos.
- **`resolver_canje` y `cancelar_canje`** ganaron `for update` en la lectura del canje. Eran lecturas sin
  bloqueo: si el docente giraba justo cuando el alumno cancelaba, ambas veían «solicitado» y el alumno
  quedaba con la nota **y** con sus 1.800 puntos de vuelta.

### Cómo llega la pantalla a la base

Por `/api/docente`, acciones `ruleta-tramos` y `tirar-ruleta` (solo docentes: no están en `ABIERTAS`). Es
la misma razón que el modo reunión: una tabla o función nueva no es visible para la Data API hasta que
PostgREST recarga, y eso puede tardar quince minutos o más. Por conexión directa funciona apenas se aplica
la migración. Las dos columnas nuevas de `canjes_detalle` sí dependen de la recarga (`node
neon/refrescar-api.mjs`), pero nada las necesita todavía: el resultado llega en la respuesta de
`tirar-ruleta`.

Como siempre, **la migración va antes que el frontend**: la `0042` es aditiva y el frontend publicado
sigue funcionando con ella puesta (el botón viejo «Entregar» de la ruleta pasa a fallar con un mensaje
claro, que es lo que se quiere).

### Probarlo

```bash
set -a; . ./.env.local; set +a
node neon/probar-ruleta.mjs
```

Con la cuenta de prueba, sobre canjes que crea y borra (los reales de la ruleta no se tocan, y lo
comprueba al final): los tramos suman 1000; **20.000 sorteos** de `ruleta_sortear()` con cada frecuencia
dentro de cinco desviaciones estándar de lo esperado (con dos, una corrida honesta fallaría una de cada
veinte veces); el alumno no la tira ni pide sorteos sueltos; «Entregar» y «Aprobar» fallan; rechazar
devuelve los puntos; un canje de otro artículo no se tira; el segundo giro falla; **dos giros simultáneos
dejan exactamente uno**; y tirar contra cancelar nunca deja la nota y los puntos a la vez.

La pantalla se prueba en un navegador real, pero **no contra producción**: la ruleta es del docente, cuya
clave no está en el repositorio, y `/api` de producción no tiene `tirar-ruleta` hasta desplegar.

```bash
npx ng build --configuration development --output-path /tmp/pulso-dist
node neon/probar-ruleta-navegador.mjs [/tmp/pulso-dist/browser] [carpeta-de-capturas]
```

Sirve el `dist` y **intercepta** `/api` y `/db` desde puppeteer: la sesión es falsa, las lecturas salen de
la base de verdad (filtradas a los canjes de la prueba) y `tirar-ruleta` ejecuta las mismas consultas que
`api/docente.mjs` con la identidad del docente. Una primera tanda **fuerza** la nota de la respuesta —1, 4,
5, 6 y 7— para ver frenar la rueda en cada tramo, incluida la franja del 7,0; cada giro se verifica
**leyendo el ángulo final** y calculando qué tramo quedó bajo el puntero. La segunda usa el sorteo real y
comprueba que la pantalla muestra lo que guardó la base y que el canje sale de la bandeja. Después, el
modo sin movimiento y los dos temas, con capturas. Lo único que no ejerce es el handler HTTP de
`api/docente.mjs` (necesita la cookie firmada), que se probó aparte importándolo con una cookie de
prueba.

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
es un aviso, no un límite. Pasadas dos horas, además, sale en el [correo del día](#avisos-por-correo).

## Avisos por correo

Una vez al día, a las 08:00 de Santiago, un cron de Vercel llama a `GET /api/docente?avisos=1`, que lee
`avisos_docentes()` y le manda a cada docente un correo con lo que lo está esperando:

- **Canjes por resolver**: los que piden visto bueno y siguen en `solicitado`
- **Puntos para evaluaciones por aplicar**
- **Modo reunión encendido** hace más de dos horas

Con cada ítem va la sección, el alumno y cuánto lleva esperando. **Sin nada pendiente no hay correo**:
uno diario que dice «todo bien» se aprende a borrar sin abrir, y el día que importa también se borra.
`avisos_enviados` guarda una fila por docente y día, así que si el cron corre dos veces no se manda
dos veces.

### Por qué con el rol del servidor

`avisos_docentes()` devuelve nombres y correos de todos los cursos, así que su `execute` es **solo de
`pulso_misiones`** —el rol de `/api/mision`, que la Data API no puede adoptar porque el token que firma
el servidor dice siempre `pulso_app`—. Primero se probó la guarda de `laboratorio_pauta`, que pregunta
por `uid_del_token()`, y **falla abierta**: `uid_del_token()` devuelve nulo cuando `auth.uid()`
revienta, y medido contra producción la primera llamada con un token de alumno —conexión recién
abierta tras recargar el esquema— devolvió la lista entera. Un permiso por rol falla cerrado.

### Configurarlo

El correo sale por [Resend](https://resend.com), con `fetch` y sin dependencia. En Vercel, en las
variables del proyecto:

| Variable | Qué es |
|---|---|
| `CRON_SECRET` | Cualquier cadena larga. Vercel la manda como `Authorization: Bearer …` al llamar el cron; sin ella el endpoint no corre para nadie |
| `RESEND_API_KEY` | La llave de Resend |
| `AVISOS_PARA` | Opcional. Manda todo a esta dirección en vez del correo del docente en la base |
| `AVISOS_REMITENTE` | Opcional. Por omisión `Pulso <onboarding@resend.dev>` |

Sin un dominio verificado en Resend, `onboarding@resend.dev` **solo entrega al correo de la cuenta de
Resend**. Si esa cuenta no es la de `@profesor.duoc.cl`, pon esa dirección en `AVISOS_PARA`.

Para probarlo sin esperar al cron:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" 'https://pulso-rust.vercel.app/api/docente?avisos=1&seco=1'    # arma y no manda
curl -H "Authorization: Bearer $CRON_SECRET" 'https://pulso-rust.vercel.app/api/docente?avisos=1&forzar=1'  # manda aunque ya haya salido hoy
```

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

`ng serve` no tiene las funciones de `api/` ni la reescritura de `/db`, así que la app arranca y no puede
entrar. Para probar contra la base y las funciones de producción, un proxy delante:

```bash
cat > /tmp/proxy.json <<'JSON'
{ "/api": { "target": "https://pulso-rust.vercel.app", "changeOrigin": true },
  "/db":  { "target": "https://pulso-rust.vercel.app", "changeOrigin": true } }
JSON
npx ng serve --proxy-config /tmp/proxy.json
BASE=http://localhost:4200 node neon/probar-mision-navegador.mjs
```

La cookie de sesión no lleva `Domain`, así que viaja a `localhost` sin más; y Chrome acepta cookies
`Secure` en `localhost`. Las pruebas de navegador aceptan `BASE` justamente para esto: se corrige el
frontend y se comprueba **antes** de desplegar, en vez de desplegar para ver si quedó.

### Un `effect` sobre el ramo se dispara con cada refresco del perfil

`perfil.ramo()` es un `computed` que sale de un `find()` sobre el arreglo de ramos, así que cada
`perfil.cargar(true)` **devuelve otro objeto**: mismo ramo, otra identidad. Angular compara con
`Object.is`, ve algo distinto, y todo `effect` que lea `perfil.ramo()` se vuelve a disparar.

Eso rompió la pantalla de misiones. `responder()` refresca el perfil al terminar —el encabezado muestra
el saldo— el effect se disparaba, la misión se releía del servidor y la corrección recién hecha quedaba
reemplazada por el relleno de «ya resuelta»: la alternativa que se había pintado verde pasaba a roja y
la insignia caía a «+0 de experiencia», con los 25 puntos ya abonados en la base. Se veía como dos fallas
—«las misiones no dan experiencia» y «marca buena y después mala»— y era una sola.

La regla: **si el effect solo necesita saber de qué matrícula se trata, que dependa del `uuid`**, que es
un string y no cambia de identidad al refrescar. Vive en el store, con el porqué:

```ts
readonly matricula = computed(() => this.ramo()?.matricula_id ?? '');
```

Y no se arregla poniéndole un `equal` propio a `ramo`: las plantillas leen de ahí el saldo y la sección,
así que quedarse con el objeto viejo dejaría el saldo congelado justo después de comprar. Lo que se
corrige es la dependencia, no el `computed`.

Lo tenían las nueve pantallas que reaccionan al ramo —`misiones`, `clases`, `actividades`, `gacha`,
`pase`, `inicio`, `puntos`, `tienda` y `ficha`— y ya dependen todas de la matrícula. En la mayoría solo
costaba una consulta repetida, pero en `pase` costaba más: `cargar` **escribe** —`sincronizarPase`
entrega lo desbloqueado— así que equiparse un avatar volvía a sincronizar el pase y a levantar la
celebración recién cerrada. `reunion.store` ya se defendía solo, comparando contra la matrícula que está
mirando; es el mismo remedio escrito a mano.

Las dos que necesitan el objeto completo —`clases` y `actividades`, que filtran por asignatura y
periodo— lo leen con `untracked`, para depender del uuid y usar el ramo fresco.

### Modo oscuro

La app tiene un tema oscuro. No es una hoja de estilos aparte: son los mismos componentes con **otros
valores para los mismos tokens** de `src/styles.css`. Si un componente usa `var(--blanco)` o
`var(--texto)`, ya está resuelto en los dos temas sin tocarlo.

**Dónde vive la preferencia.** En `localStorage`, clave `pulso.tema`, con dos valores posibles:
`claro` u `oscuro`. Mientras la persona no apriete el botón no hay valor guardado y manda el sistema
(`prefers-color-scheme`), que además se sigue en caliente si cambia. En cuanto elige, su elección gana
sobre el sistema. Son dos estados guardados y la ausencia como «lo que diga el sistema»: un tercer botón
«automático» lo usaría casi nadie. Si el almacenamiento está bloqueado (modo privado, permisos) el tema
cambia igual durante la sesión y solo se pierde la preferencia, igual que con `pulso.ramo` en `perfil.store.ts`.

**Quién lo aplica.** Dos piezas que repiten la misma lógica, a propósito:

- Un script en línea en el `<head>` de `src/index.html` pone `data-tema` en `<html>` **antes** de que
  cargue el CSS y arranque Angular. Si se esperara a Angular, cada visita en oscuro empezaría con un
  destello blanco.
- `TemaService` (`src/app/tema.service.ts`, un `signal`) toma el relevo: expone `tema()`, `alternar()` y
  `elegir()`, sigue al sistema, se entera si otra pestaña cambia el tema y actualiza
  `<meta name="theme-color">` (`#0D2679` en claro, `#0B1224` en oscuro). `App` lo inyecta para que
  funcione en todas las pantallas.

**Dónde está el botón.** En la barra lateral, encima de «Salir» (`marco.component.ts`). La etiqueta
dice **a qué se cambia** («Modo claro» estando en oscuro), igual que el ícono: con el texto fijo
«Modo oscuro», en oscuro el botón parecía no hacer nada. En ingresar y registro, que no tienen barra
lateral, `<app-boton-tema>` lo pone como un botón redondo en la esquina.

**Al cambiar, sin transiciones por un cuadro.** `TemaService` pone `tema-cambiando` en `<html>` y la
quita dos cuadros después; mientras está, `transition:none`. Sin eso, las tarjetas, botones y bordes
que tienen `transition` se desvanecían a destiempo del fondo, que cambia de golpe, y la pantalla se
veía a medio pintar. El logo de ingresar lleva `aspect-ratio`: sin él, en oscuro y sin caché, la placa
clara se dibujaba vacía —una píldora blanca— hasta que llegaba el PNG.

**Los tokens.** `:root[data-tema="oscuro"]` redefine los de siempre (`--fondo`, `--blanco`, `--borde`,
`--texto`, `--texto-suave`, `--celeste-suave`, los tres `--*-suave` de estado, `--sombra*`) y declara
`color-scheme: dark`, para que inputs, selects y barras de desplazamiento nativos sigan al tema. La
paleta es azul marino y no negro: el negro plano apaga la marca y las tarjetas quedan sin borde.
Superficies, de más hundido a más elevado: `--fondo` `#0B1224` < `--campo` `#0E1630` < `--blanco`
`#141D36` (tarjetas). Contrastes calculados: `--texto` 15,6:1 sobre `--fondo` y 14:1 sobre `--blanco`;
`--texto-suave` 8:1 y 7,2:1.

La decisión que más pesa: **`--azul` pasa a ser el azul claro que se lee como texto** (`#8DB1FF`). Antes
`--azul` hacía dos trabajos —texto de títulos y enlaces, y relleno de botones—, y esos dos no
caben en un mismo valor sobre fondo oscuro. El relleno se separó en `--marca` (+ `--marca-hover`,
`--sobre-marca`). Lo mismo con el texto sobre estados sólidos (`--sobre-estado`) y con el celeste de acción
(`--sobre-celeste`).

Tokens que se agregaron porque había colores sueltos en los componentes que no sirven en los dos temas:

| Token | Para qué |
|---|---|
| `--campo` | fondo de inputs, selects y textareas |
| `--lateral-fondo`, `--lateral-borde` | barra lateral (oscura en los dos temas; en oscuro lleva un borde) |
| `--velo` | barra de entrega pegajosa (blanco semitransparente) |
| `--logo-placa` | el «Pulso» del logo es azul marino: en oscuro va sobre una placa clara |
| `--verde-texto`, `--amarillo-texto`, `--rojo-texto`, `--celeste-texto`, `--alerta-texto` | texto de avisos e insignias sobre su fondo suave |
| `--codigo-fondo`, `--codigo-texto` | bloques `<pre>` de los laboratorios |
| `--oro`, `--plata`, `--bronce` | podio del ranking |
| `--rareza-*`, `--morada-*`, `--dorada-*`, `--magenta-*` | tonos e insignias de rareza del gacha |
| `--parcial-borde`, `--parcial-icono`, `--incompleto-icono` | sugerencias del laboratorio |

**Regla para componentes nuevos:** colores solo con `var(--token)`. Un `#hex` o `rgba()` en un componente
se ve bien en claro y se rompe en oscuro sin que nadie lo note hasta que alguien lo abre de noche.
Si el valor no existe como token, se agrega en `:root` **y** en `:root[data-tema="oscuro"]`. En la
barra lateral el blanco y los `rgba(255,255,255,…)` están bien, porque es oscura en los dos temas.

Los mazos de clase (`/api/clase`) se abren en otra pestaña con su propio HTML y **no** siguen este tema.

**Cómo probarlo.** Con el servidor de desarrollo de «Desarrollo» arriba:

1. Abre `/ingresar`. Sin nada guardado debe verse como tu sistema; cambia el tema del sistema y debe
   seguirlo sin recargar.
2. Aprieta el botón de la esquina: el tema se invierte, `localStorage['pulso.tema']` queda guardado y
   recargando se mantiene aunque el sistema diga otra cosa.
3. Entra con la cuenta de prueba y recorre inicio, clases, actividades, tienda, gacha, pase, perfil,
   puntos y un laboratorio en los dos temas. Fíjate en que no queden textos ilegibles (azul marino sobre
   oscuro) ni cajas blancas.
4. En consola, `document.documentElement.dataset.tema` dice cuál manda y
   `document.querySelector('meta[name=theme-color]').content` debe cambiar con él.

### La barra lateral en el celular

Tres anchos, en `styles.css`:

| Ancho | Barra |
|---|---|
| más de 900 px | lateral de 248 px con etiquetas |
| 641–900 px | riel de íconos de 72 px |
| hasta 640 px | barra superior con ☰; la lateral es un cajón que se abre encima |

El riel servía en una tableta y no en un teléfono: le quitaba un quinto del ancho a uno de 390 px, y
con trece entradas más el pie, en una pantalla baja (iPhone SE, 667 px) «Salir» y el tema quedaban
bajo el borde sin forma de llegar, porque la barra mide `100vh` y no desplazaba. Ahora la lateral
desplaza en todos los anchos (`overflow-y:auto`), y en el celular el cajón se cierra al navegar, con
Escape, con la ✕ o tocando el velo, y bloquea el desplazamiento de la página de atrás mientras está
abierto.

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

### La base migra antes que el frontend, así que la firma vieja tiene que seguir sirviendo

Entre migrar y desplegar pasa un rato, y en ese rato **el frontend que hay publicado sigue llamando a
las funciones con la firma vieja**. Un parámetro nuevo con valor por omisión parece resolverlo —la
llamada de antes sigue calzando— pero le escribe el valor por omisión a la columna.

La 0028 le agregó a `actividad_guardar` los dos parámetros del plazo con omisión nula, y eso dejó al
panel publicado **borrando el plazo** cada vez que se guardaba una actividad, aunque el docente solo
hubiera corregido una tilde en el título. El laboratorio volvía a pagar siempre, para todos, sin un
error en ninguna parte. Lo arregla la 0029 llevando la diferencia a la firma, que es lo único que
Postgres puede mirar:

| Firma | Qué hace con el plazo |
|---|---|
| diez argumentos | no lo toca —es la que llama el panel viejo— |
| doce argumentos | lo deja exactamente como digan los dos últimos, nulos incluidos |

Por eso la de doce **no** tiene valores por omisión: con ellos, una llamada de diez calzaría con las dos
y Postgres la rechazaría por ambigua. Y la de diez no repite ninguna validación —lee el plazo guardado y
llama a la otra— porque dos copias de las mismas reglas terminan comportándose distinto.

La regla que queda: **al agregar un parámetro que escribe una columna, pregúntate qué le va a escribir
la llamada que ya está corriendo en producción.**

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
| `/api/clase?id=…&descargar=1` | El mismo deck como adjunto: sin rastreo, y no cuenta como abrirlo |
| `/api/clase-avance` | Recibe el avance dentro del deck y paga los puntos |
| `/api/laboratorio` | Leer, guardar y entregar un laboratorio |
| `/api/docente` | Las operaciones del panel del docente, y con `?avisos=1` el cron del correo diario |
| `/.well-known/jwks.json` | La llave pública con la que Neon valida los tokens |
| `/db/*` | Reescritura a la Data API de Neon |
