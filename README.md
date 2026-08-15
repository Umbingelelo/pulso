# Pulso

Plataforma de seguimiento de alumnos para las asignaturas de **Cristian Calderón** en Duoc UC,
Escuela de Informática y Telecomunicaciones.

**Es transversal:** una sola instalación atiende todas las asignaturas que dicto, en todos los
semestres. El alumno elige la suya y su sección al registrarse, puede **agregar más ramos** con la
misma cuenta, y en cada uno acumula **puntos** que más adelante podrá canjear por elementos que lo
ayuden durante el semestre.

Por eso vive en `2026-02/Pulso`, al mismo nivel que las asignaturas y no dentro de ninguna.

- **En producción:** https://pulso-rust.vercel.app
- **Base de datos:** Supabase, organización Pulso

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
| Datos y autenticación | Supabase (Postgres 17) |
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

> **No uses `npx vercel deploy --prod`.** Se probó el 11 de agosto de 2026 y produjo un despliegue que
> respondía **404** en todas las rutas, pese a que el build en Vercel terminó bien; además se quedó
> con el alias de producción y tumbó el sitio hasta promover a mano el despliegue del push. El de la
> integración de Git, con el mismo commit, quedó correcto. Si alguna vez pasa de nuevo:
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
| `/inicio`, `/clases`, `/actividades`, `/diagnostico`, `/ramos`, `/perfil`, `/puntos`, `/tienda` | Alumnos |
| `/curso` | Docentes |
| `/ficha/:matriculaId` | Los dos: el alumno la suya, el docente las de sus secciones |

Y fuera de Angular, servidas por funciones:

| Ruta | Qué hace |
|---|---|
| `/api/auth/*` | Ingreso, registro, refresco y cierre de sesión |
| `/api/clase?id=…` | Sirve el deck de una clase, tras comprobar sesión y matrícula |
| `/api/clase-avance` | Recibe el avance dentro del deck y paga los puntos |
| `/.well-known/jwks.json` | La llave pública con la que Neon valida los tokens |
| `/db/*` | Reescritura a la Data API de Neon |
