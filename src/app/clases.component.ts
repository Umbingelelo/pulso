import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Clase, DatosService } from './datos.service';
import { PerfilStore } from './perfil.store';

/**
 * Las clases del ramo, para abrirlas y ganar puntos.
 *
 * El enlace es un `<a href>` de toda la vida con `target="_blank"`, y no un
 * `routerLink` ni un `fetch`: el deck es una página completa que se sirve desde
 * `/api/clase`, fuera de Angular. Abrirla en una pestaña nueva es además lo que
 * uno quiere para estudiar, y funciona porque la sesión viaja en la cookie.
 *
 * Al volver de esa pestaña se recarga la lista, así el avance y los puntos que
 * acaba de ganar aparecen sin tener que refrescar a mano.
 */
@Component({
  selector: 'app-clases',
  imports: [DatePipe],
  template: `
    <div class="encabezado">
      <h1>Clases</h1>
      <p>{{ perfil.ramo()?.asignatura ?? 'El material de cada sesión, para repasar cuando quieras.' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (clases().length === 0) {
      <div class="tarjeta">
        <div class="aviso dato">
          Todavía no hay clases publicadas en este ramo. Aparecen acá después de cada sesión.
        </div>
      </div>
    } @else {
      <div class="tarjeta" style="margin-bottom:18px">
        <p class="chico suave" style="margin:0">
          Abre una clase y suma <strong>{{ clases()[0].puntos_abrir }} puntos</strong>.
          Cada actividad que resuelvas bien dentro del deck vale
          <strong>{{ clases()[0].puntos_actividad }}</strong>, y llegar al final,
          <strong>{{ clases()[0].puntos_terminar }}</strong>. Cada cosa se paga una sola vez.
        </p>
        @if (hayPlazos()) {
          <p class="chico suave" style="margin:10px 0 0">
            Las clases tienen plazo: mientras esté abierto pagan completo, y después
            siguen sumando pero menos. Verla el día de la clase es lo que más rinde.
          </p>
        }
      </div>

      <div class="rejilla dos">
        @for (c of clases(); track c.id) {
          <div class="tarjeta">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
              <div>
                <p class="etiqueta">Clase {{ c.codigo }}</p>
                <h2 style="margin-top:4px">{{ c.titulo }}</h2>
              </div>
              @if (c.terminada_en) {
                <span class="insignia verde">Terminada</span>
              } @else if (c.abierta) {
                <span class="insignia amarilla">En curso</span>
              } @else {
                <span class="insignia celeste">Nueva</span>
              }
            </div>

            @if (c.ventana_hasta && !c.terminada_en) {
              @if (c.en_ventana) {
                <p class="chico" style="margin-top:10px;color:var(--ok,#3fb950)">
                  <strong>Puntos completos</strong> hasta el
                  {{ c.ventana_hasta | date:'dd/MM' }} a las
                  {{ c.ventana_hasta | date:'HH:mm' }}.
                </p>
              } @else {
                <p class="chico suave" style="margin-top:10px">
                  El plazo cerró: ahora paga
                  <strong>{{ porcentaje(c) }}%</strong> de los puntos. Igual conviene verla.
                </p>
              }
            }

            @if (c.descripcion) {
              <p class="chico suave" style="margin-top:10px">{{ c.descripcion }}</p>
            }

            @if (c.abierta) {
              <div style="margin-top:16px">
                <div style="height:6px;border-radius:99px;background:rgba(255,255,255,.09);overflow:hidden">
                  <div [style.width.%]="avance(c)"
                       style="height:100%;background:var(--acento, #2f81f7);transition:width .3s"></div>
                </div>
                <p class="chico suave" style="margin-top:8px">
                  Vas en la diapositiva {{ (c.slide_max ?? 0) + 1 }} de {{ c.slides }}
                  @if (c.actividades > 0) {
                    · {{ c.resueltas }} de {{ c.actividades }} actividades resueltas
                  }
                </p>
              </div>
            }

            <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:18px;flex-wrap:wrap">
              <span class="insignia celeste">{{ porGanar(c) }} puntos por ganar</span>
              <a class="boton chico" [class.accion]="!c.abierta" [class.contorno]="c.abierta"
                 [href]="'/api/clase?id=' + c.id" target="_blank" rel="noopener"
                 (click)="alVolver()">
                {{ c.abierta ? 'Seguir' : 'Abrir la clase' }}
              </a>
            </div>

            @if (c.dictada_el) {
              <p class="chico suave" style="margin-top:12px">
                Dictada el {{ c.dictada_el | date:'dd/MM/yyyy' }}
              </p>
            }
          </div>
        }
      </div>
    }
  `,
})
export class ClasesComponent {
  private datos = inject(DatosService);
  protected perfil = inject(PerfilStore);

  clases = signal<Clase[]>([]);
  cargando = signal(true);

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      await this.perfil.cargar();
      const ramo = this.perfil.ramo();
      if (!ramo) return;
      this.clases.set(await this.datos.clases(ramo));
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Al hacer clic se abre otra pestaña; cuando el alumno vuelve a esta, se
   * recarga. Es la forma barata de que el avance se vea al día sin sondear al
   * servidor mientras estudia en la otra pestaña.
   */
  alVolver(): void {
    const alVolverAca = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', alVolverAca);
      this.cargar();
    };
    document.addEventListener('visibilitychange', alVolverAca);
  }

  avance(c: Clase): number {
    if (!c.slides) return 0;
    return Math.min(100, Math.round((((c.slide_max ?? 0) + 1) / c.slides) * 100));
  }

  /** Si alguna clase del ramo tiene plazo, se explica el sistema arriba. */
  hayPlazos(): boolean {
    return this.clases().some(c => !!c.ventana_hasta);
  }

  porcentaje(c: Clase): number {
    return Math.round(Number(c.factor_atrasado) * 100);
  }

  /**
   * Lo que todavía no ha cobrado en esta clase, ya con el factor aplicado: si el
   * plazo cerró, mostrar el número completo sería prometerle puntos que no va a
   * recibir.
   */
  porGanar(c: Clase): number {
    const factor = c.en_ventana ? 1 : Number(c.factor_atrasado);
    const abrir = c.abierta ? 0 : Math.round(c.puntos_abrir * factor);
    const actividades = Math.max(0, c.actividades - c.resueltas)
      * Math.round(c.puntos_actividad * factor);
    const terminar = c.terminada_en ? 0 : Math.round(c.puntos_terminar * factor);
    return abrir + actividades + terminar;
  }
}
