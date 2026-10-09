import {
  Component, ElementRef, HostListener, OnDestroy, afterNextRender, computed, inject, input,
  output, signal, viewChild,
} from '@angular/core';
import { Canje, DatosService, ResultadoRuleta, TramoRuleta, mensajeDeError } from './datos.service';

/** El radio de la rueda dentro del `viewBox` de 640. El centro está en (320, 320). */
const R = 290;
const CENTRO = 320;
/** Lo que dura la desaceleración, de la rueda y de los rótulos (ver `transicion`). */
const DURACION_MS = 5200;
/** Vueltas completas antes de frenar. Más se ve como un trompo; menos, como un trámite. */
const VUELTAS = 6;
/** A qué distancia del centro va cada rótulo: en la parte ancha de la cuña, lejos del eje. */
const RADIO_ROTULO = 190;

type Fase = 'cargando' | 'listo' | 'consultando' | 'girando' | 'resultado' | 'error';

/** Un tramo ya con su geometría: de qué grado a qué grado va, medido desde arriba en sentido horario. */
interface Sector extends TramoRuleta {
  ini: number;
  fin: number;
  grados: number;
  pct: number;
  ruta: string;
  /** Dónde va el rótulo: sobre la bisectriz del tramo, a `RADIO_ROTULO` del centro. */
  rotulo: string;
  clase: string;
}

/**
 * Los grados `a`, medidos desde las 12 en sentido horario, como un punto a distancia
 * `r` del centro. En SVG el eje Y crece hacia abajo, de ahí el signo.
 */
function punto(a: number, r: number): [number, number] {
  const rad = (a * Math.PI) / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)];
}

/** La cuña de `ini` a `fin` grados, con el vértice en el centro. */
function cuna(ini: number, fin: number): string {
  if (fin - ini >= 359.99) {
    return `M0 ${-R} A${R} ${R} 0 1 1 0 ${R} A${R} ${R} 0 1 1 0 ${-R} Z`;
  }
  const [x0, y0] = punto(ini, R);
  const [x1, y1] = punto(fin, R);
  const grande = fin - ini > 180 ? 1 : 0;
  return `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${grande} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

/**
 * Cada nota tiene su color, y los colores salen de los tokens de `styles.css`, no
 * de valores fijos: el modo oscuro los redefine y la rueda lo sigue sola.
 */
function claseDe(nota: number): string {
  if (nota < 4) return 'c-rojo';
  if (nota < 5) return 'c-celeste';
  if (nota < 6) return 'c-verde';
  if (nota < 7) return 'c-amarillo';
  return 'c-turquesa';
}

/**
 * La ruleta de nota: el docente la tira delante del curso.
 *
 * ── El servidor decide, la rueda solo lo muestra ──
 *
 * Al apretar «Girar» lo primero que pasa es la llamada a `tirar_ruleta`, que sortea
 * en la base y deja el canje entregado. Recién con la nota **ya decidida** la rueda
 * empieza a girar, y frena en un punto al azar **dentro** del tramo que salió. Cerrar
 * la pestaña a mitad de la animación no cambia nada ni permite volver a tirar.
 *
 * ── Las proporciones son las verdaderas ──
 *
 * Los tramos se dibujan con los pesos de `ruleta_tramos`, los mismos del sorteo. El
 * 6,0 es una franja de menos de tres grados y el 7,0 de menos de uno: así de poco
 * probables son, y esconderlo para que se vea más lindo sería otra forma de mentir.
 * La leyenda al lado dice cada porcentaje.
 *
 * ── Para proyectar ──
 *
 * La rueda ocupa casi todo el alto de la pantalla y el resultado se lee desde el
 * fondo de la sala. Con `prefers-reduced-motion` no gira: muestra la nota de una vez.
 */
@Component({
  selector: 'app-ruleta',
  template: `
    <div class="fondo" (click)="clicFondo($event)">
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="ruleta-titulo">
        <button class="cerrar" type="button" (click)="cerrarModal()"
                [disabled]="ocupada()" aria-label="Cerrar">×</button>

        <div class="disco">
          @if (sectores().length) {
            <svg viewBox="0 0 640 640" role="img"
                 [attr.aria-label]="'Ruleta con ' + sectores().length + ' tramos: ' + resumen()">
              <circle cx="320" cy="320" r="298" class="aro"/>
              <g class="gira" [style.transform]="'rotate(' + giro() + 'deg)'" [style.transition]="transicion()">
                <g transform="translate(320 320)">
                  @for (s of sectores(); track s.nota) {
                    <path [attr.d]="s.ruta" [attr.class]="'sector ' + s.clase"
                          [class.fino]="s.grados < 6"/>
                  }
                  <!--
                    Los rótulos viajan con su tramo, pero se contragiran con la misma curva y
                    la misma duración: quedan siempre derechos, en reposo, girando y al frenar,
                    cuando la nota que salió queda arriba bajo el puntero y se lee de corrido.
                    Con texto radial, la mitad izquierda de la rueda quedaba patas arriba y la
                    ganadora terminaba de costado, justo la que hay que leer desde el fondo.
                  -->
                  @for (s of sectores(); track s.nota) {
                    @if (s.grados >= 10) {
                      <g [attr.transform]="s.rotulo">
                        <text class="rotulo" text-anchor="middle" dominant-baseline="central"
                              [style.transform]="'rotate(' + -giro() + 'deg)'"
                              [style.transition]="transicion()">{{ fmtNota(s.nota) }}</text>
                      </g>
                    }
                  }
                </g>
              </g>
              <circle cx="320" cy="320" r="38" class="eje"/>
              <polygon points="294,2 346,2 320,66" class="puntero"/>
            </svg>
          } @else if (fase() === 'cargando') {
            <p class="suave chico" style="text-align:center;padding:80px 0">Cargando la ruleta…</p>
          }
        </div>

        <div class="lado">
          <div class="etiqueta">Ruleta de nota</div>
          <h2 id="ruleta-titulo" class="alumno">{{ canje().alumno }}</h2>
          <p class="chico suave" style="margin:2px 0 0">
            {{ canje().sigla }} · sección {{ canje().seccion }}
            @if (canje().nota_alumno) { · «{{ canje().nota_alumno }}» }
          </p>

          @if (fase() === 'resultado' && resultado(); as r) {
            <div class="resultado" [class.bien]="r.nota >= 4" [class.mal]="r.nota < 4"
                 [class.sin-animacion]="!animar()" aria-live="polite">
              <div class="etiqueta">Salió</div>
              <div class="cifra-grande">{{ fmtNota(r.nota) }}</div>
              <p style="margin:4px 0 0">
                Ya quedó entregado: el alumno lo ve como respuesta en su tienda.
              </p>
            </div>
            <button class="boton chico grande" type="button" (click)="cerrarModal()">Cerrar</button>
          } @else if (fase() === 'error') {
            <div class="aviso malo" style="margin-top:18px">{{ error() }}</div>
            <button class="boton contorno chico" style="margin-top:14px" type="button"
                    (click)="cerrarModal()">Cerrar</button>
          } @else {
            <button #girar class="boton accion grande" type="button" (click)="tirar()"
                    [disabled]="fase() !== 'listo'">
              @switch (fase()) {
                @case ('consultando') { Sorteando… }
                @case ('girando') { Girando… }
                @default { ¡Girar! }
              }
            </button>
            <p class="chico suave" style="margin:10px 0 0">
              Se tira una sola vez. El sorteo lo hace el servidor al apretar el botón; la rueda
              solo gira hacia el resultado.
            </p>
          }

          <table class="leyenda" aria-label="Probabilidades">
            @for (s of leyenda(); track s.nota) {
              <tr [class.gano]="fase() === 'resultado' && resultado()?.nota === s.nota">
                <td><span class="muestra" [attr.class]="'muestra ' + s.clase"></span></td>
                <td class="nota">{{ fmtNota(s.nota) }}</td>
                <td class="der num">{{ fmtPct(s.pct) }}</td>
              </tr>
            }
          </table>
          <p class="chico suave" style="margin:10px 0 0">
            Las franjas son proporcionales: el 6,0 y el 7,0 son finas porque salen casi nunca.
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host{ display:contents; }

    .fondo{
      position:fixed; inset:0; z-index:1000;
      display:grid; place-items:center; padding:2vh 2vw;
      background:color-mix(in srgb, var(--azul-900) 82%, transparent);
    }
    .panel{
      position:relative;
      width:min(1320px, 100%); max-height:96vh; overflow:auto;
      display:grid; grid-template-columns:minmax(0, 1.5fr) minmax(320px, 1fr);
      gap:clamp(16px, 3vw, 40px); align-items:center;
      padding:clamp(16px, 2.4vw, 32px);
      background:var(--blanco); color:var(--texto);
      border:1px solid var(--borde); border-radius:var(--r);
      box-shadow:var(--sombra-alta);
    }
    @media (max-width:820px){ .panel{ grid-template-columns:1fr; } }

    .cerrar{
      position:absolute; top:10px; right:14px; z-index:1;
      width:40px; height:40px; border-radius:50%;
      border:1px solid var(--borde); background:var(--blanco); color:var(--texto);
      font-size:26px; line-height:1; cursor:pointer;
    }
    .cerrar:hover:not(:disabled){ background:var(--fondo); }
    .cerrar:disabled{ opacity:.35; cursor:not-allowed; }

    .disco svg{ display:block; width:min(100%, 82vh); height:auto; margin:0 auto; }
    .aro{ fill:var(--fondo); stroke:var(--borde); stroke-width:2; }
    .gira{ transform-origin:320px 320px; }
    .sector{ stroke:var(--blanco); stroke-width:.75; }
    .sector.fino{ stroke:none; }
    .rotulo{
      font-size:44px; font-weight:800; font-family:inherit;
      fill:var(--texto); stroke:var(--blanco); stroke-width:7px; paint-order:stroke;
      stroke-linejoin:round; transform-origin:0 0;
    }
    .eje{ fill:var(--blanco); stroke:var(--borde); stroke-width:3; }
    .puntero{ fill:var(--texto); stroke:var(--blanco); stroke-width:4; stroke-linejoin:round; }

    /* Un color por nota, derivado de los tokens: --c lo leen el sector y la muestra. */
    .c-rojo    { --c:var(--rojo); }
    .c-celeste { --c:var(--celeste); }
    .c-verde   { --c:var(--verde); }
    .c-amarillo{ --c:var(--amarillo); }
    .c-turquesa{ --c:var(--turquesa); }
    .sector{ fill:var(--c); }
    .muestra{ display:inline-block; width:22px; height:22px; border-radius:6px; background:var(--c);
              vertical-align:middle; }

    .alumno{ font-size:clamp(24px, 3.2vw, 38px); line-height:1.15; margin-top:4px; padding-right:40px; }

    .boton.grande{ display:block; width:100%; margin-top:20px; padding:16px 34px; font-size:22px; font-weight:700; }

    .resultado{
      margin-top:18px; padding:14px 20px 18px; border-radius:var(--r);
      text-align:center; border:1px solid transparent;
    }
    /* Texto con tokens «-texto»: --verde-texto da 4.5:1 sobre --verde-suave en claro y 6.9:1 en oscuro. */
    .resultado.bien{ background:var(--verde-suave); color:var(--verde-texto); animation:aparece .5s cubic-bezier(.2,1.4,.4,1); }
    /* Un 1,0 delante del curso no se festeja ni se pinta de alarma: sobrio, sin rebote. */
    .resultado.mal { background:var(--fondo); color:var(--texto); border-color:var(--borde); animation:asoma .4s ease-out; }
    .resultado p{ color:var(--texto); font-size:16px; }
    .resultado .etiqueta{ font-size:14px; color:inherit; }
    .cifra-grande{
      font-size:clamp(84px, 17vh, 190px); font-weight:800; line-height:1;
      letter-spacing:-.04em; font-variant-numeric:tabular-nums;
    }
    .resultado.sin-animacion{ animation:none; }
    @keyframes aparece{ from{ transform:scale(.6); opacity:0; } to{ transform:scale(1); opacity:1; } }
    @keyframes asoma{ from{ opacity:0; } to{ opacity:1; } }

    .leyenda{ width:100%; margin-top:22px; border-collapse:collapse; }
    .leyenda td{ padding:6px 8px; font-size:17px; border-top:1px solid var(--borde); }
    .leyenda .nota{ font-weight:700; }
    .leyenda tr.gano td{ background:var(--celeste-suave); font-weight:700; }

    @media (prefers-reduced-motion: reduce){
      .gira, .rotulo{ transition:none !important; }
      .resultado{ animation:none !important; }
    }
  `],
})
export class RuletaComponent implements OnDestroy {
  private datos = inject(DatosService);

  /** El canje solicitado que se va a resolver. */
  canje = input.required<Canje>();
  /** Al cerrar. `true` si hay algo que recargar: el canje se resolvió o dio error. */
  cerrar = output<boolean>();

  protected fase = signal<Fase>('cargando');
  protected tramos = signal<TramoRuleta[]>([]);
  protected resultado = signal<ResultadoRuleta | null>(null);
  protected error = signal('');
  protected giro = signal(0);
  protected animar = signal(false);

  private botonGirar = viewChild<ElementRef<HTMLButtonElement>>('girar');
  private temporizador: number | undefined;
  private recargar = false;

  protected ocupada = computed(() => this.fase() === 'consultando' || this.fase() === 'girando');

  /** La rueda y sus rótulos frenan con la misma curva: si no, los rótulos se tuercen al girar. */
  protected transicion = computed(() =>
    this.animar() ? `transform ${DURACION_MS}ms cubic-bezier(.12,.62,.08,1)` : 'none');

  protected sectores = computed<Sector[]>(() => {
    const ts = this.tramos();
    const total = ts.reduce((n, t) => n + t.peso, 0);
    let a = 0;
    return ts.map((t) => {
      const grados = (t.peso / total) * 360;
      const [x, y] = punto(a + grados / 2, RADIO_ROTULO);
      const s: Sector = {
        ...t, ini: a, fin: a + grados, grados,
        pct: (t.peso / total) * 100, ruta: cuna(a, a + grados), clase: claseDe(t.nota),
        rotulo: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
      };
      a += grados;
      return s;
    });
  });

  /** La leyenda va de la nota más baja a la más alta, no en el orden de la rueda. */
  protected leyenda = computed(() => [...this.sectores()].sort((x, y) => x.nota - y.nota));

  /** Para el lector de pantalla, que no ve los colores. */
  protected resumen = computed(() =>
    this.leyenda().map((s) => `${this.fmtNota(s.nota)}: ${this.fmtPct(s.pct)}`).join(', '));

  constructor() {
    void this.cargarTramos();
    afterNextRender(() => this.botonGirar()?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    clearTimeout(this.temporizador);
  }

  protected fmtNota(n: number): string {
    return n.toFixed(1).replace('.', ',');
  }

  protected fmtPct(p: number): string {
    return `${p.toLocaleString('es-CL', { maximumFractionDigits: 1 })} %`;
  }

  private async cargarTramos(): Promise<void> {
    try {
      this.tramos.set(await this.datos.tramosRuleta());
      this.fase.set('listo');
      // El botón aparece con la fase; hay que esperar a que exista para enfocarlo.
      queueMicrotask(() => this.botonGirar()?.nativeElement.focus());
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo cargar la ruleta.'));
      this.fase.set('error');
    }
  }

  protected async tirar(): Promise<void> {
    if (this.fase() !== 'listo') return;
    this.fase.set('consultando');
    let r: ResultadoRuleta;
    try {
      r = await this.datos.tirarRuleta(this.canje().id);
    } catch (e) {
      // Puede ser que otra pestaña ya la haya tirado: al cerrar se recarga la lista.
      this.recargar = true;
      this.error.set(mensajeDeError(e, 'No se pudo tirar la ruleta.'));
      this.fase.set('error');
      return;
    }

    // Ya está sorteado y guardado. De acá para adelante es solo mostrarlo.
    this.recargar = true;
    this.resultado.set(r);
    this.tramos.set(r.tramos);
    const sector = this.sectores().find((s) => Math.abs(s.nota - r.nota) < 0.01);
    if (!sector) {
      this.error.set(`Salió ${this.fmtNota(r.nota)}, pero ese tramo no está en la rueda.`);
      this.fase.set('error');
      return;
    }

    // Un punto al azar dentro del tramo, sin pegarse a los bordes: un puntero que
    // frena justo sobre la línea entre dos colores no deja claro qué salió.
    const margen = sector.grados * 0.15;
    const destino = sector.ini + margen + Math.random() * (sector.grados - 2 * margen);

    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.animar.set(!quieto);
    // Para que `destino` quede bajo el puntero (a 0°) la rueda gira 360·k − destino.
    this.giro.set(VUELTAS * 360 + (360 - destino));
    if (quieto) {
      this.fase.set('resultado');
      return;
    }
    this.fase.set('girando');
    this.temporizador = window.setTimeout(() => this.fase.set('resultado'), DURACION_MS + 150);
  }

  protected cerrarModal(): void {
    if (this.ocupada()) return;
    this.cerrar.emit(this.recargar);
  }

  protected clicFondo(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.cerrarModal();
  }

  @HostListener('document:keydown.escape')
  protected alApretarEscape(): void {
    this.cerrarModal();
  }
}
