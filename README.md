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
              └──< actividades ──< resultados_actividad
                        │
                        └──< diagnostico_secciones ──< diagnostico_preguntas

docentes ──< docente_asignaturas    ← qué dicta cada docente, y en qué periodo
mis_ramos                           ← vista: los ramos del alumno con su saldo
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
- Ni un resultado ni un movimiento tienen políticas de `update` o `delete`: no se editan nunca.
- El perfil y su primera matrícula los crea un trigger sobre `auth.users` a partir de la metadata del
  registro, así que funciona aunque la confirmación de correo esté activada y todavía no exista sesión.

La clave que va en el navegador es la **publicable**, pública por diseño. La `service role` no
aparece en el repositorio.

### Este repositorio es público

Por eso el contenido de los diagnósticos **no se versiona**: vive en `supabase/semillas/`, que está en
`.gitignore`, y en la base. Solo se versiona la estructura, en `supabase/migrations/`.

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

La configuración de Supabase está en `src/entorno.ts`. El contenido del diagnóstico ya no está en el
código: vive en la base, y su semilla en `supabase/semillas/`.

## Rutas

| Ruta | Quién entra |
|---|---|
| `/registro`, `/ingresar` | Solo sin sesión |
| `/inicio`, `/actividades`, `/diagnostico`, `/ramos`, `/perfil`, `/puntos`, `/tienda` | Alumnos |
| `/curso` | Docentes |
| `/ficha/:matriculaId` | Los dos: el alumno la suya, el docente las de sus secciones |
