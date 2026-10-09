import { Component, inject } from '@angular/core';
import { TemaService } from './tema.service';

/**
 * El interruptor de tema para las pantallas sin barra lateral (ingresar y
 * registro). Dentro de la app el mismo interruptor vive en la barra lateral,
 * junto a «Salir». Va pegado a la esquina para no ocupar sitio en la tarjeta.
 */
@Component({
  selector: 'app-boton-tema',
  template: `
    <button type="button" class="tema-flotante"
            [attr.aria-pressed]="tema.tema() === 'oscuro'"
            aria-label="Modo oscuro"
            [attr.title]="tema.tema() === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'"
            (click)="tema.alternar()">
      @if (tema.tema() === 'oscuro') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
        </svg>
      } @else {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/>
        </svg>
      }
    </button>
  `,
  styles: [`
    .tema-flotante{
      position:fixed; top:16px; right:16px; z-index:10;
      width:42px; height:42px; display:grid; place-items:center;
      border-radius:50%; cursor:pointer;
      background:var(--blanco); color:var(--texto); border:1.5px solid var(--borde);
      box-shadow:var(--sombra);
      transition:border-color .12s;
    }
    .tema-flotante:hover{ border-color:var(--celeste); }
    .tema-flotante:focus-visible{ outline:2px solid var(--celeste); outline-offset:2px; }
    .tema-flotante svg{ width:20px; height:20px; }
  `],
})
export class BotonTemaComponent {
  protected tema = inject(TemaService);
}
