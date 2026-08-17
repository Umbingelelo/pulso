import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AvatarService } from './avatar.service';
import {
  Actividad, AlumnoNomina, Canje, DatosService, FilaResumenDiagnostico, RamoDocente,
  SeccionReunion,
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

      <!-- ============ Modo reunión ============ -->
      <!-- Va arriba, antes de las cifras: es lo único de esta pantalla que se
           aprieta con prisa, entre que suena la reunión y hay que entrar. -->
      <div class="tarjeta" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <h2>Modo reunión</h2>
          @if (enReunion().length) {
            <span class="insignia amarilla">
              En reunión: {{ enReunion().join(' · ') }}
            </span>
          }
        </div>
        <p class="chico suave" style="margin:8px 0 0">
          Enciéndelo para la sección que está en sala. A esos alumnos les aparece en su barra que
          estás en reunión, y su tienda queda con <strong>{{ DESCUENTO }}% de descuento</strong>
          mientras dure, como compensación. No les bloquea nada más.
        </p>

        @if (errorReunion()) {
          <div class="aviso malo" style="margin-top:12px">{{ errorReunion() }}</div>
        }
        @if (hechoReunion()) {
          <div class="aviso ok" style="margin-top:12px">{{ hechoReunion() }}</div>
        }

        @if (seccionesReunion().length === 0) {
          <div class="aviso dato" style="margin-top:14px">
            Este ramo todavía no tiene secciones cargadas.
          </div>
        } @else {
          <table style="margin-top:14px">
            <tr>
              <th>Sección</th><th>Estado</th><th class="der">Alumnos</th><th></th>
            </tr>
            @for (s of seccionesReunion(); track s.seccion_id) {
              <tr>
                <td><strong>{{ s.codigo }}</strong></td>
                <td>
                  @if (s.en_reunion) {
                    <span class="insignia amarilla">En reunión</span>
                    <div class="chico suave">
                      desde {{ s.desde | date:'HH:mm' }}
                      @if (s.minutos !== null) { · {{ s.minutos }} min } ·
                      −{{ s.descuento }}% en la tienda
                    </div>
                  } @else {
                    <span class="insignia verde">Disponible</span>
                  }
                </td>
                <td class="der num">{{ s.matriculados }}</td>
                <td class="der">
                  @if (s.en_reunion) {
                    <button class="boton chico" [disabled]="cambiando() === s.seccion_id"
                            (click)="terminarReunion(s)">
                      {{ cambiando() === s.seccion_id ? 'Terminando…' : 'Terminar reunión' }}
                    </button>
                  } @else {
                    <button class="boton contorno chico" [disabled]="cambiando() === s.seccion_id"
                            (click)="iniciarReunion(s)">
                      {{ cambiando() === s.seccion_id ? 'Iniciando…' : 'Estoy en reunión' }}
                    </button>
                  }
                </td>
              </tr>
            }
          </table>
          @if (enReunion().length) {
            <p class="chico suave" style="margin:12px 0 0">
              Acuérdate de terminarla al salir: mientras siga encendida, esa sección mantiene el
              descuento.
            </p>
          }
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

  /** El descuento con el que se enciende. Se guarda en cada reunión, no es constante. */
  protected readonly DESCUENTO = 30;
  seccionesReunion = signal<SeccionReunion[]>([]);
  cambiando = signal<string | null>(null);
  errorReunion = signal('');
  hechoReunion = signal('');


  ramo = computed(() => this.ramos().find(r => this.clave(r) === this.ramoId()) ?? null);
  secciones = computed(() => [...new Set(this.alumnos().map(a => a.seccion))].sort());
  visibles = computed(() =>
    this.filtro() ? this.alumnos().filter(a => a.seccion === this.filtro()) : this.alumnos()
  );
  totalPuntos = computed(() => this.alumnos().reduce((n, a) => n + a.puntos, 0));
  /** Cuántos rindieron: el resumen lo informa por sección, y todas traen el mismo total. */
  rendidos = computed(() => this.resumen()[0]?.rendidos ?? 0);
  porResolver = computed(() => this.canjes().filter(c => c.estado === 'solicitado'));
  /** Los códigos de las secciones que están en reunión ahora, para el rótulo de arriba. */
  enReunion = computed(() => this.seccionesReunion().filter(s => s.en_reunion).map(s => s.codigo));

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
      const [alumnos, actividades, canjes, reuniones] = await Promise.all([
        this.datos.nomina(r.sigla, r.periodo),
        this.datos.actividadesDe(r.asignatura_id, r.periodo_id),
        this.datos.canjesDelRamo(r.asignatura_id, r.periodo_id),
        this.datos.seccionesEnReunion(r.asignatura_id, r.periodo_id),
      ]);
      this.alumnos.set(alumnos);
      this.canjes.set(canjes);
      this.seccionesReunion.set(reuniones);

      const diag = actividades.find(a => a.tipo === 'diagnostico') ?? null;
      this.diagnostico.set(diag);
      this.resumen.set(diag ? await this.datos.resumenDiagnostico(diag.id) : []);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar la nómina.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ---------- Modo reunión ----------
  // Las dos operaciones son idempotentes en la base: encender lo encendido o
  // apagar lo apagado devuelve el estado, no un error. Acá se aprovecha para no
  // tener que deshabilitar botones con precisión de milisegundo.

  async iniciarReunion(s: SeccionReunion): Promise<void> {
    await this.cambiarReunion(s, true);
  }

  async terminarReunion(s: SeccionReunion): Promise<void> {
    await this.cambiarReunion(s, false);
  }

  private async cambiarReunion(s: SeccionReunion, iniciar: boolean): Promise<void> {
    if (this.cambiando()) return;
    this.cambiando.set(s.seccion_id);
    this.errorReunion.set(''); this.hechoReunion.set('');
    try {
      const r = iniciar
        ? await this.datos.iniciarReunion(s.seccion_id, this.DESCUENTO)
        : await this.datos.terminarReunion(s.seccion_id);
      this.hechoReunion.set(iniciar
        ? `${s.codigo} está en reunión. Sus alumnos ya lo ven y su tienda quedó con ${this.DESCUENTO}% de descuento.`
        : `${s.codigo} salió de reunión${r?.minutos != null ? ` después de ${r.minutos} minutos` : ''}. Los precios volvieron a lo normal.`);
      await this.refrescarReuniones();
    } catch (e: any) {
      this.errorReunion.set(e?.message ?? 'No se pudo cambiar el modo reunión.');
    } finally {
      this.cambiando.set(null);
    }
  }

  /** Solo las reuniones: recargar el ramo entero por esto sería pedir cuatro consultas. */
  private async refrescarReuniones(): Promise<void> {
    const r = this.ramo();
    if (!r) return;
    this.seccionesReunion.set(
      await this.datos.seccionesEnReunion(r.asignatura_id, r.periodo_id));
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
