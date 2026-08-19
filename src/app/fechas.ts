/**
 * Las dos conversiones que necesita un `<input type="datetime-local">`.
 *
 * Vivían dentro de `docente-clases.component.ts`, que fue el primero en programar
 * fechas. Ahora el panel de actividades hace lo mismo con el plazo de los puntos,
 * y duplicar esto es duplicar el error que ya se cometió una vez: un
 * `datetime-local` habla **hora local sin zona**, así que cortar un ISO en el
 * carácter 16 muestra una clase de las 08:31 a las 12:31.
 */

/**
 * ISO (UTC) → el valor que espera un `datetime-local`, que es hora local sin zona.
 * Restar el desfase antes de cortar la cadena es lo que evita el corrimiento.
 */
export function aLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Lo que escribió el docente → ISO con zona, o `null` si dejó el campo vacío. */
export function aIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * El lunes 00:00 y el domingo 23:59 de la semana en que cae `referencia`, en el
 * formato del `datetime-local`.
 *
 * Es el atajo del caso normal: los laboratorios de una semana dan puntos esa
 * semana, y escribir dos fechas a mano cada vez es donde se equivoca uno. La
 * semana empieza el lunes porque así se dictan las clases; `getDay()` devuelve 0
 * para el domingo, y ese `|| 7` es lo que evita que el domingo salte a la semana
 * siguiente.
 */
export function semanaDe(referencia: Date): { desde: string; hasta: string } {
  const lunes = new Date(referencia);
  lunes.setHours(0, 0, 0, 0);
  lunes.setDate(lunes.getDate() - ((lunes.getDay() || 7) - 1));

  const domingo = new Date(lunes);
  domingo.setDate(domingo.getDate() + 6);
  domingo.setHours(23, 59, 0, 0);

  return { desde: aLocal(lunes.toISOString()), hasta: aLocal(domingo.toISOString()) };
}
