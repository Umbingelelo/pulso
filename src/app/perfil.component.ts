import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvatarService } from './avatar.service';
import { DatosService } from './datos.service';
import { PerfilStore } from './perfil.store';

@Component({
  selector: 'app-perfil',
  imports: [RouterLink],
  template: `
    <div class="encabezado">
      <h1>Mi perfil</h1>
      <p>Elige el avatar con el que apareces en Pulso.</p>
    </div>

    <div class="rejilla dos" style="margin-bottom:20px">
      <div class="tarjeta">
        <h2>Cómo te ven</h2>
        <div style="display:flex;align-items:center;gap:18px;margin-top:16px">
          <img class="avatar-grande" [src]="vistaPrevia()" alt="Avatar elegido">
          <div>
            <p style="font-weight:600">{{ perfil.perfil()?.nombre }}</p>
            @if (perfil.ramo(); as r) {
              <p class="chico suave">{{ r.asignatura }}</p>
              <p class="chico suave">Sección {{ r.seccion }} · {{ r.periodo }}</p>
            }
          </div>
        </div>
      </div>

      <div class="tarjeta">
        <h2>Mis ramos</h2>
        @if (perfil.ramos().length === 0) {
          <p class="suave chico" style="margin-top:12px">Todavía no estás matriculado en ninguno.</p>
        } @else {
          <table style="margin-top:12px">
            <tr><th>Asignatura</th><th>Sección</th><th>Periodo</th><th class="der">Puntos</th></tr>
            @for (r of perfil.ramos(); track r.matricula_id) {
              <tr>
                <td>{{ r.sigla }}</td>
                <td><span class="insignia celeste">{{ r.seccion }}</span></td>
                <td class="suave chico">{{ r.periodo }}</td>
                <td class="der num" style="font-weight:600">{{ r.puntos }}</td>
              </tr>
            }
          </table>
        }
        <p class="chico suave" style="margin-top:14px">
          <a routerLink="/ramos">Agregar otro ramo</a>. Si una sección está mal, escríbele al docente.
        </p>
      </div>
    </div>

    <div class="tarjeta">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <h2>Elige tu avatar</h2>
        <button class="boton contorno chico" type="button" (click)="otraTanda()">Mostrar otros</button>
      </div>

      <div class="galeria-avatares" style="margin-top:18px">
        @for (clave of galeria(); track clave) {
          <button type="button" class="opcion-avatar" [class.elegido]="clave === elegido()"
                  (click)="elegido.set(clave)" [attr.aria-label]="'Avatar ' + clave">
            <img [src]="miniatura(clave)" alt="">
          </button>
        }
      </div>

      <div style="display:flex;gap:12px;align-items:center;margin-top:22px;flex-wrap:wrap">
        <button class="boton" type="button" (click)="guardar()"
                [disabled]="guardando() || elegido() === actual()">
          {{ guardando() ? 'Guardando…' : 'Guardar avatar' }}
        </button>
        @if (elegido() !== actual()) {
          <button class="boton contorno" type="button" (click)="elegido.set(actual())">Deshacer</button>
        }
        @if (mensaje()) { <span class="insignia verde">{{ mensaje() }}</span> }
      </div>

      @if (error()) { <div class="aviso malo" style="margin-top:14px">{{ error() }}</div> }

      <p class="chico suave" style="margin-top:22px">
        Avatares generados con <a href="https://dicebear.com" target="_blank" rel="noopener">DiceBear</a>.
        Estilos de Lisa Wischofsky, Pablo Stanley, Zoish y Davis Uche (CC BY 4.0), y de DiceBear (CC0).
      </p>
    </div>
  `,
})
export class PerfilComponent {
  protected perfil = inject(PerfilStore);
  private datos = inject(DatosService);
  private avatares = inject(AvatarService);

  private tanda = signal(0);

  actual = computed(() => this.perfil.perfil()?.avatar ?? 'thumbs:inicial');
  elegido = signal('thumbs:inicial');
  galeria = computed(() =>
    this.avatares.galeria(`${this.perfil.perfil()?.nombre ?? 'pulso'}-${this.tanda()}`, 20)
  );
  vistaPrevia = computed(() => this.avatares.imagen(this.elegido(), 152));

  guardando = signal(false);
  mensaje = signal('');
  error = signal('');

  constructor() {
    this.perfil.cargar().then(() => this.elegido.set(this.actual()));
  }

  miniatura(clave: string): string {
    return this.avatares.imagen(clave, 96);
  }

  otraTanda(): void {
    this.tanda.update(n => n + 1);
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    this.mensaje.set('');
    this.error.set('');
    try {
      await this.datos.guardarAvatar(this.elegido());
      await this.perfil.cargar(true);
      this.mensaje.set('Avatar actualizado');
      setTimeout(() => this.mensaje.set(''), 2600);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo guardar el avatar.');
    } finally {
      this.guardando.set(false);
    }
  }
}
