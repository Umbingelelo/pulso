import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Cosmetico, DatosService, TiradaGacha } from './datos.service';
import { PerfilStore } from './perfil.store';

/**
 * El gacha: gastar una tirada y ver qué sale.
 *
 * ── La apertura tiene tres tiempos, y el del medio es el que importa ──
 *
 * `cargando` late en gris mientras viaja la petición. Cuando llega la respuesta
 * se pasa a `escalando`: ahí ya se sabe la rareza, así que la traza **se tiñe y
 * crece** antes de que el premio se vea. Ese es el aviso, y es lo que hace bueno
 * a un gacha: cuando el pico se dispara, el alumno ya sabe que le fue bien y
 * todavía no sabe qué le tocó. Recién entonces viene `revelado`.
 *
 * La traza es un pulso porque el producto se llama Pulso y su isotipo es eso: la
 * animación sale del vocabulario de la casa y no de un cofre del tesoro.
 *
 * ── La duración es parte del premio, pero se puede saltar ──
 *
 * Común 700 ms, mítica 2.200: quien saca un mítico quiere que dure. Pero un
 * alumno puede llegar con veinte tiradas del pase y gastarlas seguidas, así que
 * lo común pasa rápido y **un clic en el sobre se salta la espera**. El que
 * quiere la ceremonia la tiene; el que va por la número quince, no la sufre.
 *
 * ── Se muestra el pozo completo ──
 *
 * Incluido lo que no tiene, en gris. Saber qué falta es la mitad de la gracia de
 * una colección, y esconderlo la convierte en una lista de cosas sueltas.
 */
@Component({
  selector: 'app-gacha',
  imports: [RouterLink],
  template: `
    <div class="encabezado">
      <h1>Gacha</h1>
      <p>Gasta una tirada y llévate un título o una cara para tu perfil.</p>
    </div>

    @if (!perfil.ramo()) {
      <div class="tarjeta">
        <div class="aviso dato">Necesitas estar matriculado en un ramo para tirar.</div>
      </div>
    } @else {
      <!-- ============ Tirar ============ -->
      <div class="tarjeta mesa">
        <div class="cuenta">
          <p class="etiqueta">Tiradas disponibles</p>
          <p class="cifra destacada">{{ tiradas() }}</p>
          <p class="chico suave">
            Se ganan subiendo de nivel en el <a routerLink="/pase">pase</a>.
          </p>
        </div>

        <!-- El sobre. La traza de pulso es el aviso: mientras carga late en gris,
             y cuando llega la respuesta se tiñe y crece según la rareza. Un clic
             durante la espera se la salta. -->
        <div class="sobre" [attr.data-fase]="fase()" [attr.data-rareza]="rarezaEnCurso()"
             (click)="saltar()" role="status" aria-live="polite">

          @if (fase() === 'cargando' || fase() === 'escalando') {
            <div class="latido">
              <svg viewBox="0 0 320 90" preserveAspectRatio="none" aria-hidden="true">
                <path class="traza" fill="none" stroke-linecap="round" stroke-linejoin="round"
                      d="M0,45 H96 l9,-30 l10,58 l9,-45 l8,17 H320" />
              </svg>
              <span class="chico">{{ fase() === 'cargando' ? 'Abriendo…' : leyendaEscalando() }}</span>
            </div>
          } @else if (ultima(); as u) {
            <div class="premio" [attr.data-rareza]="u.rareza">
              @if (u.tipo === 'avatar') {
                <div class="aro"><img [src]="u.valor" [alt]="u.nombre"></div>
              } @else {
                <div class="titulo-premio">«{{ u.valor }}»</div>
              }
              <p class="nombre">{{ u.nombre }}</p>
              @if (u.descripcion) { <p class="chico suave">{{ u.descripcion }}</p> }
              <span class="insignia" [class]="'insignia ' + claseRareza(u.rareza)">
                {{ nombreRareza(u.rareza) }}
              </span>
            </div>
          } @else {
            <div class="reposo"><span class="chico suave">Aprieta para abrir</span></div>
          }
        </div>

        <div class="acciones">
          <button class="boton" [disabled]="girando() || tiradas() < 1" (click)="tirar()">
            {{ girando() ? 'Abriendo…' : tiradas() < 1 ? 'Sin tiradas' : 'Tirar' }}
          </button>
          @if (error()) { <div class="aviso malo" style="margin-top:12px">{{ error() }}</div> }
        </div>
      </div>

      <!-- ============ La colección ============ -->
      <div class="tarjeta" style="margin-top:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <h2>Tu colección</h2>
          <span class="insignia celeste num">{{ cuantosTengo() }} de {{ todos().length }}</span>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          @for (f of filtros; track f.id) {
            <button class="boton chico" [class.contorno]="filtro() !== f.id"
                    (click)="filtro.set(f.id)">{{ f.nombre }}</button>
          }
        </div>

        @if (cargando()) {
          <p class="suave chico" style="margin-top:14px">Cargando…</p>
        } @else {
          @for (grupo of porRareza(); track grupo.rareza) {
            <div class="grupo">
              <div class="cabeza-grupo">
                <span class="insignia" [class]="'insignia ' + claseRareza(grupo.rareza)">
                  {{ grupo.nombre }}
                </span>
                <span class="chico suave">{{ grupo.tengo }} de {{ grupo.items.length }}</span>
              </div>
              <div class="coleccion">
                @for (c of grupo.items; track c.id) {
                  <div class="pieza" [class.falta]="!c.tengo" [class.puesto]="c.equipado"
                       [title]="c.nombre + (c.descripcion ? ' · ' + c.descripcion : '')">
                    @if (c.tipo === 'avatar') {
                      <img [src]="c.valor" [alt]="c.nombre" loading="lazy">
                    } @else {
                      <div class="chapa">{{ c.valor }}</div>
                    }
                    <p class="chico">{{ c.nombre }}</p>
                    @if (c.tengo && c.tipo !== 'marco') {
                      <button class="boton contorno chico" [disabled]="c.equipado || poniendo() === c.id"
                              (click)="ponerse(c)">
                        {{ c.equipado ? 'Puesto' : 'Ponerme' }}
                      </button>
                    }
                  </div>
                }
              </div>
            </div>
          }
        }
      </div>
    }
  `,
  styles: [`
    .mesa{ display:grid; gap:22px; grid-template-columns:1fr; text-align:center; }
    @media (min-width:820px){
      .mesa{ grid-template-columns:200px 1fr 200px; align-items:center; text-align:left; }
      .mesa .acciones{ text-align:right; }
    }

    /* ── El tono de cada rareza ──
       Un color por nivel, y la mítica en magenta y no en otro dorado: si
       legendaria y mítica comparten familia, de un vistazo no se distinguen y el
       premio más raro del pozo deja de sentirse raro. */
    .sobre, .premio{ --tono:#64748B; --brillo:0; }
    [data-rareza="poco_comun"]{ --tono:#0E9F6E; --brillo:.15; }
    [data-rareza="rara"]      { --tono:#2563EB; --brillo:.3; }
    [data-rareza="epica"]     { --tono:#7C3AED; --brillo:.5; }
    [data-rareza="legendaria"]{ --tono:#D97706; --brillo:.75; }
    [data-rareza="mitica"]    { --tono:#DB2777; --brillo:1; }

    .sobre{
      position:relative; overflow:hidden;
      display:grid; place-items:center; min-height:250px;
      border:1.5px dashed var(--borde); border-radius:var(--r); padding:20px;
      transition:border-color .35s ease, background-color .35s ease;
    }
    .sobre[data-fase="cargando"], .sobre[data-fase="escalando"]{ cursor:pointer; }
    .sobre[data-fase="escalando"]{
      border-style:solid; border-color:var(--tono);
      background:color-mix(in srgb, var(--tono) calc(var(--brillo) * 9%), transparent);
    }
    .reposo{ opacity:.6; }

    /* ── El latido ──
       La firma de la pantalla, y sale del isotipo: Pulso late. La traza se dibuja
       de izquierda a derecha en bucle mientras viaja la petición, y cuando llega
       la respuesta se tiñe y **crece**. Esa amplitud es el aviso: cuando el pico
       se dispara antes de ver el premio, ya sabes que salió algo bueno. */
    .latido{ display:grid; justify-items:center; gap:14px; width:100%; }
    .latido svg{ width:100%; max-width:320px; height:90px; overflow:visible; }
    .latido span{ color:var(--tono); font-weight:600; letter-spacing:.02em; }

    .traza{
      stroke:var(--tono); stroke-width:2.5;
      stroke-dasharray:420; stroke-dashoffset:420;
      transform-origin:center;
      animation:trazar 1.05s linear infinite;
      transition:stroke .35s ease;
    }
    .sobre[data-fase="escalando"] .traza{
      stroke-width:3.5;
      /* La amplitud es la que habla. Un común apenas se mueve; un mítico se sale. */
      transform:scaleY(calc(1 + var(--brillo) * 1.6));
      animation-duration:.5s;
      filter:drop-shadow(0 0 calc(var(--brillo) * 10px) var(--tono));
    }
    @keyframes trazar{
      from{ stroke-dashoffset:420; }
      to  { stroke-dashoffset:-420; }
    }

    /* ── El revelado ──
       El premio entra desde el punto donde estaba la traza, no desde la nada. */
    .premio{ display:grid; justify-items:center; gap:7px; animation:revelar .42s cubic-bezier(.2,.9,.3,1.2) both; }
    @keyframes revelar{
      from{ opacity:0; transform:scale(.86); }
      to  { opacity:1; transform:scale(1); }
    }

    .premio .aro{
      position:relative; padding:5px; border-radius:50%;
      background:conic-gradient(from 180deg, var(--tono), color-mix(in srgb, var(--tono) 25%, transparent), var(--tono));
    }
    .premio img{
      display:block; width:132px; height:132px; border-radius:50%; object-fit:cover;
      border:3px solid var(--blanco);
    }
    .premio .nombre{ margin:0; font-weight:700; font-size:17px; }
    .premio .titulo-premio{
      font-size:20px; font-weight:700; line-height:1.3; padding:18px 14px;
      color:var(--tono); max-width:24ch;
    }

    /* El destello queda solo para épica y mejores: si acompañara a todas dejaría
       de significar algo, que es justo lo que se quiere evitar. */
    .sobre[data-rareza="epica"][data-fase="revelado"]::after,
    .sobre[data-rareza="legendaria"][data-fase="revelado"]::after,
    .sobre[data-rareza="mitica"][data-fase="revelado"]::after{
      content:''; position:absolute; inset:0; pointer-events:none;
      background:radial-gradient(circle at center,
        color-mix(in srgb, var(--tono) 55%, transparent), transparent 62%);
      animation:destello .72s ease-out both;
    }
    @keyframes destello{
      from{ opacity:.85; transform:scale(.3); }
      to  { opacity:0;   transform:scale(1.5); }
    }

    .grupo{ margin-top:22px; }
    .cabeza-grupo{ display:flex; align-items:center; gap:10px; margin-bottom:10px; }

    .coleccion{
      display:grid; gap:12px;
      grid-template-columns:repeat(auto-fill, minmax(124px, 1fr));
    }
    .pieza{
      display:grid; justify-items:center; gap:6px; padding:11px 9px;
      border:1px solid var(--borde); border-radius:var(--r-chico); background:var(--blanco);
      text-align:center;
    }
    .pieza img{ width:74px; height:74px; border-radius:50%; object-fit:cover; }
    .pieza p{ margin:0; line-height:1.3; }
    .pieza .chapa{
      display:grid; place-items:center; min-height:74px; padding:6px;
      font-size:12.5px; font-weight:600; color:var(--azul); line-height:1.3;
    }
    /* Lo que falta se ve, pero apagado: saber qué te falta es parte del juego. */
    .pieza.falta{ opacity:.42; filter:grayscale(1); }
    .pieza.puesto{ border-color:var(--verde); background:var(--verde-suave); }

    .insignia.morada{ background:#EDE9FE; color:#5B21B6; }
    .insignia.dorada{ background:#FEF3C7; color:#92400E; }

    /* Sin movimiento: se conserva el color, que es la información, y se quita el
       movimiento, que es el adorno. El premio aparece igual y en el acto. */
    @media (prefers-reduced-motion: reduce){
      .sobre, .premio, .traza{ transition:none; animation:none; }
      .traza{ stroke-dashoffset:0; }
      .sobre[data-fase="revelado"]::after{ animation:none; opacity:0; }
    }
  `],
})
export class GachaComponent {
  protected perfil = inject(PerfilStore);
  private datos = inject(DatosService);

  protected readonly filtros = [
    { id: '', nombre: 'Todo' },
    { id: 'falta', nombre: 'Me falta' },
    { id: 'titulo', nombre: 'Títulos' },
    { id: 'avatar', nombre: 'Caras' },
  ];

  todos = signal<Cosmetico[]>([]);
  tiradas = signal(0);
  ultima = signal<TiradaGacha | null>(null);
  /** En qué momento de la apertura va: quieto → cargando → escalando → revelado. */
  fase = signal<'quieto' | 'cargando' | 'escalando' | 'revelado'>('quieto');
  /** La rareza que se está anunciando, ya sabida pero todavía sin mostrar el premio. */
  rarezaEnCurso = signal('');
  filtro = signal('');
  cargando = signal(true);
  girando = signal(false);
  poniendo = signal('');
  error = signal('');

  cuantosTengo = computed(() => this.todos().filter(c => c.tengo).length);

  private visibles = computed(() => {
    const f = this.filtro();
    if (f === 'falta') return this.todos().filter(c => !c.tengo);
    if (f) return this.todos().filter(c => c.tipo === f);
    return this.todos();
  });

  /** Agrupado por rareza, de la más alta a la más baja: es como se lee una colección. */
  porRareza = computed(() => {
    const grupos = new Map<string, { rareza: string; nombre: string; orden: number; items: Cosmetico[]; tengo: number }>();
    for (const c of this.visibles()) {
      const g = grupos.get(c.rareza)
        ?? { rareza: c.rareza, nombre: c.rareza_nombre, orden: c.rareza_orden, items: [], tengo: 0 };
      g.items.push(c);
      if (c.tengo) g.tengo++;
      grupos.set(c.rareza, g);
    }
    return [...grupos.values()].sort((a, b) => b.orden - a.orden);
  });

  constructor() {
    this.perfil.cargar().then(() => this.cargar());
  }

  claseRareza(r: string): string {
    return r === 'mitica' || r === 'legendaria' ? 'dorada'
         : r === 'epica' ? 'morada'
         : r === 'rara' ? 'celeste'
         : r === 'poco_comun' ? 'verde'
         : '';
  }

  nombreRareza(r: string): string {
    return this.todos().find(c => c.rareza === r)?.rareza_nombre ?? r;
  }

  /**
   * Lo que se lee mientras escala.
   *
   * Nombra la rareza antes de mostrar el premio, que es el momento en que el
   * alumno ya sabe que le fue bien pero todavía no qué le tocó.
   */
  leyendaEscalando(): string {
    const r = this.rarezaEnCurso();
    if (r === 'mitica') return '¡Mítica!';
    if (r === 'legendaria') return '¡Legendaria!';
    if (r === 'epica') return 'Épica';
    return this.nombreRareza(r);
  }

  private async cargar(): Promise<void> {
    const ramo = this.perfil.ramo();
    if (!ramo) { this.cargando.set(false); return; }
    this.cargando.set(true);
    try {
      const [todos, tiradas] = await Promise.all([
        this.datos.misCosmeticos(ramo.matricula_id),
        this.datos.misTiradas(ramo.matricula_id),
      ]);
      this.todos.set(todos);
      this.tiradas.set(tiradas);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar el gacha.');
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Cuánto dura el escalado de cada rareza, en milisegundos.
   *
   * La duración **es** parte del premio: quien saca un mítico quiere que dure. Pero
   * lo común pasa rápido a propósito, porque un alumno puede llegar con veinte
   * tiradas del pase y va a gastarlas seguidas; dos segundos por cada una serían
   * cuarenta segundos mirando una pantalla.
   */
  private static readonly ESCALADO: Record<string, number> = {
    comun: 700, poco_comun: 850, rara: 1100, epica: 1400, legendaria: 1800, mitica: 2200,
  };

  private esperando: ((v?: unknown) => void) | null = null;

  /**
   * Un clic durante la espera se la salta.
   *
   * Es la válvula que hace que el suspenso sea aceptable: el que quiere la
   * ceremonia la tiene, y el que va por la número quince no la sufre.
   */
  saltar(): void {
    this.esperando?.();
  }

  private pausa(ms: number): Promise<unknown> {
    return new Promise((res) => {
      const t = setTimeout(res, ms);
      this.esperando = () => { clearTimeout(t); this.esperando = null; res(undefined); };
    });
  }

  async tirar(): Promise<void> {
    const ramo = this.perfil.ramo();
    if (!ramo || this.girando() || this.tiradas() < 1) return;
    this.girando.set(true);
    this.error.set('');
    this.ultima.set(null);
    this.rarezaEnCurso.set('');
    this.fase.set('cargando');
    try {
      // La carga late en neutro **mientras viaja la petición**, sin saber todavía
      // qué salió. El medio segundo de piso es para que una respuesta rápida no
      // parpadee: sin él, en una red buena la fase de carga no se alcanza a ver y
      // el premio aparece de golpe.
      const [r] = await Promise.all([
        this.datos.tirarGacha(ramo.matricula_id),
        this.pausa(500),
      ]);

      // Y acá está el aviso: ya se sabe la rareza, así que la traza se tiñe y
      // crece antes de que el premio se vea.
      this.rarezaEnCurso.set(r.rareza);
      this.fase.set('escalando');
      await this.pausa(GachaComponent.ESCALADO[r.rareza] ?? 900);

      this.ultima.set(r);
      this.fase.set('revelado');
      this.tiradas.set(r.restantes);
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo tirar.');
      this.fase.set('quieto');
    } finally {
      this.esperando = null;
      this.girando.set(false);
    }
  }

  async ponerse(c: Cosmetico): Promise<void> {
    const ramo = this.perfil.ramo();
    if (!ramo || this.poniendo() || c.equipado) return;
    this.poniendo.set(c.id);
    this.error.set('');
    try {
      await this.datos.equiparCosmetico(ramo.matricula_id, c.id);
      await this.perfil.cargar(true);
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo poner eso.');
    } finally {
      this.poniendo.set('');
    }
  }
}
