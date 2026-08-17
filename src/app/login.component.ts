import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DatosService } from './datos.service';
import { PerfilStore } from './perfil.store';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  template: `
   <div class="acceso"><div class="caja">
    <img class="lockup" src="pulso-lockup.png" alt="Pulso">
    <div class="tarjeta">
      <h1>Iniciar sesión</h1>

      <form (ngSubmit)="ingresar()" style="margin-top:22px">
        <label>
          <span class="etiqueta">Correo institucional</span>
          <input name="correo" type="email" [(ngModel)]="correo" required
                 autocomplete="email" placeholder="nombre@duocuc.cl">
        </label>

        <label>
          <span class="etiqueta">Contraseña</span>
          <input name="clave" type="password" [(ngModel)]="clave" required
                 autocomplete="current-password">
        </label>

        @if (error()) {
          <div class="aviso malo">{{ error() }}</div>
        }

        <button class="boton" type="submit" [disabled]="cargando() || !completo()">
          @if (cargando()) { <span class="rueda" aria-hidden="true"></span> }
          {{ cargando() ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>

      <p class="suave chico">
        ¿Primera vez? <a routerLink="/registro">Crea tu cuenta</a>
      </p>
    </div>
   </div></div>
  `,
})
export class LoginComponent {
  private datos = inject(DatosService);
  private perfil = inject(PerfilStore);
  private router = inject(Router);

  correo = '';
  clave = '';
  cargando = signal(false);
  error = signal('');

  completo(): boolean {
    return this.correo.includes('@') && this.clave.length > 0;
  }

  /**
   * Entra y no suelta el botón hasta estar en la otra pantalla.
   *
   * Antes esto lanzaba `router.navigate()` sin esperarlo, así que el `finally`
   * apagaba el «Entrando…» mientras los guards todavía estaban resolviendo. Se
   * medía así: a los 117 ms el botón decía «Entrando…», a los 836 ms volvía a
   * decir «Entrar», y recién a los 1.140 ms cambiaba de página. En esos trescientos
   * milisegundos el formulario se veía en reposo y no había pasado nada —y en una
   * red lenta no son trescientos milisegundos—. La persona vuelve a apretar.
   *
   * Tampoco se manda a todo el mundo a `/inicio`. Un docente no cursa, así que
   * esa ruta lo rebota a `/curso`: dos navegaciones y dos pasadas de guard para
   * llegar donde se sabía desde el principio. Se resuelve el perfil acá —hay que
   * cargarlo igual— y se va derecho.
   */
  async ingresar(): Promise<void> {
    if (!this.completo() || this.cargando()) return;
    this.cargando.set(true);
    this.error.set('');
    try {
      await this.datos.ingresar(this.correo.trim(), this.clave);

      // Forzado, no `limpiar()`: el store puede venir resuelto de una sesión
      // anterior en esta pestaña y sin `true` no volvería a pedir nada. Pero
      // `limpiar()` además borra el ramo elegido del navegador, y un alumno con
      // dos ramos perdería su elección cada vez que entra.
      await this.perfil.cargar(true);

      const destino = this.perfil.esDocente() ? '/curso' : '/inicio';
      const abrio = await this.router.navigate([destino]);
      // Si un guard lo rechazó, quedarse callado deja la pantalla igual que
      // cuando no se apretó nada. Al menos hay que decirlo.
      if (!abrio) throw new Error('Entraste, pero no pude abrir tu página. Recarga.');
      return;   // sin apagar el cargando: la pantalla se va a destruir
    } catch (e: any) {
      const m = (e?.message ?? '').toLowerCase();
      this.error.set(
        m.includes('invalid login') ? 'Correo o contraseña incorrectos.'
        : m.includes('not confirmed') ? 'Todavía no confirmas tu correo. Revisa tu bandeja.'
        : (e?.message ?? 'No se pudo iniciar sesión.')
      );
      this.cargando.set(false);
    }
  }
}
