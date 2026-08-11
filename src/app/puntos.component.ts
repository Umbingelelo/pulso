import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatosService, Movimiento } from './datos.service';
import { PerfilStore } from './perfil.store';

@Component({
  selector: 'app-puntos',
  imports: [DatePipe, RouterLink],
  template: `
    <div class="encabezado">
      <h1>Mis puntos</h1>
      <p>
        Todo lo que has ganado en {{ perfil.ramo()?.sigla ?? 'este ramo' }}, y en qué se te fue.
        El saldo es de cada asignatura por separado.
      </p>
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
      <p class="chico suave" style="margin-top:6px">
        Décimas, prórrogas, pistas y unas cuantas cosas más. Todavía se están afinando los precios,
        pero ya puedes mirar la vitrina y saber hacia dónde ahorrar.
      </p>
      <a class="boton accion" style="margin-top:16px" routerLink="/tienda">Ver la tienda</a>
    </div>
  `,
})
export class PuntosComponent {
  private datos = inject(DatosService);
  protected perfil = inject(PerfilStore);

  movimientos = signal<Movimiento[]>([]);
  saldo = signal(0);
  cargando = signal(true);

  ganados = signal(0);
  gastados = signal(0);

  constructor() {
    this.perfil.cargar();
    effect(() => {
      const ramo = this.perfil.ramo();
      if (ramo) this.cargar(ramo.matricula_id);
      else this.cargando.set(false);
    });
  }

  private async cargar(matriculaId: string): Promise<void> {
    this.cargando.set(true);
    try {
      const [saldo, movs] = await Promise.all([
        this.datos.saldo(matriculaId),
        this.datos.movimientos(matriculaId),
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
