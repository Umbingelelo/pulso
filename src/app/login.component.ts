import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DatosService } from './datos.service';

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
  private router = inject(Router);

  correo = '';
  clave = '';
  cargando = signal(false);
  error = signal('');

  completo(): boolean {
    return this.correo.includes('@') && this.clave.length > 0;
  }

  async ingresar(): Promise<void> {
    if (!this.completo() || this.cargando()) return;
    this.cargando.set(true);
    this.error.set('');
    try {
      await this.datos.ingresar(this.correo.trim(), this.clave);
      this.router.navigate(['/inicio']);
    } catch (e: any) {
      const m = (e?.message ?? '').toLowerCase();
      this.error.set(
        m.includes('invalid login') ? 'Correo o contraseña incorrectos.'
        : m.includes('not confirmed') ? 'Todavía no confirmas tu correo. Revisa tu bandeja.'
        : (e?.message ?? 'No se pudo iniciar sesión.')
      );
    } finally {
      this.cargando.set(false);
    }
  }
}
