import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlumnoDocente, DatosService, SeccionDocente } from './datos.service';
import { DocenteStore } from './docente.store';

/**
 * Administrar alumnos: moverlos de sección, darlos de baja, reiniciar su clave.
 *
 * Nada se borra nunca. Dar de baja es `activa = false`, que lo saca de las listas
 * y de los promedios sin perder lo que hizo mientras cursaba; y cambiar de
 * sección mueve la matrícula entera, así que se lleva sus puntos y su progreso
 * consigo. Cambiarse de sección no debería costarle a nadie lo que ya trabajó.
 */
@Component({
  selector: 'app-docente-alumnos',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <div class="encabezado">
      <h1>Alumnos</h1>
      <p>{{ docente.ramo()?.asignatura ?? 'Administrar matrículas del curso.' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else {
      <div class="tarjeta" style="margin-bottom:18px">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <input style="flex:1 1 240px" placeholder="Buscar por nombre o correo"
                 [ngModel]="busca()" (ngModelChange)="busca.set($event)" name="busca">
          <select [ngModel]="filtroSeccion()" (ngModelChange)="filtroSeccion.set($event)"
                  name="filtro" style="flex:0 0 auto">
            <option value="">Todas las secciones</option>
            @for (s of secciones(); track s.id) {
              <option [value]="s.id">{{ s.codigo }} · {{ s.matriculados }}</option>
            }
          </select>
          <label style="display:flex;align-items:center;gap:8px;margin:0">
            <input type="checkbox" [ngModel]="verBajas()" (ngModelChange)="verBajas.set($event)"
                   name="bajas" style="width:auto">
            <span class="chico">Ver dados de baja</span>
          </label>
          <span class="insignia celeste">{{ visibles().length }} de {{ alumnos().length }}</span>
        </div>
      </div>

      @if (hecho()) { <div class="aviso ok" style="margin-bottom:14px">{{ hecho() }}</div> }
      @if (error()) { <div class="aviso malo" style="margin-bottom:14px">{{ error() }}</div> }

      <div class="tarjeta">
        <table>
          <tr>
            <th>Alumno</th><th>Sección</th><th class="der">Puntos</th>
            <th class="der">Exp.</th><th class="der">Clases</th><th>Diag.</th><th></th>
          </tr>
          @for (a of visibles(); track a.matricula_id) {
            <tr [style.opacity]="a.activa ? 1 : .5">
              <td>
                <strong>{{ a.nombre }}</strong>
                @if (!a.activa) { <span class="insignia" style="margin-left:6px">De baja</span> }
                <div class="chico suave">{{ a.correo }}</div>
              </td>
              <td>{{ a.seccion }}</td>
              <td class="der num">{{ a.puntos }}</td>
              <td class="der num">{{ a.experiencia }}</td>
              <td class="der num">{{ a.clases_terminadas }}/{{ a.clases_abiertas }}</td>
              <td>
                @if (a.diagnostico) { <span class="insignia verde">sí</span> }
                @else { <span class="insignia amarilla">no</span> }
              </td>
              <td class="der">
                <button class="boton contorno chico" (click)="abrir(a)">
                  {{ editando()?.matricula_id === a.matricula_id ? 'Cerrar' : 'Editar' }}
                </button>
              </td>
            </tr>
          }
        </table>
        @if (visibles().length === 0) {
          <div class="aviso dato" style="margin-top:14px">Nadie calza con ese filtro.</div>
        }
      </div>

      @if (editando(); as a) {
        <div class="tarjeta" style="margin-top:18px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap">
            <h2>{{ a.nombre }}</h2>
            <a class="boton contorno chico" [routerLink]="['/ficha', a.matricula_id]">Ver su ficha</a>
          </div>
          <p class="chico suave" style="margin-top:2px">
            {{ a.correo }} · se matriculó el {{ a.creado_en | date:'dd/MM/yyyy' }}
            @if (a.ultimo_ingreso) { · último ingreso {{ a.ultimo_ingreso | date:'dd/MM HH:mm' }} }
            @else { · nunca ha entrado }
          </p>

          <div class="rejilla dos" style="margin-top:20px">
            <div>
              <span class="etiqueta">Sección</span>
              <div style="display:flex;gap:8px;margin-top:6px">
                <select [(ngModel)]="nuevaSeccion" name="sec" style="flex:1">
                  @for (s of secciones(); track s.id) {
                    <option [value]="s.id">{{ s.codigo }}</option>
                  }
                </select>
                <button class="boton chico" [disabled]="ocupado() || nuevaSeccion === a.seccion_id"
                        (click)="mover(a)">Mover</button>
              </div>
              <p class="chico suave" style="margin-top:6px">
                Se lleva sus puntos y su progreso: cambiarse de sección no borra nada.
              </p>
            </div>

            <div>
              <span class="etiqueta">Contraseña</span>
              <div style="display:flex;gap:8px;margin-top:6px">
                <input type="text" [(ngModel)]="clave" name="clave" style="flex:1"
                       placeholder="Mínimo 8 caracteres" autocomplete="off">
                <button class="boton chico" [disabled]="ocupado() || clave.length < 8"
                        (click)="reiniciar(a)">Cambiar</button>
              </div>
              <p class="chico suave" style="margin-top:6px">
                Se la dictas tú al alumno. Todavía no hay pantalla de recuperación.
              </p>
            </div>
          </div>

          <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;
                      padding-top:18px;border-top:1px solid var(--borde)">
            @if (a.activa) {
              <button class="boton contorno chico" [disabled]="ocupado()" (click)="baja(a, false)">
                Dar de baja
              </button>
              <span class="chico suave" style="align-self:center">
                Sale de listas y promedios. No se borra nada.
              </span>
            } @else {
              <button class="boton chico" [disabled]="ocupado()" (click)="baja(a, true)">
                Reactivar
              </button>
            }
          </div>
        </div>
      }
    }
  `,
})
export class DocenteAlumnosComponent {
  private datos = inject(DatosService);
  protected docente = inject(DocenteStore);

  alumnos = signal<AlumnoDocente[]>([]);
  secciones = signal<SeccionDocente[]>([]);
  editando = signal<AlumnoDocente | null>(null);
  cargando = signal(true);
  ocupado = signal(false);
  error = signal('');
  hecho = signal('');

  /**
   * Los filtros son señales, no propiedades.
   *
   * `visibles` es un `computed`, y un computed solo se recalcula cuando cambia
   * una **señal** que lee. Con propiedades normales el buscador no filtraba nada:
   * la lista se quedaba completa y «Editar» terminaba abriendo al alumno
   * equivocado, que es mucho peor que no filtrar.
   */
  busca = signal('');
  filtroSeccion = signal('');
  verBajas = signal(false);

  nuevaSeccion = '';
  clave = '';

  visibles = computed(() => {
    const q = this.busca().trim().toLowerCase();
    const sec = this.filtroSeccion();
    const bajas = this.verBajas();
    return this.alumnos().filter(a =>
      (bajas || a.activa)
      && (!sec || a.seccion_id === sec)
      && (!q || a.nombre.toLowerCase().includes(q) || a.correo.toLowerCase().includes(q)));
  });

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      await this.docente.cargar();
      const r = this.docente.ramo();
      if (!r) return;
      const [al, se] = await Promise.all([
        this.datos.alumnosDelRamo(r.asignatura_id, r.periodo_id),
        this.datos.seccionesQueDicto(r.asignatura_id, r.periodo_id),
      ]);
      this.alumnos.set(al);
      this.secciones.set(se);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar el curso.');
    } finally {
      this.cargando.set(false);
    }
  }

  abrir(a: AlumnoDocente): void {
    if (this.editando()?.matricula_id === a.matricula_id) { this.editando.set(null); return; }
    this.editando.set(a);
    this.nuevaSeccion = a.seccion_id;
    this.clave = '';
    this.error.set(''); this.hecho.set('');
  }

  private async operar(f: () => Promise<void>, mensaje: string): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.error.set(''); this.hecho.set('');
    try {
      await f();
      await this.cargar();
      // La ficha abierta quedó obsoleta tras recargar: se vuelve a apuntar a la
      // fila nueva para no mostrar datos viejos junto a un mensaje de éxito.
      const id = this.editando()?.matricula_id;
      this.editando.set(this.alumnos().find(x => x.matricula_id === id) ?? null);
      this.hecho.set(mensaje);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo completar la operación.');
    } finally {
      this.ocupado.set(false);
    }
  }

  mover(a: AlumnoDocente): void {
    const destino = this.secciones().find(s => s.id === this.nuevaSeccion)?.codigo ?? '';
    this.operar(() => this.datos.cambiarSeccion(a.matricula_id, this.nuevaSeccion),
      `${a.nombre} quedó en la sección ${destino}.`);
  }

  reiniciar(a: AlumnoDocente): void {
    const dicha = this.clave;
    this.operar(() => this.datos.reiniciarClave(a.matricula_id, dicha),
      `Contraseña cambiada. Dísela a ${a.nombre.split(' ')[0]}: ${dicha}`);
  }

  baja(a: AlumnoDocente, activa: boolean): void {
    this.operar(() => this.datos.activarAlumno(a.matricula_id, activa),
      activa ? `${a.nombre} vuelve al curso.` : `${a.nombre} quedó de baja.`);
  }
}
