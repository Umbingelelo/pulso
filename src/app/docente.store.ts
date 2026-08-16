import { Injectable, computed, inject, signal } from '@angular/core';
import { DatosService, RamoDocente } from './datos.service';

const CLAVE = 'pulso.ramo.docente';

/**
 * Qué ramo está mirando el docente.
 *
 * Vive aparte del componente porque ahora el panel son cuatro pantallas —resumen,
 * clases, actividades, alumnos— y todas hablan del mismo ramo. Si cada una
 * guardara su propia elección, cambiar de asignatura en una y volver a otra
 * mostraría el curso equivocado, que es la clase de error que nadie reporta y
 * todos sufren.
 *
 * La elección se recuerda entre sesiones: un docente entra a lo mismo casi
 * siempre, y volver a elegirlo cada vez es una molestia diaria.
 */
@Injectable({ providedIn: 'root' })
export class DocenteStore {
  private datos = inject(DatosService);

  ramos = signal<RamoDocente[]>([]);
  ramoId = signal<string>(localStorage.getItem(CLAVE) ?? '');
  cargando = signal(false);
  private resuelto = false;
  private enCurso: Promise<void> | null = null;

  ramo = computed(() =>
    this.ramos().find(r => this.clave(r) === this.ramoId()) ?? this.ramos()[0] ?? null);

  clave(r: RamoDocente): string {
    return `${r.asignatura_id}|${r.periodo_id}`;
  }

  async cargar(forzar = false): Promise<void> {
    if (this.resuelto && !forzar) return;
    if (this.enCurso && !forzar) return this.enCurso;
    this.cargando.set(true);
    this.enCurso = (async () => {
      try {
        const ramos = await this.datos.ramosQueDicto();
        this.ramos.set(ramos);
        // Si lo guardado ya no existe —cambió de asignatura o de semestre— se cae
        // al primero en vez de dejar la pantalla en blanco.
        if (!ramos.some(r => this.clave(r) === this.ramoId()) && ramos.length) {
          this.elegir(this.clave(ramos[0]));
        }
        this.resuelto = true;
      } finally {
        this.cargando.set(false);
        this.enCurso = null;
      }
    })();
    return this.enCurso;
  }

  elegir(clave: string): void {
    this.ramoId.set(clave);
    localStorage.setItem(CLAVE, clave);
  }
}
