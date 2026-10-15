import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Clase, Ramo } from './datos.service';
import { DatosService } from './datos.service';
import { agruparPorExperiencia, experienciaEnCurso } from './experiencias';
import { PerfilStore } from './perfil.store';

/**
 * Los minijuegos del ramo: el repaso jugable de la evaluación en curso.
 *
 * En la base un minijuego es una clase con `tipo = 'minijuego'`: se sirve por
 * `/api/clase`, lo instrumenta el mismo rastreo y lo pagan las mismas funciones.
 * Por eso cada juego paga lo suyo y una sola vez: abrirlo, cada pregunta de
 * control acertada y llegar al cierre. Esta pantalla es la de Clases con otro
 * resumen arriba —cuánto del repaso lleva hecho— y sin el botón de descargar:
 * los puntos son de jugarlo acá.
 */
@Component({
  selector: 'app-minijuegos',
  imports: [DecimalPipe],
  template: `
    <div class="encabezado">
      <h1>Minijuegos</h1>
      <p>
        El repaso jugable de la evaluación{{ perfil.ramo() ? ' · ' + perfil.ramo()!.asignatura : '' }}.
      </p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (juegos().length === 0) {
      <div class="tarjeta">
        <div class="aviso dato">
          Todavía no hay minijuegos publicados en este ramo.
        </div>
      </div>
    } @else {
      <div class="rejilla tres" style="margin-bottom:18px">
        <div class="tarjeta">
          <p class="etiqueta">Terminados</p>
          <p class="cifra destacada" data-mj-resumen="terminados">
            {{ terminados() }}<span class="suave" style="font-size:20px">/{{ juegos().length }}</span>
          </p>
          <div style="height:6px;border-radius:99px;background:var(--borde);overflow:hidden;margin-top:8px">
            <div [style.width.%]="porcentajeTerminados()"
                 style="height:100%;background:var(--celeste);transition:width .3s"></div>
          </div>
        </div>
        <div class="tarjeta">
          <p class="etiqueta">Preguntas de control</p>
          <p class="cifra" data-mj-resumen="preguntas">
            {{ preguntasResueltas() }}<span class="suave" style="font-size:20px">/{{ preguntasTotales() }}</span>
          </p>
          <p class="chico suave">acertadas, entre todos los juegos</p>
        </div>
        <div class="tarjeta">
          <p class="etiqueta">Puntos por ganar</p>
          <p class="cifra" data-mj-resumen="por-ganar">{{ totalPorGanar() }}</p>
          <p class="chico suave">en los minijuegos que te quedan</p>
        </div>
      </div>

      <div class="tarjeta" style="margin-bottom:18px">
        <p class="chico suave" style="margin:0">
          Cada minijuego paga por separado: <strong>{{ juegos()[0].puntos_abrir }} puntos</strong>
          por abrirlo, <strong>{{ juegos()[0].puntos_actividad }}</strong> por cada pregunta de
          control que aciertes y <strong>{{ juegos()[0].puntos_terminar }}</strong> por llegar al
          cierre. Cada cosa se paga una sola vez: volver a jugar es para practicar.
        </p>
        @if (hayPlazos()) {
          <p class="chico suave" style="margin:10px 0 0">
            Algunos tienen plazo: mientras esté abierto pagan completo, y después siguen
            sumando pero menos.
          </p>
        }
      </div>

      @for (g of grupos(); track g.numero) {
        <details class="experiencia" [open]="g.numero === null || g.numero === enCurso()">
          <summary>
            <span class="experiencia-titulo">{{ g.titulo }}</span>
            <span class="chico suave">{{ g.terminados }} de {{ g.items.length }} terminados</span>
          </summary>
          <div class="rejilla dos">
            @for (j of g.items; track j.id) {
              <div class="tarjeta" [attr.data-minijuego]="j.codigo">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
                  <div>
                    <p class="etiqueta">Minijuego {{ j.codigo }}</p>
                    <h2 style="margin-top:4px">{{ j.titulo }}</h2>
                  </div>
                  @if (j.terminada_en) {
                    <span class="insignia verde">Terminado</span>
                  } @else if (j.abierta) {
                    <span class="insignia amarilla">En curso</span>
                  } @else {
                    <span class="insignia celeste">Nuevo</span>
                  }
                </div>

                @if (j.ventana_hasta && !j.terminada_en && !j.en_ventana) {
                  <p class="chico suave" style="margin-top:10px">
                    El plazo cerró: ahora paga
                    <strong>{{ j.factor_atrasado * 100 | number:'1.0-0' }}%</strong> de los puntos.
                  </p>
                }

                @if (j.descripcion) {
                  <p class="chico suave" style="margin-top:10px">{{ j.descripcion }}</p>
                }

                <!-- Lo que paga este juego, tramo por tramo, y qué ya cobró. -->
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:14px">
                  <span class="insignia" [class.verde]="j.abierta">
                    Abrir · {{ j.puntos_abrir }}
                  </span>
                  @if (j.actividades > 0) {
                    <span class="insignia" [class.verde]="j.resueltas >= j.actividades">
                      Preguntas {{ j.resueltas }}/{{ j.actividades }} · {{ j.puntos_actividad }} c/u
                    </span>
                  }
                  <span class="insignia" [class.verde]="!!j.terminada_en">
                    Cierre · {{ j.puntos_terminar }}
                  </span>
                </div>

                @if (j.abierta && !j.terminada_en) {
                  <div style="margin-top:14px">
                    <div style="height:6px;border-radius:99px;background:var(--borde);overflow:hidden">
                      <div [style.width.%]="avance(j)"
                           style="height:100%;background:var(--celeste);transition:width .3s"></div>
                    </div>
                    <p class="chico suave" style="margin-top:8px">
                      Vas en la etapa {{ (j.slide_max ?? 0) + 1 }} de {{ j.slides }}
                    </p>
                  </div>
                }

                <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:18px;flex-wrap:wrap">
                  @if (porGanar(j) > 0) {
                    <span class="insignia celeste">{{ porGanar(j) }} puntos por ganar</span>
                  } @else {
                    <span class="insignia verde">Todo cobrado</span>
                  }
                  <a class="boton chico" [class.accion]="!j.abierta" [class.contorno]="j.abierta"
                     [href]="'/api/clase?id=' + j.id" target="_blank" rel="noopener"
                     (click)="alVolver()">
                    {{ j.terminada_en ? 'Jugar de nuevo' : j.abierta ? 'Seguir' : 'Jugar' }}
                  </a>
                </div>
              </div>
            }
          </div>
        </details>
      }
    }
  `,
})
export class MinijuegosComponent {
  private datos = inject(DatosService);
  protected perfil = inject(PerfilStore);

  juegos = signal<Clase[]>([]);
  private experiencias = signal<string[]>([]);
  cargando = signal(true);

  grupos = computed(() =>
    agruparPorExperiencia(this.juegos(), this.experiencias())
      .map(g => ({ ...g, terminados: g.items.filter(j => !!j.terminada_en).length })));
  enCurso = computed(() => experienciaEnCurso(this.grupos()));

  terminados = computed(() => this.juegos().filter(j => !!j.terminada_en).length);
  porcentajeTerminados = computed(() =>
    this.juegos().length ? Math.round((this.terminados() / this.juegos().length) * 100) : 0);
  preguntasResueltas = computed(() =>
    this.juegos().reduce((s, j) => s + Math.min(j.resueltas, j.actividades), 0));
  preguntasTotales = computed(() => this.juegos().reduce((s, j) => s + j.actividades, 0));
  totalPorGanar = computed(() => this.juegos().reduce((s, j) => s + this.porGanar(j), 0));
  hayPlazos = computed(() => this.juegos().some(j => !!j.ventana_hasta));

  /** Igual que en Clases: reacciona a la matrícula y lee el ramo sin registrarlo. */
  constructor() {
    effect(() => {
      const ramo = this.perfil.matricula() ? untracked(() => this.perfil.ramo()) : null;
      if (ramo) void this.cargar(ramo);
      else this.cargando.set(false);
    });
    void this.perfil.cargar();
  }

  private async cargar(ramo: Ramo): Promise<void> {
    this.cargando.set(true);
    try {
      const [clases, experiencias] = await Promise.all([
        this.datos.clases(ramo),
        this.datos.experiencias(ramo),
      ]);
      this.juegos.set(clases.filter(c => c.tipo === 'minijuego'));
      this.experiencias.set(experiencias);
    } finally {
      this.cargando.set(false);
    }
  }

  /** Al volver de la pestaña del juego se recarga, para ver lo recién ganado. */
  alVolver(): void {
    const alVolverAca = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', alVolverAca);
      const ramo = this.perfil.ramo();
      if (ramo) void this.cargar(ramo);
    };
    document.addEventListener('visibilitychange', alVolverAca);
  }

  avance(j: Clase): number {
    if (!j.slides) return 0;
    return Math.min(100, Math.round((((j.slide_max ?? 0) + 1) / j.slides) * 100));
  }

  /** Lo que le queda por cobrar en el juego, con el factor si el plazo cerró. */
  porGanar(j: Clase): number {
    const factor = j.en_ventana ? 1 : Number(j.factor_atrasado);
    const abrir = j.abierta ? 0 : Math.round(j.puntos_abrir * factor);
    const preguntas = Math.max(0, j.actividades - j.resueltas)
      * Math.round(j.puntos_actividad * factor);
    const cierre = j.terminada_en ? 0 : Math.round(j.puntos_terminar * factor);
    return abrir + preguntas + cierre;
  }
}
