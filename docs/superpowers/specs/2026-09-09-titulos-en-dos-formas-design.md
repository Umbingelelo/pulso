# Los títulos en dos formas

Diseño · 2026-09-09

Un título de perfil se muestra bajo el nombre del alumno. Hoy hay 108 activos y **del
orden de 60 marcan género gramatical masculino**, así que a más de la mitad del curso el
juego le pone un texto que no la nombra: «El Elegido del Algoritmo», «Rey del Carrete»,
«El Compañero de Todas».

Ese «del orden de 60» es una cuenta gruesa: sale de buscar artículo masculino y una lista
de sustantivos de persona, y tiene falsos positivos —«El Plot Twist» lleva artículo
masculino porque el sustantivo prestado lo es, no porque nombre a un hombre—. El conjunto
exacto se fija en la pasada editorial, que es de todas formas donde hay que mirar cada
título uno por uno.

Este documento define cómo pasan a tener dos formas, masculina y femenina, y cómo se
elige cuál se muestra.

## Por qué la forma femenina es dato y no una regla

La tentación es derivarla: `el → la`, `-o → -a`, `-dor → -dora`. Está mal, y falla en
silencio:

| Hoy | Femenino | Qué rompe la regla |
|---|---|---|
| El Elegido del Algoritmo | La Elegida del Algoritmo | nada, este sí sale |
| El Dios del Six Seven | La Diosa del Six Seven | no es `-o → -a` |
| Rey del Carrete | Reina del Carrete | irregular |
| El Más Vio del Server | La Más Via del Server | chilenismo, ninguna regla lo cubre |
| El GOAT del Grupo | La GOAT del Grupo | sigla invariable; la regla daría «GOATa» |
| El Caballero de la Mesa | La Dama de la Mesa | no hay declinación, hay que reescribirlo |
| El Compañero de Todas | La Compañera de Todos | **el complemento también gira** |
| GOAT Según su Mamá | igual | ya es neutro y la regla lo tocaría igual |

Las dos últimas filas son las que cierran la discusión: ninguna función de texto va a
convertir «Caballero» en «Dama», ni a darse cuenta de que «de Todas» tiene que pasar a
«de Todos». Así que la forma femenina la **escribe una persona**, y el sistema solo la
guarda y la elige.

## Dos formas, y no tres

Se descartó agregar una forma neutra o inclusiva. No por desinterés: varios títulos no
tienen neutro natural —«El Dios del Six Seven» habría que reescribirlo de cero, no
declinarlo— así que serían otras ~108 decisiones editoriales, y el premio mítico del
semestre perdería la voz que tiene. Si algún día hace falta, entra como una columna más
y un valor más en el check; el diseño no lo bloquea.

También se descartó neutralizar los títulos con género y no guardar ninguna preferencia. Es la
opción más barata y la que menos maquinaria agrega, pero cuesta la voz de los títulos, que
es de lo poco del juego que los alumnos citan de memoria.

## La forma sigue a quien lleva el título, no a quien mira

Es la restricción que ordena todo el resto. En la tabla de posiciones veo el título de una
compañera, y ahí tiene que leerse en **su** forma, no en la mía. Eso descarta resolverlo en
el navegador con una preferencia local, y obliga a que la elección sea un dato del perfil
que se resuelve en cada lugar donde un título se junta con una persona.

Son cinco, verificados contra el catálogo y no contra las migraciones —que se reemplazan
entre sí—:

| Sitio | Quién lleva el título | Cómo alcanza el perfil |
|---|---|---|
| `mis_ramos` (vista) | el dueño de la matrícula | tiene `mt.perfil_id`; hay que unir `perfiles` |
| `tabla_posiciones(uuid,int)` | cada compañero de la sección | ya une `perfiles pf` |
| `mis_cosmeticos(uuid)` | el que mira | ya une `perfiles pf` |
| `mi_pase(uuid)` | el que mira | hay que alcanzar el perfil de la matrícula |
| `gacha_tirar(uuid,text)` | el que mira | idem |

## Esquema

```sql
alter table public.cosmeticos add column valor_femenino text;

alter table public.perfiles add column forma_titulo text not null default 'masculino';
alter table public.perfiles add constraint perfiles_forma_titulo_check
  check (forma_titulo in ('masculino', 'femenino'));
```

**`cosmeticos.valor_femenino` nulo significa «este título ya sirve para todos».** Cubre los
~45 que hoy son neutros, y es además la degradación elegante: un título con género cuya
forma femenina todavía no está escrita se muestra en masculino. Eso es lo que permite
desplegar el mecanismo **antes** de tener todas las formas redactadas, en vez de que sea
todo o nada.

**`forma_titulo` va en `perfiles` y no en `matriculas`** por lo mismo que el avatar: cómo
quieres que te nombren es de la persona, no del ramo. Sería absurdo que en Arquitectura te
nombren distinto que en Cloud Native.

**El default es `'masculino'`**, que es exactamente lo que hay hoy, así que aplicar la
migración no le cambia el texto a nadie que no haya pedido el cambio.

### El grant por columna no es opcional

La 0024 hizo `revoke update on public.perfiles from pulso_app` y dejó solo
`grant update (nombre)`, para cerrar la escritura directa de `perfiles.avatar` donde no se
puede rodear. Confirmado contra la base: hoy `pulso_app` solo tiene `UPDATE` sobre
`nombre`.

Entonces hace falta, explícitamente:

```sql
grant update (forma_titulo) on public.perfiles to pulso_app;
```

Sin esa línea el control de la pantalla falla con `permission denied` — y hay que agregarla
sin abrir `avatar` de vuelta, que es lo que la prueba tiene que vigilar.

## La regla, en un solo lugar

```sql
create or replace function public.titulo_texto(
  p_valor text, p_valor_femenino text, p_forma text)
returns text
language sql
immutable
as $$
  select case when p_forma = 'femenino' then coalesce(p_valor_femenino, p_valor)
              else p_valor end;
$$;
```

Los cinco sitios la llaman. El `coalesce` es lo que hace que un título sin forma femenina
no desaparezca ni salga vacío, y el `else` cubre tanto `'masculino'` como cualquier valor
que el check todavía no conozca, así que agregar una tercera forma en el futuro no puede
producir un título nulo por descuido.

Se descartaron dos alternativas:

- **Tabla `cosmetico_textos(cosmetico_id, forma, texto)`.** Extensible a N formas sin migrar
  esquema, pero agrega un join en cada uno de los cinco sitios y hoy las formas son dos.
- **Marcado en línea**, `El{la} Elegid{o|a} del Algoritmo`. Un solo campo y una sola línea
  por título, pero necesita un parser, y los irregulares —«El Caballero» → «La Dama»—
  obligan igual a escribir la alternativa completa `{El Caballero de la Mesa|La Dama de la
  Mesa}`. Es la columna con un parser encima y peor de leer.

## El contenido: un archivo aparte

El docente hoy sube los títulos desde un archivo con una línea por título:

```
001. El Dios del Six Seven — Mítico
```

Las formas femeninas van en un **archivo nuevo**, con solo las que cambian, referidas por el
mismo número:

```
001. La Diosa del Six Seven
012. La Elegida del Algoritmo
```

Y se pasa con una bandera nueva:

```bash
node neon/subir-cosmeticos.mjs --titulos titulos_perfil_rareza.txt \
  --titulos-f neon/titulos-femenino.txt [--escribir]
```

Aparte y no en la misma línea del archivo actual, por dos razones. La primera es que el
docente no tiene que re-editar 108 líneas para agregar unas sesenta. La segunda es concreta: ya hay un
título con barra —«Locked In 24/7»— y otros con comillas y con porcentajes, así que cualquier
separador puesto en la misma línea es una trampa esperando a que alguien escriba el título
que la pisa. Un archivo aparte no tiene ese problema.

Un número que no exista en el archivo de títulos es un error y no un aviso: significa que el
docente escribió una forma femenina para un título que no está, y dejarlo pasar la perdería
en silencio. Es el mismo criterio que ya usa el subidor con las rarezas desconocidas.

**Dónde vive el archivo.** Se propone `neon/titulos-femenino.txt`, dentro del repo, para que
las correcciones queden versionadas. El archivo masculino vive fuera del repo (en
`~/Downloads`), lo que es una inconsistencia real; traerlo también es una mejora aparte y no
entra en este cambio. A diferencia de las imágenes, los títulos son prosa del propio docente
y no material con derechos de terceros, así que no hay razón para mantenerlos fuera.

**Quién las escribe.** Se redactan las que hagan falta como parte de la implementación y el docente
corrige sobre el archivo. Varias son decisión de voz y no de gramática —«La Dama de la Mesa»
contra «La Reina de la Mesa»— y esas las decide él.

## La fragilidad que esto obliga a arreglar

`src/app/pase.component.ts:290` averigua cuál título llevas puesto **comparando texto**:

```ts
const mio = this.tabla().find(x => x.soy_yo)?.titulo ?? null;
this.tituloPuesto.set(
  mio ? (p?.recompensas.find(r => r.cosmetico?.valor === mio)?.cosmetico?.id ?? null) : null);
```

`mio` sale de `tabla_posiciones` y `valor` sale de `mi_pase`. Hoy los dos devuelven el mismo
texto y calza por casualidad. En cuanto existan dos formas, cualquier desacuerdo entre esos
dos sitios rompe la comparación y **el pase deja de marcar «Puesto»** para toda alumna que
elija femenino, sin error en ninguna parte: la escalera del pase simplemente se ve como si no
llevara nada puesto.

Se podría cerrar haciendo que los dos sitios coincidan siempre. Se descarta: sería sostener
un acuerdo entre dos funciones a punta de cuidado, y el que venga después no tiene cómo saber
que existe. El arreglo es dejar de comparar por texto:

- `mis_ramos` expone `titulo_id`. Es una vista, y `create or replace view` solo acepta
  columnas nuevas **al final** —«cannot change name of view column» si se mete en medio—.
- `tabla_posiciones` expone `titulo_id`. Cambia la forma que devuelve, así que hay que
  `drop function` y recrearla, **y reponer el grant**: borrar una función se lleva sus grants,
  y sin reponerlo el ranking deja de cargar en cuanto se aplica la migración. Es la lección
  que la 0025 ya dejó escrita.
- `pase.component.ts` compara por id contra `titulo_id`, y `datos.service.ts` incorpora el
  campo a los tipos que correspondan.

## La pantalla

En «Mi perfil» (`src/app/perfil.component.ts`), junto a la grilla de caras: dos botones y un
ejemplo en vivo.

```
Cómo se escriben tus títulos
[ En masculino ]  [ En femenino ]
Así se te vería: «La Elegida del Algoritmo»
Es solo cómo se escribe el texto. No cambia lo que ganaste ni lo que puedes ganar.
```

El ejemplo en vivo es lo que hace la opción evidente sin tener que explicarla. Y la pregunta
es **sobre los títulos, no sobre la persona**: no se le pide su género ni se infiere de su
nombre, que en un curso es misgendering garantizado y además un dato que el sistema no
necesita para nada más.

Al cambiarla hay que refrescar el perfil y las pantallas que muestran títulos, igual que hace
hoy `equipar_cosmetico` con la cara.

## Riesgos operativos

**La caché de esquema de la Data API.** Este cambio agrega una columna a la vista `mis_ramos` y
cambia la forma que devuelve `tabla_posiciones`. Las dos cosas la Data API las tiene cacheadas,
y —comprobado el 2026-09-08 con la 0035— `node neon/refrescar-api.mjs` **no la mueve**: el
`NOTIFY pgrst` no llegó ni por el driver HTTP ni por conexión directa, y no hay event trigger
en la base. Lo que funcionó fue dejar la base en silencio unos minutos. Consecuencia para el
plan: entre aplicar la migración y que la caché se rehaga hay una ventana, y el sitio publicado
tiene que seguir sirviendo durante toda esa ventana.

Cómo se cubre: agregar `titulo_id` **al final** de `mis_ramos` no rompe a nadie que lea las
columnas viejas, y `tabla_posiciones` agrega una columna al final de su `TABLE(...)`, que el
frontend viejo simplemente no lee. Así que el orden es: migración primero, despliegue después,
y ninguno de los dos pasos deja el sitio caído.

**El default y los datos existentes.** `forma_titulo` entra con default `'masculino'` sobre
todas las filas de `perfiles`, y `valor_femenino` entra nulo en los 108 títulos. Ninguna de las
dos cosas cambia un texto que alguien esté viendo hoy.

## Pruebas

En `neon/probar-gacha.mjs`, que ya es donde viven las pruebas de cosméticos:

1. **Los cinco sitios coinciden.** Para el mismo perfil y el mismo título puesto, `mis_ramos`,
   `tabla_posiciones`, `mis_cosmeticos`, `mi_pase` y `gacha_tirar` devuelven **el mismo texto**.
   Es la prueba que importa: la incoherencia entre dos de ellos es exactamente lo que rompe el
   pase, y es invisible mirando cada uno por separado.
2. **La forma sigue al portador.** Con la cuenta de prueba en `'femenino'` y el resto de su
   sección en el default, una sola consulta a `tabla_posiciones` tiene que devolver su fila en
   femenino y las de sus compañeros en masculino. No hace falta crear cuentas: basta con que en
   la misma respuesta convivan las dos formas, que es justo lo que ninguna preferencia guardada
   en el navegador podría lograr.

   Ojo con un detalle que si no se anota hace fallar la prueba por la razón equivocada: la cuenta
   de prueba tiene `oculto_en_ranking = true` a propósito, así que **no sale en su propia tabla de
   posiciones** hasta que se la muestre. `probar-pase-navegador.mjs` ya hace ese baile —la muestra
   al empezar y la vuelve a ocultar al final— y acá hay que hacer lo mismo.
3. **Nulo cae en masculino.** Un título con `valor_femenino` nulo se muestra igual con las dos
   formas, y nunca vacío ni nulo.
4. **El grant por columna.** `pulso_app` puede escribir `forma_titulo` y `nombre`, y **sigue sin
   poder escribir `avatar`**. Se comprueba el grant y un `update` directo, como ya se hace con el
   avatar: el botón de la pantalla no es lo que lo impide.
5. **Un valor inválido se rechaza.** El check no deja escribir `forma_titulo = 'otra'`.
6. **Todo `valor_femenino` escrito corresponde a un título que existe.** Y, como **aviso** y no
   como fallo, cuántos títulos con marca de género siguen sin forma femenina: así el mecanismo se
   puede desplegar con el archivo a medio llenar sin que la prueba quede en rojo, y el número que
   imprime dice cuánto falta.

Y una prueba de navegador nueva, `neon/probar-titulos-navegador.mjs`: cambiar la preferencia en
«Mi perfil» y ver el título cambiar en el encabezado, en el ranking, en el pase —con «Puesto»
todavía marcado, que es la regresión que se está previniendo— y en la colección.

## Fuera de alcance

- La tercera forma (neutra o inclusiva).
- Traer el archivo masculino de títulos al repo.
- Género en cualquier otro texto de la aplicación. Este cambio es solo sobre los títulos de
  perfil; los nombres de las misiones, los avisos y la prosa de las pantallas quedan como están.
- Las imágenes de avatar. No tienen texto que declinar.
