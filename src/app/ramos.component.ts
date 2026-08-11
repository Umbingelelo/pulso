import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Asignatura, DatosService, Periodo, Ramo, Seccion } from './datos.service';
import { PerfilStore } from './perfil.store';

/**
 * Los ramos del alumno: cuál está mirando, y cómo agregar otro.
 *
 * Un alumno puede cursar varias asignaturas a la vez —y volver el semestre
 * siguiente por una nueva—, así que matricularse no es algo que pase solo al
 * registrarse. Se matricula solo: el RLS únicamente acepta secciones abiertas
 * de periodos abiertos.
 */
@Component({
  selector: 'app-ramos',
  imports: [FormsModule],
  template: `
    <div class="encabezado">
      <h1>Mis ramos</h1>
      <p>Cada ramo lleva sus propios puntos y sus propias actividades.</p>
    </div>

    <div class="tarjeta" style="margin-bottom:20px">
      <h2>En los que estoy</h2>

      @if (perfil.ramos().length === 0) {
        <div class="aviso dato" style="margin-top:14px">
          Todavía no estás matriculado en ningún ramo. Agrega el primero más abajo.
        </div>
      } @else {
        <table style="margin-top:14px">
          <tr>
            <th>Asignatura</th><th>Sección</th><th>Periodo</th>
            <th class="der">Puntos</th><th></th>
          </tr>
          @for (r of perfil.ramos(); track r.matricula_id) {
            <tr>
              <td>
                <strong>{{ r.sigla }}</strong>
                <div class="chico suave">{{ r.asignatura }}</div>
              </td>
              <td><span class="insignia celeste">{{ r.seccion }}</span></td>
              <td>
                {{ r.periodo }}
                @if (!r.periodo_activo) { <span class="insignia">cerrado</span> }
              </td>
              <td class="der num" style="font-weight:600">{{ r.puntos }}</td>
              <td class="der">
                @if (r.matricula_id === perfil.ramoId()) {
                  <span class="insignia verde">Estás viendo este</span>
                } @else {
                  <button class="boton contorno chico" (click)="ver(r)">Ver este</button>
                }
              </td>
            </tr>
          }
        </table>
      }
    </div>

    <div class="tarjeta">
      <h2>Agregar un ramo</h2>
      <p class="chico suave" style="margin-top:4px">
        Solo aparecen las secciones abiertas del semestre en curso.
      </p>

      @if (periodos().length === 0) {
        <div class="aviso dato" style="margin-top:14px">
          No hay periodos abiertos a matrícula en este momento.
        </div>
      } @else {
        <form (ngSubmit)="matricular()" style="margin-top:18px">
          <div class="rejilla tres">
            @if (periodos().length > 1) {
              <label>
                <span class="etiqueta">Periodo</span>
                <select name="periodo" [ngModel]="periodoId()"
                        (ngModelChange)="cambiarPeriodo($event)">
                  @for (p of periodos(); track p.id) {
                    <option [value]="p.id">{{ p.nombre }}</option>
                  }
                </select>
              </label>
            }

            <label>
              <span class="etiqueta">Asignatura</span>
              <select name="asignatura" [ngModel]="asignaturaId()"
                      (ngModelChange)="cambiarAsignatura($event)" required>
                <option value="" disabled>Selecciona una</option>
                @for (a of disponibles(); track a.id) {
                  <option [value]="a.id">{{ a.sigla }} · {{ a.nombre }}</option>
                }
              </select>
            </label>

            <label>
              <span class="etiqueta">Sección</span>
              <select name="seccion" [(ngModel)]="seccionId" required
                      [disabled]="!asignaturaId() || secciones().length === 0">
                <option value="" disabled>
                  {{ asignaturaId() ? 'Selecciona una' : 'Elige primero la asignatura' }}
                </option>
                @for (s of secciones(); track s.id) {
                  <option [value]="s.id">{{ s.codigo }}</option>
                }
              </select>
            </label>
          </div>

          @if (disponibles().length === 0 && !cargandoCatalogo()) {
            <div class="aviso dato">
              Ya estás matriculado en todas las asignaturas abiertas de este periodo.
            </div>
          }
          @if (error()) { <div class="aviso malo">{{ error() }}</div> }
          @if (hecho()) { <div class="aviso ok">{{ hecho() }}</div> }

          <button class="boton" type="submit" [disabled]="guardando() || !seccionId">
            {{ guardando() ? 'Matriculando…' : 'Matricularme' }}
          </button>
        </form>
      }
    </div>
  `,
})
export class RamosComponent {
  private datos = inject(DatosService);
  protected perfil = inject(PerfilStore);

  periodos = signal<Periodo[]>([]);
  periodoId = signal('');
  asignaturas = signal<Asignatura[]>([]);
  asignaturaId = signal('');
  secciones = signal<Seccion[]>([]);
  seccionId = '';

  cargandoCatalogo = signal(true);
  guardando = signal(false);
  error = signal('');
  hecho = signal('');

  /** Las que todavía no cursa en ese periodo: matricularse dos veces no se puede. */
  disponibles = computed(() => {
    const yaTiene = new Set(
      this.perfil.ramos()
        .filter(r => r.periodo_id === this.periodoId())
        .map(r => r.asignatura_id),
    );
    return this.asignaturas().filter(a => !yaTiene.has(a.id));
  });

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      await this.perfil.cargar();
      const periodos = await this.datos.periodos();
      this.periodos.set(periodos);
      if (periodos.length) await this.cambiarPeriodo(periodos[0].id);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar el catálogo.');
    } finally {
      this.cargandoCatalogo.set(false);
    }
  }

  async cambiarPeriodo(id: string): Promise<void> {
    this.periodoId.set(id);
    this.asignaturaId.set('');
    this.seccionId = '';
    this.secciones.set([]);
    this.asignaturas.set(id ? await this.datos.asignaturasDe(id) : []);
  }

  async cambiarAsignatura(id: string): Promise<void> {
    this.asignaturaId.set(id);
    this.seccionId = '';
    this.secciones.set([]);
    if (!id) return;
    this.secciones.set(await this.datos.secciones(id, this.periodoId()));
  }

  ver(r: Ramo): void {
    this.perfil.elegirRamo(r.matricula_id);
  }

  async matricular(): Promise<void> {
    if (!this.seccionId || this.guardando()) return;
    this.guardando.set(true);
    this.error.set('');
    this.hecho.set('');
    try {
      await this.datos.matricularme(this.seccionId);
      await this.perfil.recargarRamos();
      // Deja elegido el ramo recién agregado, que es lo que el alumno espera ver.
      const nuevo = this.perfil.ramos().find(r => r.seccion_id === this.seccionId);
      if (nuevo) this.perfil.elegirRamo(nuevo.matricula_id);
      this.hecho.set(`Listo: quedaste matriculado y ya tienes tus puntos de bienvenida.`);
      this.seccionId = '';
      this.asignaturaId.set('');
      this.secciones.set([]);
    } catch (e: any) {
      const m = (e?.message ?? '').toLowerCase();
      this.error.set(m.includes('duplicate') || m.includes('unique')
        ? 'Ya estás matriculado en esa sección.'
        : (e?.message ?? 'No se pudo completar la matrícula.'));
    } finally {
      this.guardando.set(false);
    }
  }
}
