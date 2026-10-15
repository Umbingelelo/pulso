import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Clase, Ramo } from './datos.service';
import { DatosService } from './datos.service';
import { agruparPorExperiencia, experienciaEnCurso } from './experiencias';
import { PerfilStore } from './perfil.store';

/**
 * El jefe final, el Conejo del Broker, en pixel art: una letra por píxel, y solo
 * la mitad izquierda; la derecha es su espejo, así queda simétrico sin cuidarlo.
 * k contorno · g pelaje · G sombra · p oreja · y ojo · Y brillo · w dientes ·
 * n collar · c corona · C sombra de la corona.
 */
const SPRITE_MITAD = [
  '....kkk.....',
  '...kgGgk....',
  '...kgpGk....',
  '...kgpGk....',
  '...kgpGk....',
  '...kgpGk..c.',
  '...kgpGk.ccc',
  '...kgGgk.cCc',
  '....kgggkkkk',
  '...kggggggGg',
  '..kgggggggGg',
  '..kgkkkkgggg',
  '..kgkyYykggg',
  '..kgkyyykggg',
  '..kggkkkgggg',
  '..kGgggggggk',
  '..kGgggggkpp',
  '...kGggggkkk',
  '...kGGggggkw',
  '....kkGgggkw',
  '...knnkkkkkk',
  '..knnnnnnnnn',
  '..knnnnnncnn',
  '..kkkkkkkkkk',
];
const SPRITE_MAPA = SPRITE_MITAD.map(f => f + [...f].reverse().join(''));
const SPRITE_COLORES: Record<string, string> = {
  k: '#15121a', g: '#e8e2ee', G: '#b9b0c6', p: '#f29ab5', y: '#ff3048', Y: '#ffd34d',
  w: '#ffffff', n: '#3b2f4a', c: '#ffb800', C: '#c98a00',
};
const SPRITE = SPRITE_MAPA.flatMap((fila, y) => [...fila].flatMap((c, x) =>
  c === '.' ? [] : [{ x, y, color: SPRITE_COLORES[c], ojo: c === 'y' }]));

/** Lo que dura una clase de DSY1107: el timer parte con esto al aceptar el desafío. */
const DURACION_DESAFIO_MS = 79 * 60 * 1000;

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
      background: rgba(8, 8, 12, .88); animation: jefe-entra .3s ease-out both;
    }
    .jefe {
      width: min(620px, 100%); max-height: calc(100dvh - 36px); overflow-y: auto;
      background: #16141b; color: #eeeaf2; border: 1px solid #3a3342; border-radius: 18px;
      padding: 26px 26px 22px; animation: jefe-golpe .5s cubic-bezier(.2, 1.3, .4, 1) .05s both;
    }
    .jefe-alerta { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 800;
      letter-spacing: .22em; text-transform: uppercase; color: #ff6b7d; }
    .jefe-alerta::before { content: ''; width: 9px; height: 9px; border-radius: 50%; background: #ff3048;
      animation: jefe-late 1s ease-in-out infinite; }
    .jefe h2 { margin: 10px 0 4px; font-size: clamp(26px, 5vw, 36px); line-height: 1.1; color: #fff; }
    .jefe-sub { margin: 0 0 18px; color: #b9b0c6; font-size: 15px; }
    .jefe ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; counter-reset: fase; }
    .jefe li { counter-increment: fase; position: relative; padding: 10px 12px 10px 46px; border-radius: 12px;
      background: #1e1b25; border: 1px solid #2f2a38; font-size: 15px; line-height: 1.45;
      animation: jefe-fase .35s ease-out both; }
    .jefe li::before { content: counter(fase); position: absolute; left: 12px; top: 10px; width: 24px; height: 24px;
      border-radius: 7px; display: grid; place-items: center; font-weight: 900; font-size: 13px;
      background: #3b2f4a; color: #fff; }
    .jefe li.clave { border-color: #8a6400; background: #2a2212; }
    .jefe li.clave::before { background: #ffb800; color: #1a1300; }
    .jefe li.clave strong { color: #ffd34d; }
    .jefe-tip { display: block; margin-top: 6px; font-size: 13.5px; color: #b9b0c6; }
    .jefe-reloj { margin: 16px 0 0; font-size: 14px; color: #b9b0c6; }
    .jefe-sprite { display: block; width: min(168px, 40vw); height: auto; margin: 4px auto 14px;
      animation: jefe-flota 2.4s ease-in-out infinite; }
    .jefe-ojo { animation: jefe-ojos 1.6s steps(2, jump-none) infinite; }
    .jefe-acciones { display: flex; justify-content: flex-end; margin-top: 18px; }
    .jefe-acciones button { font: inherit; font-weight: 800; font-size: 16px; padding: 12px 22px;
      border-radius: 12px; border: 0; cursor: pointer; color: #1a1300; background: #ffb800; }
    .jefe-acciones button:hover { background: #ffc633; }
    .jefe-acciones button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
    /* El marcador del desafío: fijo arriba a la derecha mientras dura. */
    .marcador {
      position: fixed; top: 14px; right: 14px; z-index: 900; display: flex; gap: 6px;
      background: #16141b; color: #eeeaf2; border: 1px solid #3a3342; border-radius: 14px; padding: 6px;
    }
    .marcador div { padding: 6px 12px; border-radius: 10px; background: #1e1b25; text-align: center; min-width: 74px; }
    .marcador span { display: block; font-size: 10.5px; font-weight: 800; letter-spacing: .12em;
      text-transform: uppercase; color: #b9b0c6; }
    .marcador b { font-size: 20px; font-variant-numeric: tabular-nums; }
    .marcador .fin b { color: #ff6b7d; }
    .marcador .listo b { color: #3ddc84; }
    @media (max-width: 760px) { .marcador { top: auto; bottom: 12px; right: 12px; } }
    @keyframes jefe-entra { from { opacity: 0; } }
    @keyframes jefe-golpe { from { opacity: 0; transform: scale(.9) translateY(16px); } }
    @keyframes jefe-late { 50% { opacity: .35; } }
    @keyframes jefe-fase { from { opacity: 0; transform: translateX(-8px); } }
    @keyframes jefe-flota { 50% { transform: translateY(-6px); } }
    @keyframes jefe-ojos { 50% { fill: #ff8a96; } }
    @media (prefers-reduced-motion: reduce) {
      .jefe-fondo, .jefe, .jefe li, .jefe-alerta::before, .jefe-sprite, .jefe-ojo { animation: none; }
    }
  `,
  template: `
    <!-- El desafío de DSY1107: un jefe final que hay que aceptar antes de ver los
         juegos. Aceptar arranca el reloj de la clase. -->
    @if (verDesafio()) {
      <div class="jefe-fondo" role="dialog" aria-modal="true" aria-labelledby="jefe-titulo">
        <div class="jefe">
          <svg class="jefe-sprite" [attr.viewBox]="'0 0 ' + SPRITE_ANCHO + ' ' + SPRITE_ALTO"
               shape-rendering="crispEdges" role="img" aria-label="El Conejo del Broker, el jefe final">
            @for (p of SPRITE; track $index) {
              <rect [attr.x]="p.x" [attr.y]="p.y" width="1" height="1" [attr.fill]="p.color"
                    [class.jefe-ojo]="p.ojo"/>
            }
          </svg>
          <div class="jefe-alerta">Jefe final · El Conejo del Broker</div>
          <h2 id="jefe-titulo">Bienvenido a los Juegos del Hambre</h2>
          <p class="jefe-sub">Quince minijuegos. Un solo grupo elige primero.</p>
          <ol>
            <li style="animation-delay:.3s">Inicia sesión en Pulso.</li>
            <li style="animation-delay:.4s">Ve a la sección <strong>Minijuegos</strong>.</li>
            <li style="animation-delay:.5s">Empieza a completar los minijuegos de forma individual.</li>
            <li style="animation-delay:.6s">
              El grupo que tenga al integrante con <strong>todos listos</strong> le avisa al profe
              (si nadie termina, gana el que llegue más lejos).
              <span class="jefe-tip"><strong>Pro tip:</strong> si se la quieren vivir, que todo el grupo
                juegue en la cuenta de uno solo, así todos apoyan con las respuestas.</span>
            </li>
            <li class="clave" style="animation-delay:.7s">
              Según el orden en que terminen, van a <strong>poder elegir el orden de presentación de su grupo</strong>.
            </li>
            <li style="animation-delay:.8s">Suerte :)</li>
          </ol>
          @if (!aceptadoEn()) {
            <p class="jefe-reloj">Al aceptar parte el reloj: <strong>79 minutos</strong>, lo que dura la clase.</p>
          }
          <div class="jefe-acciones">
            @if (aceptadoEn()) {
              <button type="button" (click)="releyendo.set(false)" autofocus>Volver a los juegos</button>
            } @else {
              <button type="button" (click)="aceptar()" autofocus>Aceptar el desafío</button>
            }
          </div>
        </div>
      </div>
    }

    @if (hayDesafio() && aceptadoEn()) {
      <div class="marcador" aria-live="off">
        <div [class.listo]="terminados() === juegos().length">
          <span>Juegos</span><b data-mj-marcador="juegos">{{ terminados() }}/{{ juegos().length }}</b>
        </div>
        <div [class.fin]="restanteMs() === 0">
          <span>{{ restanteMs() === 0 ? 'Se acabó' : 'Quedan' }}</span>
          <b data-mj-marcador="reloj">{{ reloj() }}</b>
        </div>
      </div>
    }

    <div class="encabezado">
      <h1>Minijuegos</h1>
      <p>
        El repaso jugable de la evaluación{{ perfil.ramo() ? ' · ' + perfil.ramo()!.asignatura : '' }}.
      </p>
      @if (hayDesafio() && aceptadoEn()) {
        <button type="button" class="boton chico contorno" style="margin-top:10px"
                (click)="releyendo.set(true)">Ver el desafío</button>
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
    } @else if (hayDesafio() && !aceptadoEn()) {
      <div class="tarjeta">
        <div class="aviso dato">Acepta el desafío para ver los minijuegos.</div>
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
   * publicados: antes de la hora de apertura no hay nada que desafiar. Los juegos
   * no se muestran hasta aceptarlo, y aceptar arranca un reloj de 79 minutos.
   *
   * La aceptación se guarda en este navegador, por matrícula: recargar o volver
   * desde la pestaña de un juego no reinicia el reloj. En otro equipo se acepta
   * de nuevo y el reloj parte de ahí; es un empujón para la clase, no un control.
   */
  hayDesafio = computed(() => this.perfil.ramo()?.sigla === 'DSY1107' && this.juegos().length > 0);
  protected readonly SPRITE = SPRITE;
  protected readonly SPRITE_ANCHO = SPRITE_MAPA[0].length;
  protected readonly SPRITE_ALTO = SPRITE_MAPA.length;
  aceptadoEn = signal<number | null>(null);
  releyendo = signal(false);
  verDesafio = computed(() => this.hayDesafio() && (!this.aceptadoEn() || this.releyendo()));
  private ahora = signal(Date.now());
  restanteMs = computed(() =>
    Math.max(0, (this.aceptadoEn() ?? this.ahora()) + DURACION_DESAFIO_MS - this.ahora()));
  reloj = computed(() => {
    const s = Math.ceil(this.restanteMs() / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  aceptar(): void {
    const matricula = this.perfil.matricula();
    if (!matricula) return;
    const ahora = Date.now();
    try { localStorage.setItem(`pulso.desafio.${matricula}`, String(ahora)); } catch { /* sin almacenamiento: dura lo que la pestaña */ }
    this.aceptadoEn.set(ahora);
  }

  /** Igual que en Clases: reacciona a la matrícula y lee el ramo sin registrarlo. */
  constructor() {
    effect(() => {
      const matricula = this.perfil.matricula();
      let guardado: string | null = null;
      try { guardado = matricula ? localStorage.getItem(`pulso.desafio.${matricula}`) : null; } catch { /* sin almacenamiento */ }
      this.aceptadoEn.set(guardado ? Number(guardado) : null);
      this.releyendo.set(false);
    });
    const tic = setInterval(() => this.ahora.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tic));
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
