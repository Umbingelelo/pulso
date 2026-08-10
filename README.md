# Pulso

Plataforma de seguimiento de alumnos para las asignaturas de **Cristian Calderón** en Duoc UC,
Escuela de Informática y Telecomunicaciones.

El alumno se registra indicando su asignatura y sección, y desde ese momento acumula **puntos** que
más adelante podrá canjear por elementos que lo ayuden durante el semestre.

## Estado

**v1 — registro, ingreso y puntos.** Lo que funciona hoy:

- Registro con nombre, correo institucional, contraseña, asignatura y sección
- Inicio de sesión
- 100 puntos de bienvenida al registrarse, otorgados por el servidor
- Vista con el saldo y el detalle de movimientos

En la hoja de ruta: avance por laboratorio, planes de estudio personales y la tienda de canje.

## Stack

| | |
|---|---|
| Frontend | Angular 20, componentes autónomos y señales |
| Datos y autenticación | Supabase (Postgres 17) |
| Despliegue | Vercel |

## Modelo de datos

```
asignaturas ──< secciones ──< perfiles ──< movimientos_puntos
                                              │
                                        saldos_puntos (vista)
```

`perfiles` tiene una fila por usuario de `auth.users`. Los puntos viven en un **libro de
movimientos**: solo se agregan, nunca se editan, y el saldo es la suma. Así todo movimiento queda
auditable y la tienda de canje podrá descontar sin perder la historia.

## Seguridad

Todo se apoya en Row Level Security, no en validaciones del cliente:

- **Catálogo** (`asignaturas`, `secciones`): lectura pública. Los desplegables se llenan antes de
  iniciar sesión.
- **Perfil**: cada alumno lee y modifica solo el propio.
- **Puntos**: el alumno **lee** sus movimientos y nunca los escribe. No existe política de `insert`,
  así que un intento desde el cliente recibe `403`.
- **Otorgar puntos** es responsabilidad del servidor, mediante funciones `security definer` con el
  `execute` revocado para `anon` y `authenticated`. Nadie puede llamarlas desde la API.
- El perfil lo crea un trigger sobre `auth.users` a partir de la metadata del registro, así que
  funciona aunque la confirmación de correo esté activada y todavía no exista sesión.

La clave que va en el navegador es la **publicable**, pública por diseño: no da acceso a nada que las
políticas no permitan. La `service role` no aparece en el repositorio.

## Desarrollo

```bash
npm install
npm start          # http://localhost:4200
npm run build
```

La configuración de Supabase está en `src/entorno.ts`.

## Rutas

| Ruta | Quién entra |
|---|---|
| `/registro` | Solo sin sesión |
| `/ingresar` | Solo sin sesión |
| `/inicio` | Solo con sesión |
