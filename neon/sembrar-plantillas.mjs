/**
 * Lleva las mecánicas que están en código a la tabla `mision_plantillas`.
 *
 * La definición vive en `lib/mecanicas/*.mjs` —ahí están el esquema, la
 * instrucción y el validador, que son código— y esto la copia a la base, que es
 * de donde la lee la aplicación. Así el docente puede desactivar una mecánica o
 * cambiarle los puntos sin un despliegue, y el comportamiento sigue versionado.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/sembrar-plantillas.mjs
 */
import { neon } from '@neondatabase/serverless';
import { MECANICAS } from '../lib/misiones.mjs';

const sql = neon(process.env.DATABASE_URL_OWNER);

for (const [codigo, m] of Object.entries(MECANICAS)) {
  // La instrucción se guarda como plantilla de ejemplo, con un contexto ficticio:
  // sirve para que el docente vea qué se le pide al modelo. La que se usa de
  // verdad se arma en código con el término del día.
  const ejemplo = m.instruccion({
    termino: '{término}', definicion: '{definición del banco}',
    asignatura: '{asignatura}', fuente: '{clase}',
  });

  const [fila] = await sql`
    insert into public.mision_plantillas (codigo, nombre, mecanica, banda, instruccion, esquema, xp, activa, orden)
    values (${codigo}, ${m.nombre}, ${m.mecanica}, ${m.banda},
            ${ejemplo}, ${JSON.stringify(m.esquema)}::jsonb, ${m.xp}, true, 1)
    on conflict (codigo) do update
      set nombre = excluded.nombre, mecanica = excluded.mecanica, banda = excluded.banda,
          instruccion = excluded.instruccion, esquema = excluded.esquema
    returning codigo, nombre, banda, xp, activa`;
  console.log('sembrada:', fila);
}
