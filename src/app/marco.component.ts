import { Component, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AvatarService } from './avatar.service';
import { DatosService } from './datos.service';
import { DocenteStore } from './docente.store';
import { PerfilStore } from './perfil.store';
import { ReunionStore } from './reunion.store';

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
          <!-- Hasta que el perfil resuelva no se dibuja ningún menú: esDocente
               arranca en false, así que sin esta guarda el docente veía el menú
               de alumno un segundo antes de que se cambiara solo.
               (Sin acentos graves acá: esto vive dentro de un template literal.) -->
          @if (!perfil.resuelto()) {
            <span class="cargando-menu" aria-hidden="true"></span>
          } @else if (perfil.esDocente()) {
            <a routerLink="/curso" routerLinkActive="activo" [routerLinkActiveOptions]="{exact:true}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9 9v11"/>
              </svg>
              <span>Resumen</span>
            </a>
            <a routerLink="/curso/clases" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 5.5h18v11H3z"/><path d="M12 16.5V21"/><path d="M8 21h8"/>
                <path d="M7.5 9.5h6"/><path d="M7.5 12.5h9"/>
              </svg>
              <span>Clases</span>
            </a>
            <a routerLink="/curso/actividades" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 5h9.5v15H5.5V5H9"/><path d="M9 3.5h5V6H9z"/>
                <path d="M8.5 11.5l1.8 1.8 3.7-3.7"/><path d="M8.5 16.5h7"/>
              </svg>
              <span>Actividades</span>
            </a>
            <a routerLink="/curso/alumnos" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 2.9-5.4 6.5-5.4S15.5 16.7 15.5 20"/>
                <path d="M17 11.5a2.6 2.6 0 1 0 0-5.2"/><path d="M18.5 20c0-2.4-.9-4-2.4-4.9"/>
              </svg>
              <span>Alumnos</span>
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
            <a routerLink="/gacha" routerLinkActive="activo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 9h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>
                <path d="M3 5.5h18V9H3z"/><path d="M12 5.5V21"/>
                <path d="M12 5.5C10.5 3 8 3 8 4.6c0 1 1.4 1 4 .9"/>
                <path d="M12 5.5c1.5-2.5 4-2.5 4-.9 0 1-1.4 1-4 .9"/>
              </svg>
              <span>Gacha</span>
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

        <!-- El aviso de reunión va acá arriba, pegado a la marca y antes de
             cualquier menú: si estuviera abajo con los datos del usuario, el
             alumno que llega a preguntar no lo vería nunca. -->
        @if (reuniones.enReunion()) {
          <div class="en-reunion" role="status">
            <div class="fila">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
              </svg>
              <strong>El profe está en reunión</strong>
            </div>
            <p>Ahora no puede atender consultas. Sigue trabajando y anótalas para después.</p>
            @if (reuniones.descuento(); as d) {
              <a routerLink="/tienda" class="premio">Tienda con {{ d }}% de descuento</a>
            }
          </div>
        }

        <div class="pie">
          @if (perfil.esDocente()) {
            @if (docente.ramos().length > 1) {
              <label class="selector-ramo">
                <span class="etiqueta">Ramo</span>
                <select [value]="docente.ramoId()"
                        (change)="docente.elegir($any($event.target).value)">
                  @for (r of docente.ramos(); track r.asignatura_id + r.periodo_id) {
                    <option [value]="docente.clave(r)">{{ r.sigla }} · {{ r.periodo }}</option>
                  }
                </select>
              </label>
            }
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
  styles: [`
    /* La barra lateral es azul oscuro, así que el aviso se hace ver con un
       amarillo cálido en vez de con un rojo de error: el profe en reunión no es
       una falla, es una situación. */
    .en-reunion{
      margin:0 12px 14px; padding:11px 13px; border-radius:10px;
      background:rgba(251,191,36,.14); border:1px solid rgba(251,191,36,.42);
      color:#FDE9B8; font-size:12.5px; line-height:1.45;
    }
    .en-reunion .fila{ display:flex; align-items:center; gap:7px; }
    .en-reunion svg{ width:15px; height:15px; flex:none; color:#FBBF24; }
    .en-reunion strong{ color:#FDE9B8; font-size:13px; }
    .en-reunion p{ margin:5px 0 0; opacity:.82; }
    .en-reunion .premio{
      display:block; margin-top:9px; padding:6px 9px; border-radius:7px;
      background:rgba(251,191,36,.2); color:#FFF6E0; font-weight:600; text-align:center;
      text-decoration:none;
    }
    .en-reunion .premio:hover{ background:rgba(251,191,36,.32); }
  `],
})
export class MarcoComponent {
  protected perfil = inject(PerfilStore);
  protected docente = inject(DocenteStore);
  protected reuniones = inject(ReunionStore);

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
    // El selector de ramo del docente vive en esta barra, así que sus ramos hay
    // que pedirlos acá: si solo los cargara la pantalla que los usa, el selector
    // saldría vacío hasta que entrara a alguna sección.
    effect(() => {
      if (this.perfil.esDocente()) this.docente.cargar();
    });
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
