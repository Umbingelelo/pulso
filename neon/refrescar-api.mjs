/**
 * Le avisa a la Data API que el esquema cambió.
 *
 * PostgREST no consulta el catálogo en cada pedido: arma una caché del esquema
 * al arrancar. Una migración que agrega una **columna a una vista** no rompe
 * nada visible —la consulta responde 200— pero devuelve las columnas viejas, así
 * que el dato nuevo simplemente no llega y la pantalla se ve como antes de la
 * migración. Es la falla más difícil de leer que tiene este proyecto: el SQL está
 * bien, el frontend está bien, y el campo viene `undefined`.
 *
 * Corre esto después de cada migración que toque una vista o una firma de
 * función. Tarda hasta un minuto en surtir efecto; no es instantáneo.
 *
 *   set -a; . ./.env.local; set +a
 *   node neon/refrescar-api.mjs
 */
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL_OWNER;
if (!url) {
  console.error('Falta DATABASE_URL_OWNER.');
  process.exit(1);
}

await neon(url)`notify pgrst, 'reload schema'`;
console.log('Avisado. La caché se rehace en menos de un minuto.');
