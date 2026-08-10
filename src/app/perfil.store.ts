import { Injectable, inject, signal } from '@angular/core';
import { DatosService, Perfil } from './datos.service';

export type PerfilCompleto = Perfil & { seccion: string; asignatura: string };

/**
 * Estado de sesión compartido: perfil del alumno o condición de docente.
 * Se resuelve una vez para que la barra lateral, los guards y las páginas no
 * pregunten por separado en cada navegación.
 */
@Injectable({ providedIn: 'root' })
export class PerfilStore {
  private datos = inject(DatosService);

  readonly perfil = signal<PerfilCompleto | null>(null);
  readonly esDocente = signal(false);
  readonly cargando = signal(false);
  readonly resuelto = signal(false);
  readonly error = signal('');

  private enCurso: Promise<void> | null = null;

  async cargar(forzar = false): Promise<void> {
    if (this.resuelto() && !forzar) return;
    if (this.enCurso && !forzar) return this.enCurso;

    this.cargando.set(true);
    this.error.set('');

    this.enCurso = (async () => {
      try {
        const docente = await this.datos.esDocente();
        this.esDocente.set(docente);
        // Un docente no tiene perfil de alumno: no tiene sección.
        this.perfil.set(docente ? null : await this.datos.miPerfil());
        this.resuelto.set(true);
      } catch (e: any) {
        this.error.set(e?.message ?? 'No se pudo cargar tu sesión.');
      } finally {
        this.cargando.set(false);
        this.enCurso = null;
      }
    })();

    return this.enCurso;
  }

  limpiar(): void {
    this.perfil.set(null);
    this.esDocente.set(false);
    this.resuelto.set(false);
  }

  get nombre(): string {
    return this.perfil()?.nombre ?? (this.esDocente() ? 'Docente' : '');
  }
}
