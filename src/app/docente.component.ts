import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AvatarService } from './avatar.service';
import { DatosService, ResumenAlumno } from './datos.service';

@Component({
  selector: 'app-docente',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="encabezado">
      <h1>Curso</h1>
      <p>Alumnos registrados en Pulso y sus puntos.</p>
    </div>

    <div class="rejilla tres" style="margin-bottom:20px">
      <div class="tarjeta">
        <p class="etiqueta">Alumnos registrados</p>
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
          Todavía no hay alumnos registrados. Comparte el enlace de Pulso con el curso.
        </div>
      } @else {
        <table style="margin-top:14px">
          <tr>
            <th style="width:44px"></th><th>Alumno</th><th>Sección</th>
            <th class="der">Puntos</th><th class="der">Se registró</th><th></th>
          </tr>
          @for (a of visibles(); track a.id) {
            <tr>
              <td><img [src]="mini(a.avatar)" alt="" style="width:34px;height:34px;border-radius:50%;display:block"></td>
              <td>{{ a.nombre }}</td>
              <td><span class="insignia celeste">{{ a.seccion }}</span></td>
              <td class="der num" style="font-weight:600">{{ a.puntos }}</td>
              <td class="der num suave chico">{{ a.creado_en | date:'dd/MM/yyyy' }}</td>
              <td class="der">
                <button class="boton contorno chico" (click)="abrir(a)">Puntos</button>
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
          Usa un número negativo para descontar. Todo movimiento queda registrado con su motivo.
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
  `,
})
export class DocenteComponent {
  private datos = inject(DatosService);
  private avatares = inject(AvatarService);

  alumnos = signal<ResumenAlumno[]>([]);
  cargando = signal(true);
  filtro = signal('');

  elegido = signal<ResumenAlumno | null>(null);
  puntos: number | null = null;
  motivo = '';
  guardando = signal(false);
  error = signal('');
  hecho = signal('');

  secciones = computed(() => [...new Set(this.alumnos().map(a => a.seccion))].sort());
  visibles = computed(() =>
    this.filtro() ? this.alumnos().filter(a => a.seccion === this.filtro()) : this.alumnos()
  );
  totalPuntos = computed(() => this.alumnos().reduce((n, a) => n + a.puntos, 0));

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.alumnos.set(await this.datos.resumenAlumnos());
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar la nómina.');
    } finally {
      this.cargando.set(false);
    }
  }

  mini(clave: string): string {
    return this.avatares.imagen(clave, 68);
  }

  abrir(a: ResumenAlumno): void {
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
      await this.datos.otorgarPuntos(al.id, this.puntos, this.motivo.trim());
      this.hecho.set(`${this.puntos > 0 ? '+' : ''}${this.puntos} puntos para ${al.nombre}`);
      this.puntos = null;
      this.motivo = '';
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo registrar el movimiento.');
    } finally {
      this.guardando.set(false);
    }
  }
}
