import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AvatarService } from './avatar.service';
import { DatosService } from './datos.service';
import { PerfilStore } from './perfil.store';

/**
 * Estructura de las pantallas con sesión: barra lateral azul a la izquierda,
 * contenido sobre fondo gris claro a la derecha.
 */
@Component({
  selector: 'app-marco',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="aplicacion">
      <aside class="lateral">
        <div class="marca">
          <img src="pulso-isotipo-96.png" alt="Pulso">
          <span>Pulso</span>
        </div>

        <nav class="menu">
          @if (perfil.esDocente()) {
            <a routerLink="/curso" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 2.9-5.4 6.5-5.4S15.5 16.7 15.5 20"/>
                <path d="M17 11.5a2.6 2.6 0 1 0 0-5.2"/><path d="M18.5 20c0-2.4-.9-4-2.4-4.9"/>
              </svg>
              <span>Curso</span>
            </a>
          } @else {
            <a routerLink="/inicio" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>
              </svg>
              <span>Inicio</span>
            </a>
            <a routerLink="/pase" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 5.5H4.5V8a3 3 0 0 0 2.7 3"/>
                <path d="M17 5.5h2.5V8a3 3 0 0 1-2.7 3"/><path d="M12 15v3"/><path d="M8.5 21h7l-.7-3h-5.6z"/>
              </svg>
              <span>Pase</span>
            </a>
            <a routerLink="/misiones" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3.2l2.3 4.8 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.5 8.8l5.2-.8z"/>
              </svg>
              <span>Misión del día</span>
            </a>
            <a routerLink="/clases" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 5.5h18v11H3z"/><path d="M12 16.5V21"/><path d="M8 21h8"/>
                <path d="M7.5 9.5h6"/><path d="M7.5 12.5h9"/>
              </svg>
              <span>Clases</span>
            </a>
            <a routerLink="/actividades" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 5h9.5v15H5.5V5H9"/><path d="M9 3.5h5V6H9z"/>
                <path d="M8.5 11.5l1.8 1.8 3.7-3.7"/><path d="M8.5 16.5h7"/>
              </svg>
              <span>Actividades</span>
            </a>
            <a routerLink="/ramos" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 5.5h6.5a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H4z"/>
                <path d="M20 5.5h-6.5a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2H20z"/>
              </svg>
              <span>Mis ramos</span>
            </a>
            <a routerLink="/perfil" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>
              </svg>
              <span>Mi perfil</span>
            </a>
            <a routerLink="/puntos" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>
              </svg>
              <span>Mis puntos</span>
            </a>
            <a routerLink="/tienda" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 8h16l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H6.7a1.5 1.5 0 0 1-1.5-1.3z"/>
                <path d="M8.8 8V6.2a3.2 3.2 0 0 1 6.4 0V8"/>
              </svg>
              <span>Tienda</span>
            </a>
            <a routerLink="/ficha" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 3h12v18H6z"/><path d="M9 7.5h6"/><path d="M9 12h6"/><path d="M9 16.5h3.5"/>
              </svg>
              <span>Mi ficha</span>
            </a>
          }
        </nav>

        <div class="pie">
          @if (perfil.esDocente()) {
            <div class="usuario-lateral">
              <img [src]="avatar()" alt="">
              <div class="datos">
                <div class="nom">Cristian Calderón</div>
                <div class="sec">Docente</div>
              </div>
            </div>
          } @else if (perfil.perfil(); as p) {
            <!-- El ramo elegido manda sobre casi todo lo que se muestra, así que
                 el selector vive acá, siempre a la vista. Con un solo ramo no
                 aparece: sería una lista de un elemento. -->
            @if (perfil.ramos().length > 1) {
              <label class="selector-ramo">
                <span class="etiqueta">Ramo</span>
                <select [value]="perfil.ramoId()"
                        (change)="cambiarRamo($any($event.target).value)">
                  @for (r of perfil.ramos(); track r.matricula_id) {
                    <option [value]="r.matricula_id">
                      {{ r.sigla }} · {{ r.seccion }} · {{ r.periodo }}
                    </option>
                  }
                </select>
              </label>
            }
            <div class="usuario-lateral">
              <img [src]="avatar()" alt="">
              <div class="datos">
                <div class="nom">{{ p.nombre }}</div>
                <div class="sec">
                  @if (perfil.ramo(); as r) {
                    {{ r.sigla }} · Sección {{ r.seccion }}
                  } @else {
                    Sin ramos
                  }
                </div>
              </div>
            </div>
          }
          <nav class="menu" style="margin-top:6px">
            <button type="button" (click)="salir()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12 4H5v16h7"/>
              </svg>
              <span>Salir</span>
            </button>
          </nav>
        </div>
      </aside>

      <main class="contenido">
        <router-outlet />
      </main>
    </div>
  `,
})
export class MarcoComponent {
  protected perfil = inject(PerfilStore);
  private datos = inject(DatosService);
  private avatares = inject(AvatarService);
  private router = inject(Router);

  avatar = computed(() =>
    this.avatares.imagen(
      this.perfil.esDocente() ? 'notionists:cristian-calderon' : (this.perfil.perfil()?.avatar ?? 'thumbs:inicial'),
      72
    )
  );

  constructor() {
    this.perfil.cargar();
  }

  cambiarRamo(matriculaId: string): void {
    this.perfil.elegirRamo(matriculaId);
  }

  async salir(): Promise<void> {
    await this.datos.salir();
    this.perfil.limpiar();
    this.router.navigate(['/ingresar']);
  }
}
