# Pulso

Plataforma de seguimiento de alumnos para las asignaturas de **Cristian Calderón** en Duoc UC,
Escuela de Informática y Telecomunicaciones.

**Es transversal:** una sola instalación atiende todas las asignaturas que dicto. El alumno elige la
suya y su sección al registrarse, y desde ahí acumula **puntos** que más adelante podrá canjear por
elementos que lo ayuden durante el semestre.

Por eso vive en `2026-02/Pulso`, al mismo nivel que las asignaturas y no dentro de ninguna.

- **En producción:** https://pulso-rust.vercel.app
- **Base de datos:** Supabase, organización Pulso

## Estado

**v1 — registro, actividades y puntos.** Lo que funciona hoy:

- Registro con nombre, correo institucional, contraseña, asignatura y sección
- Inicio de sesión y elección de avatar
- 100 puntos de bienvenida, otorgados por el servidor
- **Diagnóstico de entrada**: 40 preguntas en ocho secciones, se rinde una sola vez, se corrige solo
  y suma 50 puntos
- **Vista de docente**: nómina por sección, promedios del diagnóstico y otorgar o descontar puntos

En la hoja de ruta: avance por laboratorio, planes de estudio personales y la tienda de canje.

## Stack

| | |
|---|---|
| Frontend | Angular 20, componentes autónomos y señales |
| Datos y autenticación | Supabase (Postgres 17) |
| Avatares | DiceBear, generados en el navegador |
| Despliegue | Vercel |

## Modelo de datos

```
asignaturas ──< secciones ──< perfiles ──< movimientos_puntos
                  │                             │
                  │                       saldos_puntos (vista)
                  │
actividades ──< resultados_actividad

docentes            ← quién puede ver el curso completo y otorgar puntos
resumen_alumnos     ← vista: perfil + sección + saldo
```

`perfiles` tiene una fila por usuario de `auth.users`. Los puntos viven en un **libro de
movimientos**: solo se agregan, nunca se editan, y el saldo es la suma. Así todo queda auditable y la
tienda de canje podrá descontar sin perder la historia.

## Seguridad

Todo se apoya en Row Level Security, no en validaciones del cliente:

- **Catálogo** (`asignaturas`, `secciones`): lectura pública, porque los desplegables se llenan antes
  de iniciar sesión.
- **Perfil**: cada alumno lee y modifica solo el propio.
- **Puntos**: el alumno **lee** sus movimientos y nunca los escribe. No existe política de `insert`
  para él, así que un intento desde el cliente recibe `403`.
- **Actividades**: el alumno registra su propio resultado, una sola vez —lo garantiza una restricción
  única— y no puede editarlo después. No hay políticas de `update` ni `delete`.
- **Otorgar puntos** es del servidor: funciones `security definer` con el `execute` revocado para
  `anon` y `authenticated`, más el docente, que sí puede insertar movimientos.
- El perfil lo crea un trigger sobre `auth.users` a partir de la metadata del registro, así que
  funciona aunque la confirmación de correo esté activada y todavía no exista sesión.

La clave que va en el navegador es la **publicable**, pública por diseño. La `service role` no
aparece en el repositorio.

## Agregar una asignatura

El desplegable del registro se llena desde la base, así que no hay que tocar código:

```sql
insert into public.asignaturas (sigla, nombre)
values ('XXX1234', 'Nombre de la asignatura');

insert into public.secciones (asignatura_id, codigo)
select a.id, s.codigo
from public.asignaturas a
cross join (values ('001D'), ('002D')) as s(codigo)
where a.sigla = 'XXX1234';
```

Para dar de baja una sección o una asignatura, `activa = false`: deja de aparecer en el desplegable
sin romper los perfiles que ya la eligieron.

## Desarrollo

```bash
npm install
npm start          # http://localhost:4200
npm run build
npx vercel deploy --prod
```

La configuración de Supabase está en `src/entorno.ts`. El contenido del diagnóstico, en
`src/app/diagnostico.datos.ts`.

## Rutas

| Ruta | Quién entra |
|---|---|
| `/registro`, `/ingresar` | Solo sin sesión |
| `/inicio`, `/actividades`, `/diagnostico`, `/perfil`, `/puntos` | Alumnos |
| `/curso` | Docentes |
