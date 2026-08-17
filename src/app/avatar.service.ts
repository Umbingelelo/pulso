import { Injectable } from '@angular/core';
import { createAvatar, Style } from '@dicebear/core';
import { adventurer, bottts, funEmoji, notionists, thumbs } from '@dicebear/collection';

/**
 * Avatares con DiceBear. Se generan en el navegador —no hay llamadas a ninguna
 * API externa ni imágenes que subir— y son deterministas: la misma clave produce
 * siempre el mismo dibujo, así que basta guardar el texto "estilo:semilla".
 *
 * Estilos usados y sus autores (varios son CC BY 4.0 y piden atribución):
 *   thumbs      — DiceBear, CC0 1.0
 *   adventurer  — Lisa Wischofsky, CC BY 4.0
 *   bottts      — Pablo Stanley, CC BY 4.0
 *   notionists  — Zoish, CC BY 4.0
 *   funEmoji    — Davis Uche, CC BY 4.0
 */
// Style<any> a propósito: cada estilo declara sus propias opciones y TypeScript
// no puede unificarlas en un solo tipo.
const ESTILOS: Record<string, Style<any>> = { thumbs, adventurer, bottts, notionists, funEmoji };

export const ESTILOS_DISPONIBLES = Object.keys(ESTILOS);

export const AVATAR_POR_DEFECTO = 'thumbs:inicial';

/**
 * Si lo guardado es una imagen subida y no un dibujo de DiceBear.
 *
 * Se mira el `https://` y no la extensión: las URL de Blob traen la ruta completa
 * y a veces parámetros, y un `.jpg` al final no está garantizado.
 */
export function esImagenSubida(clave: string): boolean {
  return typeof clave === 'string' && clave.startsWith('https://');
}

@Injectable({ providedIn: 'root' })
export class AvatarService {
  private cache = new Map<string, string>();

  /**
   * El `src` de un `<img>` para lo que sea que tenga guardado el alumno.
   *
   * Desde que las caras se ganan en el gacha, `perfiles.avatar` guarda **la URL de
   * una imagen subida**. Pero los alumnos que se registraron antes tienen ahí un
   * `"estilo:semilla"` de DiceBear, y esos siguen dibujándose: quitarles la cara de
   * golpe los dejaría con un cuadro vacío hasta que se ganaran una, que es un
   * castigo por haber llegado temprano.
   *
   * Lo que **ya no se puede** es elegir uno nuevo de DiceBear: eso lo cierra un
   * grant por columna en la base, no esta función.
   */
  imagen(clave: string, tamano = 96): string {
    if (esImagenSubida(clave)) return clave;

    const memo = `${clave}|${tamano}`;
    const guardado = this.cache.get(memo);
    if (guardado) return guardado;

    const corte = clave.indexOf(':');
    const estilo = corte > 0 ? clave.slice(0, corte) : 'thumbs';
    const semilla = corte > 0 ? clave.slice(corte + 1) : clave;
    const coleccion = ESTILOS[estilo] ?? thumbs;

    const uri = createAvatar(coleccion, {
      seed: semilla,
      size: tamano,
      radius: 50,
      backgroundColor: ['e8f7fe', 'ffffff', 'eef2ff'],
    }).toDataUri();

    this.cache.set(memo, uri);
    return uri;
  }

  /**
   * Propone una galería para elegir. Reparte las semillas entre los estilos para
   * que la grilla se vea variada en vez de cinco versiones de lo mismo.
   */
  galeria(base: string, cantidad = 20): string[] {
    const limpio = (base || 'pulso').trim().toLowerCase() || 'pulso';
    const claves: string[] = [];
    for (let i = 0; i < cantidad; i++) {
      const estilo = ESTILOS_DISPONIBLES[i % ESTILOS_DISPONIBLES.length];
      claves.push(`${estilo}:${limpio}-${Math.floor(i / ESTILOS_DISPONIBLES.length) + 1}-${i}`);
    }
    return claves;
  }
}
