import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Cosmetico, DatosService, TiradaGacha } from './datos.service';
import { PerfilStore } from './perfil.store';

/**
 * El gacha: gastar una tirada y ver qué sale.
 *
 * ── La animación es corta a propósito ──
 *
 * Un segundo y medio de suspenso, no cinco. El alumno puede tener veinte tiradas
 * guardadas del pase y va a querer gastarlas seguidas; una animación larga que no
 * se puede saltar convierte eso en dos minutos de mirar una pantalla. Se puede
 * apretar de nuevo apenas termina.
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

        <div class="sobre" [class.girando]="girando()">
          @if (girando()) {
            <div class="ruleta" aria-live="polite">
              <span class="chico suave">Abriendo…</span>
            </div>
          } @else if (ultima(); as u) {
            <div class="premio" [class]="'premio ' + u.rareza">
              @if (u.tipo === 'avatar') {
                <img [src]="u.valor" [alt]="u.nombre">
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
            <div class="ruleta">
              <span class="chico suave">Aprieta para abrir</span>
            </div>
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

    .sobre{
      display:grid; place-items:center; min-height:250px;
      border:1.5px dashed var(--borde); border-radius:var(--r); padding:20px;
      transition:border-color .2s ease;
    }
    .sobre.girando{ border-color:var(--celeste); }

    /* Sin transformación mientras «gira»: un giro real obliga a esperar a que
       termine para leer lo que salió, y acá lo que importa es el resultado. */
    .ruleta{ opacity:.6; }

    .premio{ display:grid; justify-items:center; gap:7px; }
    .premio img{ width:132px; height:132px; border-radius:50%; object-fit:cover;
                 border:3px solid var(--borde); }
    .premio .nombre{ margin:0; font-weight:700; font-size:17px; }
    .premio .titulo-premio{
      font-size:20px; font-weight:700; line-height:1.3; padding:18px 14px;
      color:var(--azul); max-width:24ch;
    }
    .premio.legendaria img, .premio.mitica img{ border-color:#D89A2A; }
    .premio.epica img{ border-color:#7C3AED; }

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

    @media (prefers-reduced-motion: reduce){ .sobre{ transition:none; } }
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

  async tirar(): Promise<void> {
    const ramo = this.perfil.ramo();
    if (!ramo || this.girando() || this.tiradas() < 1) return;
    this.girando.set(true);
    this.error.set('');
    this.ultima.set(null);
    try {
      // La llamada y el suspenso corren juntos: así el segundo y medio es de
      // animación y no de espera, y no se suman.
      const [r] = await Promise.all([
        this.datos.tirarGacha(ramo.matricula_id),
        new Promise(res => setTimeout(res, 1500)),
      ]);
      this.ultima.set(r);
      this.tiradas.set(r.restantes);
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo tirar.');
    } finally {
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
