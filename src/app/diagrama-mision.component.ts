import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';

/**
 * El diagrama de la misión «completa el diagrama»: una cadena de 4 o 5 pasos con
 * un hueco marcado con «?».
 *
 * Se dibuja a mano como SVG y no con una librería de diagramas: es una cadena
 * lineal de cajas y flechas, y una dependencia de cientos de kilobytes para eso
 * se paga en cada carga de la app. Lo único que tiene de delicado es **caber**:
 *
 *   * en pantallas anchas se dibuja en horizontal;
 *   * cuando horizontal obligaría a escalar el texto por debajo de ~80% del tamaño
 *     (un celular, o cinco pasos en una columna angosta), pasa a vertical. Se mide
 *     el ancho real del contenedor con un `ResizeObserver`, no el de la ventana: la
 *     barra lateral le quita 248px al contenido.
 *
 * Los colores son todos `var(--token)` desde la hoja de estilos del componente: el
 * modo oscuro redefine los tokens y el diagrama lo sigue solo.
 *
 * El hueco refleja el estado de la misión: sin elegir (amarillo punteado), con una
 * opción elegida (azul, con el texto de esa opción adentro), y ya corregido (verde
 * con el paso correcto, o rojo con lo que se eligió).
 */

interface Caja { x: number; y: number; lineas: string[]; hueco: boolean; }
interface Flecha { x1: number; y1: number; x2: number; y2: number; tx: number; ty: number; texto: string; ancla: 'middle' | 'start'; }

/** Parte una etiqueta en líneas de a lo más `max` caracteres, sin cortar palabras. */
function envolver(texto: string, max: number): string[] {
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    if (actual && (actual + ' ' + palabra).length > max) { lineas.push(actual); actual = palabra; }
    else actual = actual ? actual + ' ' + palabra : palabra;
  }
  if (actual) lineas.push(actual);
  // Una palabra más larga que la caja se corta en vez de desbordarla.
  return lineas.flatMap((l) => l.length > max ? l.match(new RegExp(`.{1,${max}}`, 'g')) ?? [l] : [l]).slice(0, 3);
}

@Component({
  selector: 'app-diagrama-mision',
  template: `
    @if (titulo()) { <p class="titulo">{{ titulo() }}</p> }
    <svg [attr.viewBox]="'0 0 ' + geo().ancho + ' ' + geo().alto"
         [style.max-width.px]="geo().ancho * 1.15"
         role="img" [attr.aria-label]="descripcion()">
      <defs>
        <marker id="punta-flecha" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="punta" />
        </marker>
      </defs>

      @for (f of geo().flechas; track $index) {
        <g class="flecha">
          <line [attr.x1]="f.x1" [attr.y1]="f.y1" [attr.x2]="f.x2" [attr.y2]="f.y2"
                marker-end="url(#punta-flecha)" />
          @if (f.texto) {
            <text class="etiqueta-flecha" [attr.x]="f.tx" [attr.y]="f.ty" [attr.text-anchor]="f.ancla">{{ f.texto }}</text>
          }
        </g>
      }

      @for (c of geo().cajas; track $index) {
        <g [class]="c.hueco ? 'nodo hueco ' + estado() : 'nodo'">
          <rect [attr.x]="c.x" [attr.y]="c.y" [attr.width]="geo().bw" [attr.height]="geo().bh" rx="10" />
          @if (c.hueco && !relleno()) {
            <text class="interrogacion" [attr.x]="c.x + geo().bw / 2" [attr.y]="c.y + geo().bh / 2 + 8" text-anchor="middle">?</text>
          } @else {
            <text [attr.x]="c.x + geo().bw / 2"
                  [attr.y]="c.y + geo().bh / 2 - (c.lineas.length - 1) * 8 + 5" text-anchor="middle">
              @for (l of c.lineas; track $index) {
                <tspan [attr.x]="c.x + geo().bw / 2" [attr.dy]="$index === 0 ? 0 : 16">{{ l }}</tspan>
              }
            </text>
          }
        </g>
      }
    </svg>
  `,
  styles: [`
    :host { display: block; }
    .titulo { font-size: 13.5px; font-weight: 600; color: var(--texto-suave); margin-bottom: 8px; }
    svg { width: 100%; height: auto; display: block; margin: 0 auto; font-family: inherit; overflow: visible; }
    .nodo rect { fill: var(--blanco); stroke: var(--borde); stroke-width: 1.5; }
    .nodo text { fill: var(--texto); font-size: 13px; font-weight: 500; }
    .nodo.hueco rect { fill: var(--amarillo-suave); stroke: var(--amarillo); stroke-dasharray: 5 4; }
    .nodo.hueco .interrogacion { font-size: 24px; font-weight: 700; }
    .nodo.hueco.elegida rect { fill: var(--celeste-suave); stroke: var(--azul); stroke-dasharray: none; }
    .nodo.hueco.correcta rect { fill: var(--verde-suave); stroke: var(--verde); stroke-dasharray: none; }
    .nodo.hueco.incorrecta rect { fill: var(--rojo-suave); stroke: var(--rojo); stroke-dasharray: none; }
    .flecha line { stroke: var(--texto-suave); stroke-width: 1.5; }
    .punta { fill: var(--texto-suave); }
    .etiqueta-flecha { fill: var(--texto-suave); font-size: 11px; }
  `],
})
export class DiagramaMisionComponent {
  titulo = input<string>('');
  /** Los pasos en orden, con `null` donde va el hueco. */
  nodos = input.required<(string | null)[]>();
  flechas = input<string[]>([]);
  /** Lo que se muestra dentro del hueco: la opción elegida o, ya corregido, la correcta. */
  relleno = input<string | null>(null);
  estado = input<'pendiente' | 'elegida' | 'correcta' | 'incorrecta'>('pendiente');

  private ancho = signal(800);
  private host = inject(ElementRef<HTMLElement>);

  constructor() {
    const baja = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.host.nativeElement as HTMLElement;
      this.ancho.set(el.clientWidth || 800);
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(([e]) => this.ancho.set(e.contentRect.width || 800));
      ro.observe(el);
      baja.onDestroy(() => ro.disconnect());
    });
  }

  descripcion = computed(() => {
    const pasos = this.nodos().map((n) => n ?? (this.relleno() ?? 'paso por completar'));
    return `Diagrama${this.titulo() ? ' «' + this.titulo() + '»' : ''}: ${pasos.join(', luego ')}.`;
  });

  geo = computed(() => {
    const nodos = this.nodos();
    const flechas = this.flechas();
    const n = nodos.length;
    const relleno = this.relleno();

    const GAP_H = 46, BW_H = 128, BH_H = 66, TOPE = 22;
    const anchoH = n * BW_H + (n - 1) * GAP_H;
    // Horizontal solo si cabe sin achicar el texto por debajo de ~80%.
    const horizontal = this.ancho() / anchoH >= 0.8;

    const lineasDe = (t: string | null, max: number) =>
      t === null ? (relleno ? envolver(relleno, max) : []) : envolver(t, max);

    if (horizontal) {
      const cajas: Caja[] = nodos.map((t, i) => ({
        x: i * (BW_H + GAP_H), y: TOPE, hueco: t === null, lineas: lineasDe(t, 15),
      }));
      const fl: Flecha[] = flechas.slice(0, n - 1).map((texto, i) => {
        const x1 = i * (BW_H + GAP_H) + BW_H + 3, x2 = (i + 1) * (BW_H + GAP_H) - 3;
        const y = TOPE + BH_H / 2;
        return { x1, y1: y, x2, y2: y, tx: (x1 + x2) / 2, ty: TOPE - 8, texto, ancla: 'middle' };
      });
      return { ancho: anchoH, alto: TOPE + BH_H + 4, bw: BW_H, bh: BH_H, cajas, flechas: fl };
    }

    // El lienzo es más ancho que las cajas: las etiquetas de flecha van a la derecha de la línea.
    const BW_V = 250, BH_V = 54, GAP_V = 44, LIENZO_V = 310;
    const cajas: Caja[] = nodos.map((t, i) => ({
      x: 0, y: i * (BH_V + GAP_V), hueco: t === null, lineas: lineasDe(t, 32),
    }));
    const fl: Flecha[] = flechas.slice(0, n - 1).map((texto, i) => {
      const y1 = i * (BH_V + GAP_V) + BH_V + 3, y2 = (i + 1) * (BH_V + GAP_V) - 3;
      const x = BW_V / 2;
      return { x1: x, y1, x2: x, y2, tx: x + 12, ty: (y1 + y2) / 2 + 4, texto, ancla: 'start' };
    });
    return { ancho: LIENZO_V, alto: n * BH_V + (n - 1) * GAP_V, bw: BW_V, bh: BH_V, cajas, flechas: fl };
  });
}
