import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClaseDocente, DatosService } from './datos.service';
import { DocenteStore } from './docente.store';
import { aIso, aLocal } from './fechas';

/**
 * Las clases del ramo: cuándo se habilita cada una y hasta cuándo vale completa.
 *
 * Las horas se muestran y se escriben en la del computador del docente. La
 * conversión a UTC la hace el navegador, que sabe del cambio de horario de
 * septiembre; escribir el desfase a mano es la vía rápida para que una clase se
 * habilite una hora antes o después sin que nadie lo note.
 */
@Component({
  selector: 'app-docente-clases',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="encabezado">
      <h1>Clases</h1>
      <p>{{ docente.ramo()?.asignatura ?? 'Horario y ventana de cada clase.' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (clases().length === 0) {
      <div class="tarjeta">
        <div class="aviso dato">
          No hay clases cargadas en este ramo. Se suben con
          <code>neon/subir-clase.mjs</code> desde la carpeta de la asignatura.
        </div>
      </div>
    } @else {
      @if (hecho()) { <div class="aviso ok" style="margin-bottom:14px">{{ hecho() }}</div> }

      <div class="tarjeta">
        <p class="chico suave" style="margin:0 0 14px">
          Pasada la ventana los puntos se multiplican por el factor, para premiar a
          quien la vio antes o durante la sesión sin dejar en cero a quien la repasa
          después.
        </p>
        <table>
          <tr>
            <th>Clase</th><th>Estado</th><th class="der">Abrieron</th>
            <th class="der">A tiempo</th><th class="der">Terminaron</th><th></th>
          </tr>
          @for (c of clases(); track c.id) {
            <tr>
              <td>
                <strong>{{ c.codigo }}</strong> · {{ c.titulo }}
                <div class="chico suave">
                  {{ c.slides }} diapositivas · {{ c.actividades }} actividades ·
                  hasta {{ maximo(c) }} puntos
                  @if (c.dictada_el) { · dictada {{ c.dictada_el | date:'dd/MM' }} }
                </div>
              </td>
              <td>
                @if (!c.publicada) {
                  <span class="insignia amarilla">
                    {{ c.publicada_desde ? 'Programada' : 'Oculta' }}
                  </span>
                  @if (c.publicada_desde) {
                    <div class="chico suave">{{ c.publicada_desde | date:'dd/MM HH:mm' }}</div>
                  }
                } @else if (c.en_ventana) {
                  <span class="insignia verde">En ventana</span>
                  <div class="chico suave">
                    {{ c.ventana_hasta ? ('cierra ' + (c.ventana_hasta | date:'dd/MM HH:mm')) : 'sin plazo' }}
                  </div>
                } @else {
                  <span class="insignia">Fuera de plazo</span>
                  <div class="chico suave">paga ×{{ c.factor_atrasado }}</div>
                }
              </td>
              <td class="der num">{{ c.abrieron }}</td>
              <td class="der num">{{ c.a_tiempo }}</td>
              <td class="der num">{{ c.terminaron }}</td>
              <td class="der">
                <button class="boton contorno chico" (click)="editar(c)">
                  {{ editando()?.id === c.id ? 'Cerrar' : 'Programar' }}
                </button>
              </td>
            </tr>
          }
        </table>
      </div>

      @if (editando(); as c) {
        <div class="tarjeta" style="margin-top:18px">
          <h2>{{ c.codigo }} · {{ c.titulo }}</h2>
          <p class="chico suave" style="margin:2px 0 16px">
            Las horas son las de tu computador. Deja «se habilita» en blanco para
            ocultarla del todo, y «vale completa hasta» en blanco para que no caduque.
          </p>

          <div class="rejilla dos">
            <label>
              <span class="etiqueta">Se habilita</span>
              <input type="datetime-local" [(ngModel)]="fDesde" name="fDesde">
            </label>
            <label>
              <span class="etiqueta">Vale completa hasta</span>
              <input type="datetime-local" [(ngModel)]="fHasta" name="fHasta">
            </label>
          </div>

          <div class="rejilla dos" style="margin-top:4px">
            <label>
              <span class="etiqueta">Después paga</span>
              <select [(ngModel)]="fFactor" name="fFactor">
                <option [ngValue]="1">todo igual (sin castigo)</option>
                <option [ngValue]="0.75">el 75%</option>
                <option [ngValue]="0.5">la mitad</option>
                <option [ngValue]="0.25">un cuarto</option>
                <option [ngValue]="0">nada</option>
              </select>
            </label>
            <div>
              <span class="etiqueta">Puntos por tramo</span>
              <div style="display:flex;gap:8px">
                <input type="number" min="0" [(ngModel)]="fAbrir" name="fAbrir" title="Abrir">
                <input type="number" min="0" [(ngModel)]="fActividad" name="fActividad" title="Cada actividad">
                <input type="number" min="0" [(ngModel)]="fTerminar" name="fTerminar" title="Terminar">
              </div>
              <div class="chico suave" style="margin-top:6px">abrir · actividad · terminar</div>
            </div>
          </div>

          @if (error()) { <div class="aviso malo" style="margin-top:12px">{{ error() }}</div> }

          <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
            <button class="boton chico" (click)="guardar()" [disabled]="guardando()">
              {{ guardando() ? 'Guardando…' : 'Guardar' }}
            </button>
            <button class="boton contorno chico" (click)="habilitarAhora()" [disabled]="guardando()">
              Habilitar ahora
            </button>
            <button class="boton contorno chico" (click)="editando.set(null)">Cancelar</button>
          </div>
        </div>
      }
    }
  `,
})
export class DocenteClasesComponent {
  private datos = inject(DatosService);
  protected docente = inject(DocenteStore);

  clases = signal<ClaseDocente[]>([]);
  editando = signal<ClaseDocente | null>(null);
  cargando = signal(true);
  guardando = signal(false);
  error = signal('');
  hecho = signal('');

  fDesde = '';
  fHasta = '';
  fFactor = 0.5;
  fAbrir = 25;
  fActividad = 10;
  fTerminar = 55;

  constructor() {
    this.cargar();
  }

  maximo(c: ClaseDocente): number {
    return c.puntos_abrir + c.actividades * c.puntos_actividad + c.puntos_terminar;
  }

  // `aLocal` y `aIso` viven en `fechas.ts`: el panel de actividades programa el
  // plazo de los puntos con las mismas dos conversiones.
  private aLocal = aLocal;
  private aIso = aIso;

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      await this.docente.cargar();
      const r = this.docente.ramo();
      if (!r) return;
      this.clases.set(await this.datos.clasesQueDicto(r.asignatura_id, r.periodo_id));
      const id = this.editando()?.id;
      if (id) this.editando.set(this.clases().find(c => c.id === id) ?? null);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudieron cargar las clases.');
    } finally {
      this.cargando.set(false);
    }
  }

  editar(c: ClaseDocente): void {
    if (this.editando()?.id === c.id) { this.editando.set(null); return; }
    this.error.set(''); this.hecho.set('');
    this.editando.set(c);
    this.fDesde = this.aLocal(c.publicada_desde);
    this.fHasta = this.aLocal(c.ventana_hasta);
    this.fFactor = Number(c.factor_atrasado);
    this.fAbrir = c.puntos_abrir;
    this.fActividad = c.puntos_actividad;
    this.fTerminar = c.puntos_terminar;
  }

  async guardar(): Promise<void> {
    const c = this.editando();
    if (!c || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(''); this.hecho.set('');
    try {
      await this.datos.programarClase({
        claseId: c.id,
        publicadaDesde: this.aIso(this.fDesde),
        ventanaHasta: this.aIso(this.fHasta),
        factorAtrasado: this.fFactor,
        puntosAbrir: this.fAbrir,
        puntosActividad: this.fActividad,
        puntosTerminar: this.fTerminar,
      });
      await this.cargar();
      this.hecho.set(`${c.codigo} quedó programada.`);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo programar la clase.');
    } finally {
      this.guardando.set(false);
    }
  }

  /**
   * El atajo del día de clase: se habilita ahora y la ventana cierra al terminar
   * el bloque. Noventa minutos cubren un bloque de 129 con holgura para quien la
   * abre apenas termina.
   */
  habilitarAhora(): void {
    const ahora = new Date();
    this.fDesde = this.aLocal(ahora.toISOString());
    this.fHasta = this.aLocal(new Date(ahora.getTime() + 90 * 60000).toISOString());
    this.guardar();
  }
}
