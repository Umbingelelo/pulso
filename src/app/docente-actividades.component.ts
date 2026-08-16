import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActividadDocente, DatosService } from './datos.service';
import { DocenteStore } from './docente.store';

/**
 * Laboratorios, entregas y el diagnóstico: crearlos y editarlos.
 *
 * Una actividad con entregas no se borra ni cambia de tipo. Borrarla se llevaría
 * por delante los resultados de los alumnos y los puntos que ya se pagaron —el
 * libro de movimientos no se edita nunca— así que lo que hay es desactivarla:
 * deja de aparecer y lo hecho queda.
 */
@Component({
  selector: 'app-docente-actividades',
  imports: [FormsModule],
  template: `
    <div class="encabezado">
      <h1>Actividades y laboratorios</h1>
      <p>{{ docente.ramo()?.asignatura ?? 'Lo que el alumno tiene que entregar.' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else {
      @if (hecho()) { <div class="aviso ok" style="margin-bottom:14px">{{ hecho() }}</div> }
      @if (error()) { <div class="aviso malo" style="margin-bottom:14px">{{ error() }}</div> }

      <div class="tarjeta">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
          <h2>{{ lista().length }} actividades</h2>
          <button class="boton chico" (click)="nueva()">Crear una</button>
        </div>

        @if (lista().length === 0) {
          <div class="aviso dato" style="margin-top:14px">
            Este ramo todavía no tiene actividades. Los laboratorios que crees acá
            aparecen en la pantalla de Actividades de tus alumnos.
          </div>
        } @else {
          <table style="margin-top:14px">
            <tr>
              <th>Código</th><th>Actividad</th><th>Tipo</th>
              <th class="der">Puntos</th><th class="der">Entregas</th><th></th>
            </tr>
            @for (a of lista(); track a.id) {
              <tr [style.opacity]="a.activa ? 1 : .5">
                <td class="num">{{ a.codigo }}</td>
                <td>
                  {{ a.titulo }}
                  @if (!a.activa) { <span class="insignia" style="margin-left:6px">Oculta</span> }
                  @if (a.descripcion) { <div class="chico suave">{{ a.descripcion }}</div> }
                </td>
                <td>{{ etiqueta(a.tipo) }}</td>
                <td class="der num">{{ a.puntos }}</td>
                <td class="der num">{{ a.entregas }}</td>
                <td class="der">
                  <button class="boton contorno chico" (click)="editar(a)">
                    {{ form().id === a.id ? 'Cerrar' : 'Editar' }}
                  </button>
                </td>
              </tr>
            }
          </table>
        }
      </div>

      @if (abierto()) {
        <div class="tarjeta" style="margin-top:18px">
          <h2>{{ form().id ? 'Editar actividad' : 'Nueva actividad' }}</h2>

          <div class="rejilla dos" style="margin-top:16px">
            <label>
              <span class="etiqueta">Código</span>
              <!-- Lectura simple y escritura por tocar(). Un enlace de dos vías
                   sobre la propiedad del objeto lo mutaría sin avisarle a la
                   señal, y la pantalla no se enteraría del cambio. -->
              <input [ngModel]="form().codigo" name="codigo" placeholder="LAB1"
                     (ngModelChange)="tocar('codigo', $event)">
            </label>
            <label>
              <span class="etiqueta">Tipo</span>
              <select [ngModel]="form().tipo" name="tipo" (ngModelChange)="tocar('tipo', $event)"
                      [disabled]="!!form().id && entregasDelAbierto() > 0">
                <option value="laboratorio">Laboratorio</option>
                <option value="entrega">Entrega</option>
                <option value="diagnostico">Diagnóstico</option>
              </select>
            </label>
          </div>

          <label>
            <span class="etiqueta">Título</span>
            <input [ngModel]="form().titulo" name="titulo" (ngModelChange)="tocar('titulo', $event)"
                   placeholder="Laboratorio 1 · levantar un endpoint">
          </label>

          <label>
            <span class="etiqueta">Descripción</span>
            <input [ngModel]="form().descripcion" name="desc" (ngModelChange)="tocar('descripcion', $event)"
                   placeholder="Qué tiene que hacer el alumno, en una línea">
          </label>

          <div class="rejilla dos">
            <label>
              <span class="etiqueta">Puntos</span>
              <input type="number" min="0" [ngModel]="form().puntos" name="puntos"
                     (ngModelChange)="tocar('puntos', +$event)">
            </label>
            <label>
              <span class="etiqueta">Orden</span>
              <input type="number" min="0" [ngModel]="form().orden" name="orden"
                     (ngModelChange)="tocar('orden', +$event)">
            </label>
          </div>

          <label style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <input type="checkbox" [ngModel]="form().activa" name="activa" style="width:auto"
                   (ngModelChange)="tocar('activa', $event)">
            <span class="chico">Visible para los alumnos</span>
          </label>

          @if (form().id && entregasDelAbierto() > 0) {
            <div class="aviso dato" style="margin-top:14px">
              Ya tiene {{ entregasDelAbierto() }} entregas, así que no se puede cambiar de tipo.
              Si ya no corresponde, desmárcala como visible: lo entregado se conserva.
            </div>
          }

          <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
            <button class="boton" [disabled]="guardando() || !completo()" (click)="guardar()">
              {{ guardando() ? 'Guardando…' : 'Guardar' }}
            </button>
            <button class="boton contorno" (click)="abierto.set(false)">Cancelar</button>
          </div>
        </div>
      }
    }
  `,
})
export class DocenteActividadesComponent {
  private datos = inject(DatosService);
  protected docente = inject(DocenteStore);

  lista = signal<ActividadDocente[]>([]);
  abierto = signal(false);
  cargando = signal(true);
  guardando = signal(false);
  error = signal('');
  hecho = signal('');

  form = signal<{
    id: string | null; codigo: string; titulo: string; descripcion: string;
    tipo: string; puntos: number; orden: number; activa: boolean;
  }>(this.vacio());

  entregasDelAbierto = computed(() =>
    this.lista().find(a => a.id === this.form().id)?.entregas ?? 0);

  constructor() {
    this.cargar();
  }

  private vacio() {
    return { id: null, codigo: '', titulo: '', descripcion: '',
             tipo: 'laboratorio', puntos: 100, orden: 0, activa: true };
  }

  etiqueta(t: string): string {
    return t === 'diagnostico' ? 'Diagnóstico' : t === 'laboratorio' ? 'Laboratorio' : 'Entrega';
  }

  completo(): boolean {
    const f = this.form();
    return f.codigo.trim().length > 0 && f.titulo.trim().length > 2;
  }

  /** Las señales son inmutables: se reemplaza el objeto, no se muta un campo. */
  tocar(campo: string, valor: any): void {
    this.form.set({ ...this.form(), [campo]: valor });
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      await this.docente.cargar();
      const r = this.docente.ramo();
      if (!r) return;
      this.lista.set(await this.datos.actividadesQueDicto(r.asignatura_id, r.periodo_id));
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudieron cargar las actividades.');
    } finally {
      this.cargando.set(false);
    }
  }

  nueva(): void {
    const siguiente = Math.max(0, ...this.lista().map(a => a.orden)) + 1;
    this.form.set({ ...this.vacio(), orden: siguiente });
    this.abierto.set(true);
    this.error.set(''); this.hecho.set('');
  }

  editar(a: ActividadDocente): void {
    if (this.form().id === a.id && this.abierto()) { this.abierto.set(false); return; }
    this.form.set({
      id: a.id, codigo: a.codigo, titulo: a.titulo, descripcion: a.descripcion ?? '',
      tipo: a.tipo, puntos: a.puntos, orden: a.orden, activa: a.activa,
    });
    this.abierto.set(true);
    this.error.set(''); this.hecho.set('');
  }

  async guardar(): Promise<void> {
    const r = this.docente.ramo();
    if (!r || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(''); this.hecho.set('');
    try {
      const f = this.form();
      await this.datos.guardarActividad({
        id: f.id, asignaturaId: r.asignatura_id, periodoId: r.periodo_id,
        codigo: f.codigo, titulo: f.titulo,
        descripcion: f.descripcion.trim() || null,
        tipo: f.tipo, puntos: f.puntos, orden: f.orden, activa: f.activa,
      });
      await this.cargar();
      this.abierto.set(false);
      this.hecho.set(f.id ? 'Actividad actualizada.' : `«${f.titulo}» quedó creada.`);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo guardar.');
    } finally {
      this.guardando.set(false);
    }
  }
}
