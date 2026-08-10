import { Injectable, inject, signal } from '@angular/core';
import { DatosService, Perfil } from './datos.service';

export type PerfilCompleto = Perfil & { seccion: string; asignatura: string };

/**
 * Guarda el perfil una sola vez para que la barra lateral y las páginas no
 * lo pidan por separado en cada navegación.
 */
@Injectable({ providedIn: 'root' })
export class PerfilStore {
  private datos = inject(DatosService);

  readonly perfil = signal<PerfilCompleto | null>(null);
  readonly cargando = signal(false);
  readonly error = signal('');

  async cargar(forzar = false): Promise<void> {
    if (this.perfil() && !forzar) return;
    this.cargando.set(true);
    this.error.set('');
    try {
      this.perfil.set(await this.datos.miPerfil());
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar tu perfil.');
    } finally {
      this.cargando.set(false);
    }
  }

  limpiar(): void {
    this.perfil.set(null);
  }
}
