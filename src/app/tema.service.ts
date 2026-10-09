import { DestroyRef, Injectable, inject, signal } from '@angular/core';

export type Tema = 'claro' | 'oscuro';

export const CLAVE_TEMA = 'pulso.tema';

/**
 * El color de la barra del navegador en el móvil. Son los mismos dos valores que
 * repite el script de <head> en index.html: ese corre antes que Angular para que
 * no haya un destello blanco, y por eso no puede importar nada de acá.
 */
const COLOR_BARRA: Record<Tema, string> = { claro: '#0D2679', oscuro: '#0B1224' };

/**
 * El tema de la app, claro u oscuro.
 *
 * Mientras la persona no elija, manda el del sistema (`prefers-color-scheme`) y
 * lo sigue si cambia en caliente. En cuanto aprieta el botón, su elección queda
 * guardada en localStorage y deja de mirarse el sistema: dos estados guardados
 * («claro» y «oscuro») y la ausencia de valor como «lo que diga el sistema», sin
 * un tercer botón «automático» que casi nadie necesita.
 *
 * El efecto visual no vive acá: este servicio solo pone `data-tema` en <html> y
 * los tokens de styles.css hacen el resto.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  private sistema = typeof matchMedia === 'function'
    ? matchMedia('(prefers-color-scheme: dark)')
    : null;

  /** Lo que eligió la persona, o null si todavía no ha elegido. */
  private elegido: Tema | null = leerGuardado();

  readonly tema = signal<Tema>(this.elegido ?? this.delSistema());

  constructor() {
    this.aplicar(this.tema());

    // Sin elección propia, se sigue al sistema.
    const alCambiarSistema = () => {
      if (this.elegido) return;
      this.tema.set(this.delSistema());
      this.aplicar(this.tema());
    };
    // Otra pestaña cambió el tema: esta se pone al día.
    const alCambiarAlmacen = (e: StorageEvent) => {
      if (e.key !== CLAVE_TEMA && e.key !== null) return;
      this.elegido = leerGuardado();
      this.tema.set(this.elegido ?? this.delSistema());
      this.aplicar(this.tema());
    };

    this.sistema?.addEventListener('change', alCambiarSistema);
    window.addEventListener('storage', alCambiarAlmacen);
    inject(DestroyRef).onDestroy(() => {
      this.sistema?.removeEventListener('change', alCambiarSistema);
      window.removeEventListener('storage', alCambiarAlmacen);
    });
  }

  alternar(): void {
    this.elegir(this.tema() === 'oscuro' ? 'claro' : 'oscuro');
  }

  elegir(tema: Tema): void {
    this.elegido = tema;
    guardar(tema);
    this.tema.set(tema);
    this.aplicar(tema);
  }

  private delSistema(): Tema {
    return this.sistema?.matches ? 'oscuro' : 'claro';
  }

  private aplicar(tema: Tema): void {
    const raiz = document.documentElement;
    if (raiz.getAttribute('data-tema') !== tema) {
      // Sin transiciones mientras se repinta (ver `.tema-cambiando` en styles.css).
      // Dos cuadros: en el primero el navegador aplica los colores nuevos, y recién
      // en el segundo se pueden devolver las transiciones sin que animen el cambio.
      raiz.classList.add('tema-cambiando');
      requestAnimationFrame(() => requestAnimationFrame(() => raiz.classList.remove('tema-cambiando')));
    }
    raiz.setAttribute('data-tema', tema);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOR_BARRA[tema]);
  }
}

// El almacenamiento del navegador puede estar bloqueado (modo privado, permisos):
// si falla, el tema funciona igual durante la sesión y solo se pierde la preferencia.
function leerGuardado(): Tema | null {
  try {
    const v = localStorage.getItem(CLAVE_TEMA);
    return v === 'claro' || v === 'oscuro' ? v : null;
  } catch {
    return null;
  }
}

function guardar(tema: Tema): void {
  try {
    localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    /* sin persistencia, pero el tema cambia igual */
  }
}
