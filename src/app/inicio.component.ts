import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvatarService } from './avatar.service';
import { DatosService, Movimiento } from './datos.service';
import { PerfilStore } from './perfil.store';

@Component({
  selector: 'app-inicio',
  imports: [DatePipe, RouterLink],
  template: `
    <div class="encabezado">
      <h1>Hola, {{ primerNombre() }}</h1>
      <p>{{ perfil.perfil()?.asignatura ?? '' }}</p>
    </div>

    @if (perfil.cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (!perfil.perfil()) {
      <div class="tarjeta">
        <div class="aviso malo">
          <strong>Tu perfil está incompleto.</strong>
          Los datos del registro no alcanzaron a guardarse.
        </div>
        <button class="boton" style="margin-top:16px" (click)="completar()">Completar mi perfil</button>
        @if (error()) { <div class="aviso malo" style="margin-top:12px">{{ error() }}</div> }
      </div>
    } @else {
      <div class="rejilla tres" style="margin-bottom:20px">
        <div class="tarjeta">
          <p class="etiqueta">Puntos disponibles</p>
          <p class="cifra destacada">{{ saldo() }}</p>
          <p class="chico suave">Para canjear más adelante</p>
        </div>

        <div class="tarjeta">
          <p class="etiqueta">Sección</p>
          <p class="cifra">{{ perfil.perfil()!.seccion }}</p>
          <p class="chico suave">Tu grupo del semestre</p>
        </div>

        <div class="tarjeta">
          <p class="etiqueta">Avance del semestre</p>
          <p class="cifra">{{ avanceSemana }}<span style="font-size:20px;color:var(--texto-suave)">/18</span></p>
          <div class="barra" style="margin-top:10px"><i [style.width.%]="avanceSemana / 18 * 100"></i></div>
        </div>
      </div>

      <div class="rejilla dos">
        <div class="tarjeta">
          <h2>Tu avatar</h2>
          <div style="display:flex;align-items:center;gap:18px;margin-top:16px">
            <img class="avatar-grande" [src]="avatar()" alt="Tu avatar">
            <div>
              <p class="chico suave" style="margin-bottom:10px">
                Así te ven en Pulso. Puedes cambiarlo cuando quieras.
              </p>
              <a class="boton accion chico" routerLink="/perfil">Elegir otro</a>
            </div>
          </div>
        </div>

        <div class="tarjeta">
          <h2>Últimos movimientos</h2>
          @if (movimientos().length === 0) {
            <p class="suave chico" style="margin-top:12px">Todavía no tienes movimientos.</p>
          } @else {
            <table style="margin-top:12px">
              @for (m of ultimos(); track m.id) {
                <tr>
                  <td>{{ m.motivo }}</td>
                  <td class="der num" [class.mas]="m.puntos > 0" [class.menos]="m.puntos < 0">
                    {{ m.puntos > 0 ? '+' : '' }}{{ m.puntos }}
                  </td>
                  <td class="der num suave chico">{{ m.creado_en | date:'dd/MM' }}</td>
                </tr>
              }
            </table>
            @if (movimientos().length > 4) {
              <a class="chico" routerLink="/puntos" style="display:inline-block;margin-top:14px">
                Ver todos los movimientos
              </a>
            }
          }
        </div>
      </div>
    }
  `,
})
export class InicioComponent {
  protected perfil = inject(PerfilStore);
  private datos = inject(DatosService);
  private avatares = inject(AvatarService);

  /** Semana del semestre; por ahora fija, la calcularemos cuando exista el avance real. */
  protected readonly avanceSemana = 1;

  saldo = signal(0);
  movimientos = signal<Movimiento[]>([]);
  error = signal('');

  avatar = computed(() => this.avatares.imagen(this.perfil.perfil()?.avatar ?? 'thumbs:inicial', 152));
  primerNombre = computed(() => (this.perfil.perfil()?.nombre ?? '').split(' ')[0] || 'de nuevo');
  ultimos = computed(() => this.movimientos().slice(0, 4));

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    await this.perfil.cargar();
    if (!this.perfil.perfil()) return;
    try {
      const [saldo, movs] = await Promise.all([
        this.datos.miSaldo(),
        this.datos.misMovimientos(),
      ]);
      this.saldo.set(saldo);
      this.movimientos.set(movs);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudieron cargar tus datos.');
    }
  }

  async completar(): Promise<void> {
    this.error.set('');
    try {
      await this.datos.completarPerfil();
      await this.perfil.cargar(true);
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo completar el perfil.');
    }
  }
}
