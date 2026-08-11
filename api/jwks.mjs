/**
 * El JWKS público, servido en /.well-known/jwks.json por una reescritura.
 *
 * Neon lo lee desde sus servidores para validar la firma de los tokens de
 * acceso. Solo va la llave pública: la privada vive en una variable de entorno.
 */
export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Diez minutos: suficiente para que Neon no pregunte en cada petición, y poco
  // para poder rotar la llave sin esperar un día.
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.end(JSON.stringify({ keys: [JSON.parse(process.env.JWK_PUBLICA)] }));
}
