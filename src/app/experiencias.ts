/** Un grupo de la pantalla: lo de una experiencia, o lo que no es de ninguna. */
export interface Grupo<T> {
  numero: number | null;
  /** «Experiencia 2 · Desarrollando colas de mensajes», o «Para empezar». */
  titulo: string;
  items: T[];
}

/**
 * Parte la lista por experiencia de aprendizaje, conservando el orden que ya traía
 * dentro de cada grupo.
 *
 * Lo que no tiene experiencia —el diagnóstico de entrada— va primero: es lo que
 * se hace antes de todo lo demás. Las experiencias van en su orden, EA1 arriba,
 * porque así se lee el semestre; la que está en curso se distingue abriéndola, no
 * moviéndola.
 */
export function agruparPorExperiencia<T extends { experiencia: number | null }>(
  items: T[],
  /** Los nombres del ramo; `nombres[0]` es la EA1. */
  nombres: string[],
): Grupo<T>[] {
  const porNumero = new Map<number | null, T[]>();
  for (const it of items) {
    const n = it.experiencia ?? null;
    const lista = porNumero.get(n);
    if (lista) lista.push(it);
    else porNumero.set(n, [it]);
  }
  return [...porNumero.entries()]
    .sort(([a], [b]) => (a ?? 0) - (b ?? 0))
    .map(([numero, lista]) => ({
      numero,
      titulo: numero === null
        ? 'Para empezar'
        : `Experiencia ${numero}${nombres[numero - 1] ? ' · ' + nombres[numero - 1] : ''}`,
      items: lista,
    }));
}

/**
 * La experiencia en curso: la más alta que ya tiene algo publicado. Es la que se
 * muestra abierta; las anteriores quedan plegadas, a un clic.
 */
export function experienciaEnCurso(grupos: Grupo<unknown>[]): number | null {
  let actual: number | null = null;
  for (const g of grupos) if (g.numero !== null && (actual === null || g.numero > actual)) actual = g.numero;
  return actual;
}
