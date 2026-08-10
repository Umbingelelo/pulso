/**
 * Configuración de Supabase.
 *
 * La clave publicable es pública por diseño: va en el navegador y no da acceso
 * a nada que las políticas de Row Level Security no permitan explícitamente.
 * No confundir con la service role key, que jamás debe llegar al cliente.
 */
export const ENTORNO = {
  supabaseUrl: 'https://ghogfosewugqnzmqemmx.supabase.co',
  supabaseKey: 'sb_publishable_qTTlxD2qUkDuAlnC6F6o8w_aQMMoWTr',
};
