import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Clase, Ramo } from './datos.service';
import { DatosService } from './datos.service';
import { agruparPorExperiencia, experienciaEnCurso } from './experiencias';
import { PerfilStore } from './perfil.store';

/**
 * El sprite del jefe final, en pixel art: una letra por píxel, y solo la mitad
 * izquierda: la derecha es su espejo, así queda simétrico sin cuidarlo a mano.
 * k contorno · r cuerpo · d sombra · h cuernos · y ojos · w dientes · o fuego.
 */
const SPRITE_MITAD = [
  '...h.......',
  '..hh.......',
  '..hhh......',
  '...hhk..kkk',
  '....hkkkrrr',
  '.....krrrrr',
  '....krrdrrr',
  '...krrkyykr',
  '...krrkyykr',
  '...krrrkkrr',
  '..kdrrrrrrd',
  '..kdrrkwkwk',
  '..kddrkkwkw',
  '...kddrrkkk',
  '..okkddrrrr',
  '.oorkkkdddd',
  'oorrk.kkkkk',
  '.oo..ok..o.',
  '..o...o....',
];
const SPRITE_MAPA = SPRITE_MITAD.map(f => f + [...f].reverse().join(''));
const SPRITE_COLORES: Record<string, string> = {
  k: '#14070a', r: '#c0263a', d: '#7a1222', h: '#e9dcc4', y: '#ffd25e', w: '#ffffff', o: '#ff8a3d',
};
const SPRITE = SPRITE_MAPA.flatMap((fila, y) => [...fila].flatMap((c, x) =>
  c === '.' ? [] : [{ x, y, color: SPRITE_COLORES[c], ojo: c === 'y' }]));

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
  styles: `
    .jefe-fondo {
      position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 18px;
      background: radial-gradient(circle at 50% 30%, rgba(120, 10, 20, .55), rgba(5, 5, 10, .92) 70%);
      backdrop-filter: blur(3px); animation: jefe-entra .35s ease-out both;
    }
    .jefe {
      width: min(620px, 100%); max-height: calc(100dvh - 36px); overflow-y: auto;
      background: linear-gradient(180deg, #1b0b10 0%, #0d0b12 100%); color: #f4e9e9;
      border: 2px solid #c0263a; border-radius: 18px; padding: 26px 26px 22px;
      box-shadow: 0 0 0 1px rgba(255, 80, 90, .25), 0 0 60px rgba(192, 38, 58, .45);
      animation: jefe-golpe .6s cubic-bezier(.2, 1.4, .4, 1) .1s both;
    }
    .jefe-alerta { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 800;
      letter-spacing: .22em; text-transform: uppercase; color: #ff5a6a; }
    .jefe-alerta::before { content: ''; width: 10px; height: 10px; border-radius: 50%; background: #ff3b4e;
      box-shadow: 0 0 12px #ff3b4e; animation: jefe-late 1s ease-in-out infinite; }
    .jefe h2 { margin: 10px 0 4px; font-size: clamp(26px, 5vw, 36px); line-height: 1.1; color: #fff;
      text-shadow: 0 0 18px rgba(255, 60, 80, .55); }
    .jefe-sub { margin: 0 0 16px; color: #d7b9bd; font-size: 15px; }
    .jefe-vida { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; font-size: 12px;
      font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #ffb3bb; }
    .jefe-vida-barra { flex: 1; height: 12px; border-radius: 99px; background: #3a1018;
      border: 1px solid #6d1a28; overflow: hidden; }
    .jefe-vida-barra i { display: block; height: 100%; width: 100%;
      background: linear-gradient(90deg, #ff3b4e, #ff8a3d); animation: jefe-llena 1.2s ease-out .4s both; }
    .jefe ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; counter-reset: fase; }
    .jefe li { counter-increment: fase; position: relative; padding: 10px 12px 10px 46px; border-radius: 12px;
      background: rgba(255, 255, 255, .04); border: 1px solid rgba(255, 90, 106, .18); font-size: 15px;
      line-height: 1.45; animation: jefe-fase .4s ease-out both; }
    .jefe li::before { content: counter(fase); position: absolute; left: 12px; top: 10px; width: 24px; height: 24px;
      border-radius: 7px; display: grid; place-items: center; font-weight: 900; font-size: 13px;
      background: #c0263a; color: #fff; }
    .jefe li.clave { border-color: #ffb800; background: rgba(255, 184, 0, .08); }
    .jefe li.clave strong { color: #ffd25e; }
    .jefe-tip { display: block; margin-top: 6px; font-size: 13.5px; color: #d7b9bd; }
    .jefe-sprite { display: block; width: min(176px, 42vw); height: auto; margin: -4px auto 12px;
      filter: drop-shadow(0 0 14px rgba(255, 60, 80, .55)); animation: jefe-flota 2.4s ease-in-out infinite; }
    .jefe-ojo { animation: jefe-ojos 1.6s steps(2, jump-none) infinite; }
    @keyframes jefe-flota { 50% { transform: translateY(-6px); } }
    @keyframes jefe-ojos { 50% { fill: #fff6a8; } }
    .jefe-acciones { display: flex; justify-content: flex-end; margin-top: 20px; }
    .jefe-acciones button { font: inherit; font-weight: 800; font-size: 16px; letter-spacing: .02em;
      padding: 12px 22px; border-radius: 12px; border: 0; cursor: pointer; color: #fff;
      background: linear-gradient(135deg, #c0263a, #ff5a3d); box-shadow: 0 6px 22px rgba(192, 38, 58, .5); }
    .jefe-acciones button:focus-visible { outline: 3px solid #ffd25e; outline-offset: 2px; }
    @keyframes jefe-entra { from { opacity: 0; } }
    @keyframes jefe-golpe { from { opacity: 0; transform: scale(.85) translateY(20px); } }
    @keyframes jefe-late { 50% { opacity: .35; } }
    @keyframes jefe-llena { from { width: 0; } }
    @keyframes jefe-fase { from { opacity: 0; transform: translateX(-10px); } }
    @media (prefers-reduced-motion: reduce) {
      .jefe-fondo, .jefe, .jefe li, .jefe-vida-barra i, .jefe-alerta::before,
      .jefe-sprite, .jefe-ojo { animation: none; }
    }
  `,
  template: `
    <!-- El desafío de DSY1107: se presenta como un jefe final apenas se entra a la
         sección, para que el incentivo sea el juego y no solo los puntos. -->
    @if (verDesafio()) {
      <div class="jefe-fondo" role="dialog" aria-modal="true" aria-labelledby="jefe-titulo">
        <div class="jefe">
          <svg class="jefe-sprite" [attr.viewBox]="'0 0 ' + SPRITE_ANCHO + ' ' + SPRITE_ALTO"
               shape-rendering="crispEdges" role="img" aria-label="El jefe final">
            @for (p of SPRITE; track $index) {
              <rect [attr.x]="p.x" [attr.y]="p.y" width="1" height="1" [attr.fill]="p.color"
                    [class.jefe-ojo]="p.ojo"/>
            }
          </svg>
          <div class="jefe-alerta">Jefe final · se acerca</div>
          <h2 id="jefe-titulo">Bienvenido a los Juegos del Hambre</h2>
          <p class="jefe-sub">Quince minijuegos. Un solo grupo elige primero.</p>
          <div class="jefe-vida"><span>Desafío</span><span class="jefe-vida-barra"><i></i></span></div>
          <ol>
            <li style="animation-delay:.5s">Inicia sesión en Pulso.</li>
            <li style="animation-delay:.6s">Ve a la sección <strong>Minijuegos</strong>.</li>
            <li style="animation-delay:.7s">Empieza a completar los minijuegos de forma individual.</li>
            <li style="animation-delay:.8s">
              El grupo que tenga al integrante con <strong>todos listos</strong> le avisa al profe
              (si nadie termina, gana el que llegue más lejos).
              <span class="jefe-tip"><strong>Pro tip:</strong> si se la quieren vivir, que todo el grupo
                juegue en la cuenta de uno solo, así todos apoyan con las respuestas.</span>
            </li>
            <li class="clave" style="animation-delay:.9s">
              Según el orden en que terminen, van a <strong>poder elegir el orden de presentación de su grupo</strong>.
            </li>
            <li style="animation-delay:1s">Suerte :)</li>
          </ol>
          <div class="jefe-acciones">
            <button type="button" (click)="desafioCerrado.set(true)" autofocus>Aceptar el desafío</button>
          </div>
        </div>
      </div>
    }

    <div class="encabezado">
      <h1>Minijuegos</h1>
      <p>
        El repaso jugable de la evaluación{{ perfil.ramo() ? ' · ' + perfil.ramo()!.asignatura : '' }}.
      </p>
      @if (hayDesafio()) {
        <button type="button" class="boton chico contorno" style="margin-top:10px"
                (click)="desafioCerrado.set(false)">Ver el desafío</button>
      }
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

  /**
   * Solo DSY1107 tiene el desafío del orden de presentación, y solo con juegos
   * publicados: antes de la hora de apertura no hay nada que desafiar. Se muestra
   * cada vez que se entra a la sección; volver desde la pestaña de un juego no lo
   * repite, porque la pantalla no se vuelve a crear.
   */
  hayDesafio = computed(() => this.perfil.ramo()?.sigla === 'DSY1107' && this.juegos().length > 0);
  protected readonly SPRITE = SPRITE;
  protected readonly SPRITE_ANCHO = SPRITE_MAPA[0].length;
  protected readonly SPRITE_ALTO = SPRITE_MAPA.length;
  desafioCerrado = signal(false);
  verDesafio = computed(() => this.hayDesafio() && !this.desafioCerrado());


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
