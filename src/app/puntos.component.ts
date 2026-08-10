import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { DatosService, Movimiento } from './datos.service';

@Component({
  selector: 'app-puntos',
  imports: [DatePipe],
  template: `
    <div class="encabezado">
      <h1>Mis puntos</h1>
      <p>Todo lo que has ganado, y en qué se te fue.</p>
    </div>

    <div class="rejilla tres" style="margin-bottom:20px">
      <div class="tarjeta">
        <p class="etiqueta">Saldo</p>
        <p class="cifra destacada">{{ saldo() }}</p>
      </div>
      <div class="tarjeta">
        <p class="etiqueta">Ganados</p>
        <p class="cifra" style="color:var(--verde)">+{{ ganados() }}</p>
      </div>
      <div class="tarjeta">
        <p class="etiqueta">Canjeados</p>
        <p class="cifra" style="color:var(--texto-suave)">{{ gastados() }}</p>
      </div>
    </div>

    <div class="tarjeta">
      <h2>Historial</h2>
      @if (cargando()) {
        <p class="suave chico" style="margin-top:12px">Cargando…</p>
      } @else if (movimientos().length === 0) {
        <p class="suave chico" style="margin-top:12px">Todavía no tienes movimientos.</p>
      } @else {
        <table style="margin-top:12px">
          <tr><th>Motivo</th><th class="der">Puntos</th><th class="der">Fecha</th></tr>
          @for (m of movimientos(); track m.id) {
            <tr>
              <td>{{ m.motivo }}</td>
              <td class="der num" [class.mas]="m.puntos > 0" [class.menos]="m.puntos < 0">
                {{ m.puntos > 0 ? '+' : '' }}{{ m.puntos }}
              </td>
              <td class="der num suave">{{ m.creado_en | date:'dd/MM/yyyy HH:mm' }}</td>
            </tr>
          }
        </table>
      }
    </div>

    <div class="tarjeta" style="margin-top:20px">
      <h2>Tienda de canje</h2>
      <div class="aviso dato" style="margin-top:14px">
        Todavía no está abierta. Acumula puntos: pronto vas a poder cambiarlos por cosas que te
        sirvan durante el semestre.
      </div>
    </div>
  `,
})
export class PuntosComponent {
  private datos = inject(DatosService);

  movimientos = signal<Movimiento[]>([]);
  saldo = signal(0);
  cargando = signal(true);

  ganados = signal(0);
  gastados = signal(0);

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      const [saldo, movs] = await Promise.all([
        this.datos.miSaldo(),
        this.datos.misMovimientos(),
      ]);
      this.saldo.set(saldo);
      this.movimientos.set(movs);
      this.ganados.set(movs.filter(m => m.puntos > 0).reduce((n, m) => n + m.puntos, 0));
      this.gastados.set(movs.filter(m => m.puntos < 0).reduce((n, m) => n + m.puntos, 0));
    } finally {
      this.cargando.set(false);
    }
  }
}
