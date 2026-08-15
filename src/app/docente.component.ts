import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AvatarService } from './avatar.service';
import {
  Actividad, AlumnoNomina, Canje, ClaseDocente, DatosService, FilaResumenDiagnostico, RamoDocente,
} from './datos.service';

/**
 * La vista del docente, acotada a lo que dicta.
 *
 * Se elige primero **qué ramo**: una asignatura en un periodo. Sin eso, las
 * secciones se mezclarían —el código `001D` existe en las dos asignaturas y va a
 * volver a existir en 2027-1— y los promedios del diagnóstico sumarían cursos
 * distintos.
 */
@Component({
  selector: 'app-docente',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <div class="encabezado">
      <h1>Curso</h1>
      <p>Alumnos registrados en Pulso y sus puntos.</p>
    </div>

    @if (ramos().length === 0) {
      <div class="tarjeta">
        <div class="aviso dato">
          No tienes asignaturas asignadas en este periodo. Se declaran en
          <code>docente_asignaturas</code>.
        </div>
      </div>
    } @else {
      <!-- ============ Qué ramo se está mirando ============ -->
      <div class="tarjeta" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <h2>Qué estoy mirando</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            @for (r of ramos(); track r.asignatura_id + r.periodo_id) {
              <button class="boton chico" [class.contorno]="clave(r) !== ramoId()"
                      (click)="elegirRamo(r)">
                {{ r.sigla }} · {{ r.periodo }}
              </button>
            }
          </div>
        </div>
        @if (ramo(); as r) {
          <p class="chico suave" style="margin-top:10px">{{ r.asignatura }}</p>
        }
      </div>

      <div class="rejilla tres" style="margin-bottom:20px">
        <div class="tarjeta">
          <p class="etiqueta">Alumnos matriculados</p>
          <p class="cifra destacada">{{ alumnos().length }}</p>
        </div>
        <div class="tarjeta">
          <p class="etiqueta">Secciones activas</p>
          <p class="cifra">{{ secciones().length }}</p>
          <p class="chico suave">{{ secciones().join(' · ') || 'ninguna todavía' }}</p>
        </div>
        <div class="tarjeta">
          <p class="etiqueta">Puntos otorgados</p>
          <p class="cifra">{{ totalPuntos() }}</p>
        </div>
      </div>

      <!-- ============ Diagnóstico del curso ============ -->
      <div class="tarjeta" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <h2>Diagnóstico de entrada</h2>
          @if (diagnostico()) {
            <span class="insignia celeste">{{ rendidos() }} de {{ alumnos().length }} rendidos</span>
          }
        </div>

        @if (!diagnostico()) {
          <div class="aviso dato" style="margin-top:14px">
            Esta asignatura todavía no tiene diagnóstico de entrada publicado en este periodo.
          </div>
        } @else if (rendidos() === 0) {
          <div class="aviso dato" style="margin-top:14px">
            Todavía nadie lo ha rendido. Los resultados aparecen acá solos, sin que nadie tenga que
            reportar nada.
          </div>
        } @else {
          <table style="margin-top:14px">
            <tr>
              <th>Sección del diagnóstico</th>
              <th class="der">Promedio</th>
              <th class="der">Bajo el umbral</th>
              <th>Estado</th>
            </tr>
            @for (s of resumen(); track s.codigo) {
              <tr>
                <td>{{ s.codigo }} · {{ s.titulo }}</td>
                <td class="der num">{{ s.promedio }} <span class="suave">de {{ s.maximo }}</span></td>
                <td class="der num">{{ s.bajo }} <span class="suave">· {{ pct(s) }}%</span></td>
                <td>
                  <div class="barra" [class.roja]="pct(s) >= 50" [class.amarilla]="pct(s) >= 25 && pct(s) < 50"
                       [class.verde]="pct(s) < 25" style="max-width:170px">
                    <i [style.width.%]="100 - pct(s)"></i>
                  </div>
                </td>
              </tr>
            }
          </table>
          <p class="chico suave" style="margin-top:14px">
            Si más de la mitad del curso queda bajo el umbral en una sección, esa nivelación necesita
            más tiempo del planificado.
          </p>
        }
      </div>

      <!-- ============ Clases y su ventana ============ -->
      <div class="tarjeta" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <h2>Clases</h2>
          @if (clases().length) {
            <span class="insignia celeste">{{ clases().length }} cargadas</span>
          }
        </div>
        <p class="chico suave" style="margin-top:6px">
          Cuándo se habilita cada clase y hasta cuándo vale completa. Pasada la ventana los
          puntos se multiplican por el factor, para premiar a quien la vio antes o durante
          la sesión sin dejar en cero a quien la repasa después.
        </p>

        @if (clases().length === 0) {
          <div class="aviso dato" style="margin-top:14px">
            No hay clases cargadas en este ramo todavía.
          </div>
        } @else {
          <table style="margin-top:14px">
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
                    @if (c.ventana_hasta) {
                      <div class="chico suave">cierra {{ c.ventana_hasta | date:'dd/MM HH:mm' }}</div>
                    } @else {
                      <div class="chico suave">sin plazo</div>
                    }
                  } @else {
                    <span class="insignia">Fuera de plazo</span>
                    <div class="chico suave">paga ×{{ c.factor_atrasado }}</div>
                  }
                </td>
                <td class="der">{{ c.abrieron }}</td>
                <td class="der">{{ c.a_tiempo }}</td>
                <td class="der">{{ c.terminaron }}</td>
                <td class="der">
                  <button class="boton contorno chico" (click)="editar(c)">
                    {{ editando()?.id === c.id ? 'Cerrar' : 'Programar' }}
                  </button>
                </td>
              </tr>
            }
          </table>
        }

        @if (editando(); as c) {
          <div style="margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,.09)">
            <h3 style="margin:0 0 4px">{{ c.codigo }} · {{ c.titulo }}</h3>
            <p class="chico suave" style="margin:0 0 16px">
              Las horas son las de tu computador. Deja «se habilita» en blanco para ocultarla
              del todo, y «vale completa hasta» en blanco para que no caduque nunca.
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
                  <input type="number" min="0" [(ngModel)]="fAbrir" name="fAbrir"
                         title="Abrir" placeholder="abrir">
                  <input type="number" min="0" [(ngModel)]="fActividad" name="fActividad"
                         title="Cada actividad" placeholder="actividad">
                  <input type="number" min="0" [(ngModel)]="fTerminar" name="fTerminar"
                         title="Terminar" placeholder="terminar">
                </div>
                <div class="chico suave" style="margin-top:6px">abrir · actividad · terminar</div>
              </div>
            </div>

            @if (errorClase()) {
              <div class="aviso malo" style="margin-top:12px">{{ errorClase() }}</div>
            }

            <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
              <button class="boton chico" (click)="guardarClase()" [disabled]="guardando()">
                {{ guardando() ? 'Guardando…' : 'Guardar' }}
              </button>
              <button class="boton contorno chico" (click)="habilitarAhora()"
                      [disabled]="guardando()">
                Habilitar ahora
              </button>
              <button class="boton contorno chico" (click)="editando.set(null)">Cancelar</button>
            </div>
          </div>
        }
      </div>

      <!-- ============ Canjes por resolver ============ -->
      <div class="tarjeta" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <h2>Canjes por resolver</h2>
          @if (porResolver().length) {
            <span class="insignia amarilla">{{ porResolver().length }} esperando</span>
          }
        </div>

        @if (porResolver().length === 0) {
          <div class="aviso dato" style="margin-top:14px">
            Nada pendiente. Cuando un alumno pida algo que necesite tu visto bueno, aparece acá.
          </div>
        } @else {
          <table style="margin-top:14px">
            <tr>
              <th>Alumno</th><th>Pide</th><th class="der">Puntos</th>
              <th class="der">Hace</th><th></th>
            </tr>
            @for (c of porResolver(); track c.id) {
              <tr>
                <td>
                  {{ c.alumno }}
                  <div class="chico suave">Sección {{ c.seccion }}</div>
                </td>
                <td>
                  {{ c.icono }} {{ c.articulo }}
                  @if (c.nota_alumno) { <div class="chico suave">«{{ c.nota_alumno }}»</div> }
                </td>
                <td class="der num">{{ c.precio_pagado }}</td>
                <td class="der num suave chico">{{ c.creado_en | date:'dd/MM' }}</td>
                <td class="der" style="white-space:nowrap">
                  <button class="boton chico" (click)="resolver(c, 'entregado')"
                          [disabled]="resolviendo() === c.id">Entregar</button>
                  <button class="boton contorno chico" style="margin-left:6px"
                          (click)="rechazando.set(c.id)"
                          [disabled]="resolviendo() === c.id">Rechazar</button>
                </td>
              </tr>
              @if (rechazando() === c.id) {
                <tr>
                  <td colspan="5">
                    <form (ngSubmit)="resolver(c, 'rechazado')"
                          style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
                      <label style="flex:1;min-width:240px">
                        <span class="etiqueta">Por qué lo rechazas (le llega al alumno)</span>
                        <input name="comentario" [(ngModel)]="comentario"
                               placeholder="La EP2 ya está cerrada, pídela para la EP3">
                      </label>
                      <button class="boton chico" type="submit">Rechazar y devolver puntos</button>
                      <button class="boton contorno chico" type="button"
                              (click)="rechazando.set(null)">Cancelar</button>
                    </form>
                  </td>
                </tr>
              }
            }
          </table>
          <p class="chico suave" style="margin-top:12px">
            Rechazar devuelve los puntos solo. Los que no necesitan visto bueno —una pista, una
            plantilla— se entregan al instante y no pasan por acá.
          </p>
        }
      </div>

      <!-- ============ Nómina ============ -->
      <div class="tarjeta">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <h2>Nómina</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="boton chico" [class.contorno]="filtro() !== ''"
                    (click)="filtro.set('')">Todas</button>
            @for (s of secciones(); track s) {
              <button class="boton chico" [class.contorno]="filtro() !== s"
                      (click)="filtro.set(s)">{{ s }}</button>
            }
          </div>
        </div>

        @if (cargando()) {
          <p class="suave chico" style="margin-top:14px">Cargando…</p>
        } @else if (visibles().length === 0) {
          <div class="aviso dato" style="margin-top:14px">
            Todavía no hay alumnos matriculados en este ramo. Comparte el enlace de Pulso con el curso.
          </div>
        } @else {
          <table style="margin-top:14px">
            <tr>
              <th style="width:44px"></th><th>Alumno</th><th>Sección</th>
              <th class="der">Puntos</th><th class="der">Se matriculó</th><th></th>
            </tr>
            @for (a of visibles(); track a.matricula_id) {
              <tr>
                <td><img [src]="mini(a.avatar)" alt="" style="width:34px;height:34px;border-radius:50%;display:block"></td>
                <td>{{ a.nombre }}</td>
                <td><span class="insignia celeste">{{ a.seccion }}</span></td>
                <td class="der num" style="font-weight:600">{{ a.puntos }}</td>
                <td class="der num suave chico">{{ a.creado_en | date:'dd/MM/yyyy' }}</td>
                <td class="der" style="white-space:nowrap">
                  <a class="boton contorno chico" [routerLink]="['/ficha', a.matricula_id]">Ficha</a>
                  <button class="boton contorno chico" style="margin-left:6px"
                          (click)="abrir(a)">Puntos</button>
                </td>
              </tr>
            }
          </table>
        }
      </div>

      @if (elegido(); as al) {
        <div class="tarjeta" style="margin-top:20px">
          <h2>Puntos para {{ al.nombre }}</h2>
          <p class="chico suave" style="margin-top:4px">
            En {{ al.asignatura }}, sección {{ al.seccion }}. Usa un número negativo para descontar.
            Todo movimiento queda registrado con su motivo.
          </p>
          <form (ngSubmit)="registrar()" style="margin-top:16px">
            <div class="rejilla dos">
              <label>
                <span class="etiqueta">Puntos</span>
                <input type="number" name="puntos" [(ngModel)]="puntos" required>
              </label>
              <label>
                <span class="etiqueta">Motivo</span>
                <input name="motivo" [(ngModel)]="motivo" required
                       placeholder="Laboratorio 3 completado">
              </label>
            </div>
            @if (error()) { <div class="aviso malo">{{ error() }}</div> }
            @if (hecho()) { <div class="aviso ok">{{ hecho() }}</div> }
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              <button class="boton" type="submit" [disabled]="guardando() || !motivo.trim() || !puntos">
                {{ guardando() ? 'Registrando…' : 'Registrar movimiento' }}
              </button>
              <button class="boton contorno" type="button" (click)="cerrar()">Cerrar</button>
            </div>
          </form>
        </div>
      }
    }
  `,
})
export class DocenteComponent {
  private datos = inject(DatosService);
  private avatares = inject(AvatarService);

  ramos = signal<RamoDocente[]>([]);
  ramoId = signal('');
  alumnos = signal<AlumnoNomina[]>([]);
  diagnostico = signal<Actividad | null>(null);
  resumen = signal<FilaResumenDiagnostico[]>([]);
  canjes = signal<Canje[]>([]);
  cargando = signal(true);
  filtro = signal('');

  rechazando = signal<number | null>(null);
  resolviendo = signal<number | null>(null);
  comentario = '';

  elegido = signal<AlumnoNomina | null>(null);
  puntos: number | null = null;
  motivo = '';
  guardando = signal(false);
  error = signal('');
  hecho = signal('');

  // ---------- Programación de clases ----------
  clases = signal<ClaseDocente[]>([]);
  editando = signal<ClaseDocente | null>(null);
  errorClase = signal('');
  fDesde = '';
  fHasta = '';
  fFactor = 0.5;
  fAbrir = 5;
  fActividad = 10;
  fTerminar = 20;

  ramo = computed(() => this.ramos().find(r => this.clave(r) === this.ramoId()) ?? null);
  secciones = computed(() => [...new Set(this.alumnos().map(a => a.seccion))].sort());
  visibles = computed(() =>
    this.filtro() ? this.alumnos().filter(a => a.seccion === this.filtro()) : this.alumnos()
  );
  totalPuntos = computed(() => this.alumnos().reduce((n, a) => n + a.puntos, 0));
  /** Cuántos rindieron: el resumen lo informa por sección, y todas traen el mismo total. */
  rendidos = computed(() => this.resumen()[0]?.rendidos ?? 0);
  porResolver = computed(() => this.canjes().filter(c => c.estado === 'solicitado'));

  constructor() {
    this.cargar();
  }

  clave(r: RamoDocente): string {
    return `${r.asignatura_id}|${r.periodo_id}`;
  }

  pct(s: FilaResumenDiagnostico): number {
    return s.rendidos ? Math.round(s.bajo / s.rendidos * 100) : 0;
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const ramos = await this.datos.ramosQueDicto();
      this.ramos.set(ramos);
      if (ramos.length) await this.elegirRamo(ramos[0]);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar la nómina.');
    } finally {
      this.cargando.set(false);
    }
  }

  async elegirRamo(r: RamoDocente): Promise<void> {
    this.ramoId.set(this.clave(r));
    this.filtro.set('');
    this.elegido.set(null);
    await this.cargarRamo();
  }

  private async cargarRamo(): Promise<void> {
    const r = this.ramo();
    if (!r) return;

    this.cargando.set(true);
    try {
      const [alumnos, actividades, canjes, clases] = await Promise.all([
        this.datos.nomina(r.sigla, r.periodo),
        this.datos.actividadesDe(r.asignatura_id, r.periodo_id),
        this.datos.canjesDelRamo(r.asignatura_id, r.periodo_id),
        this.datos.clasesQueDicto(r.asignatura_id, r.periodo_id),
      ]);
      this.alumnos.set(alumnos);
      this.canjes.set(canjes);
      this.clases.set(clases);
      this.editando.set(null);

      const diag = actividades.find(a => a.tipo === 'diagnostico') ?? null;
      this.diagnostico.set(diag);
      this.resumen.set(diag ? await this.datos.resumenDiagnostico(diag.id) : []);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar la nómina.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ---------- Programación de clases ----------

  maximo(c: ClaseDocente): number {
    return c.puntos_abrir + c.actividades * c.puntos_actividad + c.puntos_terminar;
  }

  /**
   * ISO (UTC) → el valor que espera un `datetime-local`, que es hora **local sin
   * zona**. Restar el desfase antes de cortar la cadena es lo que evita que una
   * clase programada a las 08:31 se muestre a las 12:31.
   */
  private aLocal(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  /** Y la vuelta: `new Date` de una cadena sin zona la interpreta como local. */
  private aIso(local: string): string | null {
    if (!local) return null;
    const d = new Date(local);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  editar(c: ClaseDocente): void {
    if (this.editando()?.id === c.id) { this.editando.set(null); return; }
    this.errorClase.set('');
    this.editando.set(c);
    this.fDesde = this.aLocal(c.publicada_desde);
    this.fHasta = this.aLocal(c.ventana_hasta);
    this.fFactor = Number(c.factor_atrasado);
    this.fAbrir = c.puntos_abrir;
    this.fActividad = c.puntos_actividad;
    this.fTerminar = c.puntos_terminar;
  }

  async guardarClase(): Promise<void> {
    const c = this.editando();
    if (!c || this.guardando()) return;
    this.guardando.set(true);
    this.errorClase.set('');
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
      await this.cargarRamo();
    } catch (e: any) {
      this.errorClase.set(e?.message ?? 'No se pudo programar la clase.');
    } finally {
      this.guardando.set(false);
    }
  }

  /**
   * El atajo del día de clase: se habilita ahora y la ventana cierra al terminar
   * el bloque. Noventa minutos cubre un bloque de 129 minutos con holgura para
   * quien la abre apenas termina; el docente lo ajusta si quiere otra cosa.
   */
  habilitarAhora(): void {
    const ahora = new Date();
    const cierre = new Date(ahora.getTime() + 90 * 60000);
    this.fDesde = this.aLocal(ahora.toISOString());
    this.fHasta = this.aLocal(cierre.toISOString());
    this.guardarClase();
  }

  async resolver(c: Canje, estado: 'entregado' | 'rechazado'): Promise<void> {
    this.resolviendo.set(c.id);
    this.error.set('');
    try {
      await this.datos.resolverCanje(c.id, estado, estado === 'rechazado' ? this.comentario : '');
      this.rechazando.set(null);
      this.comentario = '';
      await this.cargarRamo();
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo resolver el canje.');
    } finally {
      this.resolviendo.set(null);
    }
  }

  mini(clave: string): string {
    return this.avatares.imagen(clave, 68);
  }

  abrir(a: AlumnoNomina): void {
    this.elegido.set(a);
    this.puntos = null;
    this.motivo = '';
    this.error.set('');
    this.hecho.set('');
  }

  cerrar(): void {
    this.elegido.set(null);
  }

  async registrar(): Promise<void> {
    const al = this.elegido();
    if (!al || !this.puntos || !this.motivo.trim()) return;
    this.guardando.set(true);
    this.error.set('');
    this.hecho.set('');
    try {
      await this.datos.otorgarPuntos(al.matricula_id, this.puntos, this.motivo.trim());
      this.hecho.set(`${this.puntos > 0 ? '+' : ''}${this.puntos} puntos para ${al.nombre}`);
      this.puntos = null;
      this.motivo = '';
      await this.cargarRamo();
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo registrar el movimiento.');
    } finally {
      this.guardando.set(false);
    }
  }
}
