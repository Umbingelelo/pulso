# Base de datos

Proyecto Supabase `ghogfosewugqnzmqemmx`, Postgres 17.

## Qué se versiona y qué no

| Carpeta | Contenido | ¿Va al repositorio? |
|---|---|---|
| `migrations/` | La **estructura**: tablas, políticas de RLS, funciones, vistas | **Sí** |
| `semillas/` | El **contenido** de los diagnósticos: preguntas, alternativas y la pauta | **No**, está en `.gitignore` |

Este repositorio es público. Un diagnóstico trae la alternativa correcta de cada
pregunta, así que su contenido no puede vivir acá. Las semillas se guardan fuera
del repo —en tu máquina y en la base— y solo se versiona la forma que las
sostiene.

Si clonas el repositorio en otra máquina, las migraciones te dejan la base
completa y vacía de contenido. Las preguntas se recuperan desde la base misma,
no desde Git.

## Aplicar las migraciones

Están numeradas y se aplican en orden. Con el CLI enlazado al proyecto:

```bash
supabase link --project-ref ghogfosewugqnzmqemmx
supabase db push
```

## El modelo

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

Las tres decisiones que sostienen todo lo demás:

**Una `matricula` es la unidad, no el perfil.** `perfiles` es la persona;
`matriculas` es «esta persona cursa esta sección». Un alumno puede tener varias
—dos asignaturas el mismo semestre, o una nueva en 2027-1— con una sola cuenta.

**Los puntos cuelgan de la matrícula.** Lo que gana en un ramo lo gasta en ese
ramo, y el semestre siguiente parte en cero sin que haya que resetear nada. Los
100 de bienvenida son por matrícula, no por cuenta.

**Una sección pertenece a (asignatura, periodo).** El código `001D` se repite
entre asignaturas y volverá a repetirse cada semestre; lo único único es la terna.
Lo mismo vale para el código de una actividad.

## Agregar una asignatura o un semestre

```sql
-- Un periodo nuevo
insert into public.periodos (codigo, nombre, inicio, fin)
values ('2027-1', 'Primer semestre 2027', '2027-03-08', '2027-07-10');

-- Una asignatura (el catálogo es transversal a los periodos: va una sola vez)
insert into public.asignaturas (sigla, nombre)
values ('XXX1234', 'Nombre de la asignatura');

-- Sus secciones en ese periodo
insert into public.secciones (asignatura_id, periodo_id, codigo)
select a.id, p.id, s.codigo
  from public.asignaturas a, public.periodos p,
       (values ('001D'), ('002D')) as s(codigo)
 where a.sigla = 'XXX1234' and p.codigo = '2027-1';

-- Y quién la dicta: sin esta fila el docente no ve la nómina
insert into public.docente_asignaturas (docente_id, asignatura_id, periodo_id)
select d.id, a.id, p.id
  from public.docentes d, public.asignaturas a, public.periodos p
 where d.nombre = 'Cristian Calderón'
   and a.sigla = 'XXX1234' and p.codigo = '2027-1';
```

Al cerrar el semestre, `periodos.activo = false`: deja de ofrecerse en el
registro, pero los alumnos siguen viendo sus ramos pasados y su historial. Lo
mismo con `activa = false` en una sección o una asignatura.

## Un diagnóstico nuevo

1. Crear la actividad, con `tipo = 'diagnostico'`:

```sql
insert into public.actividades (asignatura_id, periodo_id, codigo, titulo, descripcion, tipo, puntos, orden)
select a.id, p.id, 'diagnostico-entrada', 'Diagnóstico de entrada',
       '40 preguntas en ocho secciones, una hora.', 'diagnostico', 50, 1
  from public.asignaturas a, public.periodos p
 where a.sigla = 'XXX1234' and p.codigo = '2027-1';
```

2. Escribir el contenido en `semillas/diagnostico-<sigla>-<periodo>.sql`, con la
   forma del que ya existe: un bloque `do $mig$` que busca la actividad, borra sus
   secciones y las vuelve a insertar. Es idempotente: se puede correr de nuevo
   para corregir una pregunta.

3. Terminar la semilla llamando a `equilibrar_alternativas(v_act)`.

4. Aplicarlo. **No lo agregues al repositorio.**

### Por qué la semilla termina equilibrando

Escribiendo un cuestionario a mano uno deja la respuesta correcta casi siempre en
el mismo lugar. Medido sobre los dos diagnósticos ya escritos: el **72%** de las
correctas de DSY1107 estaba en la segunda opción y el **71%** de las de ITY1102 en
la primera. Con eso, responder todo «B» —o todo «A»— daba más del 70% sin saber
nada, y el diagnóstico dejaba de medir lo único que tiene que medir.

`equilibrar_alternativas(actividad)` las reparte entre las tres posiciones. Es
determinista, así que la semilla sigue siendo reproducible: mismo contenido, mismo
cuestionario. Después de correrla, la mejor estrategia a ciegas baja a **~39%**.

No mueve de la última posición a las alternativas comodín («ninguna», «son lo
mismo», «es al revés»), porque leerlas en el medio suena raro y delata cuál es el
relleno. Lo que no sabe es respetar listas con orden propio —una serie de códigos
HTTP, por ejemplo—: esas se reordenan **después** de llamarla, como hace la semilla
de DSY1107 con su pregunta A1.

El alumno nunca lee `diagnostico_preguntas`: no tiene política de lectura sobre
esa tabla. Entra por `diagnostico_cuestionario(matricula)`, que devuelve las
preguntas con `correcta` y `explicacion` en null, y entrega con
`rendir_diagnostico(matricula, respuestas)`, que corrige en el servidor. La pauta
recién aparece después de entregar.

## La tienda

El catálogo entró con **16 artículos por asignatura** y `precio = null`: se ven
en la vitrina marcados como «próximamente» y `solicitar_canje()` los rechaza.
Ponerles precio es un `update`:

```sql
update public.articulos a
   set precio = 150
  from public.asignaturas asg, public.periodos p
 where a.asignatura_id = asg.id and a.periodo_id = p.id
   and asg.sigla = 'DSY1107' and p.codigo = '2026-2'
   and a.codigo = 'decima-evaluacion';
```

Para calibrarlos: un alumno parte con 100 de bienvenida y suma 50 por el
diagnóstico, así que llega a la semana 2 con ~150. Si los doce laboratorios dan
50 cada uno, el techo del semestre ronda los 800.

`requiere_aprobacion` decide el flujo. En `false` el canje queda `entregado` al
instante; en `true` queda `solicitado` y espera al docente, que lo resuelve con
`resolver_canje(id, 'entregado' | 'aprobado' | 'rechazado', comentario)`. Rechazar
devuelve los puntos con un movimiento nuevo. El alumno puede echarse atrás con
`cancelar_canje(id)` mientras nadie lo haya revisado.

Otros campos que vale la pena conocer: `limite_por_alumno` (cuántas veces puede
pedirlo cada uno; `null` = sin tope), `stock` (cuántos hay en total; `null` =
ilimitado) y `activo` (sacarlo de la vitrina sin borrar los canjes ya hechos).

Al abrir el semestre siguiente, el catálogo se clona con los precios ya puestos:

```sql
select public.clonar_catalogo(
  (select id from public.asignaturas where sigla = 'DSY1107'),
  (select id from public.periodos where codigo = '2026-2'),
  (select id from public.periodos where codigo = '2027-1'));
```
