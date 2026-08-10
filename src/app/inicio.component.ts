import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DatosService, Movimiento, Perfil } from './datos.service';

type PerfilCompleto = Perfil & { seccion: string; asignatura: string };

@Component({
  selector: 'app-inicio',
  imports: [DatePipe],
  template: `
    <div class="tarjeta ancha">
      <div class="cabecera">
        <div>
          <p class="sobre-titulo">Pulso</p>
          <h1>{{ perfil()?.nombre ?? 'Mi cuenta' }}</h1>
          @if (perfil()) {
            <p class="suave">{{ perfil()!.asignatura }} — sección {{ perfil()!.seccion }}</p>
          }
        </div>
        <button class="boton fantasma" (click)="salir()">Salir</button>
      </div>

      @if (cargando()) {
        <p class="suave">Cargando…</p>
      } @else if (!perfil()) {
        <div class="aviso malo">
          <strong>Tu perfil está incompleto.</strong>
          Los datos del registro no alcanzaron a guardarse.
        </div>
        <button class="boton" (click)="completar()">Completar mi perfil</button>
        @if (error()) { <div class="aviso malo">{{ error() }}</div> }
      } @else {
        <div class="marcador">
          <div class="saldo">{{ saldo() }}</div>
          <div class="etq">puntos disponibles</div>
        </div>

        <p class="suave chico">
          Los puntos se van a poder canjear por elementos que te ayuden durante el semestre.
          Por ahora, acumúlalos.
        </p>

        <h2>Movimientos</h2>
        @if (movimientos().length === 0) {
          <p class="suave">Todavía no tienes movimientos.</p>
        } @else {
          <table>
            <tr><th>Motivo</th><th class="der">Puntos</th><th class="der">Fecha</th></tr>
            @for (m of movimientos(); track m.id) {
              <tr>
                <td>{{ m.motivo }}</td>
                <td class="der num" [class.mas]="m.puntos > 0" [class.menos]="m.puntos < 0">
                  {{ m.puntos > 0 ? '+' : '' }}{{ m.puntos }}
                </td>
                <td class="der num suave">{{ m.creado_en | date:'dd/MM/yyyy' }}</td>
              </tr>
            }
          </table>
        }
      }
    </div>
  `,
})
export class InicioComponent {
  private datos = inject(DatosService);
  private router = inject(Router);

  perfil = signal<PerfilCompleto | null>(null);
  saldo = signal(0);
  movimientos = signal<Movimiento[]>([]);
  cargando = signal(true);
  error = signal('');

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const p = await this.datos.miPerfil();
      this.perfil.set(p);
      if (p) {
        const [saldo, movs] = await Promise.all([
          this.datos.miSaldo(),
          this.datos.misMovimientos(),
        ]);
        this.saldo.set(saldo);
        this.movimientos.set(movs);
      }
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudieron cargar tus datos.');
    } finally {
      this.cargando.set(false);
    }
  }

  async completar(): Promise<void> {
    this.error.set('');
    try {
      await this.datos.completarPerfil();
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo completar el perfil.');
    }
  }

  async salir(): Promise<void> {
    await this.datos.salir();
    this.router.navigate(['/ingresar']);
  }
}
