import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DatosService, Pase, Posicion, Recompensa } from './datos.service';
import { PerfilStore } from './perfil.store';

/**
 * El pase de batalla y la tabla de posiciones del ramo.
 *
 * Sobre el movimiento, tres decisiones que no son de gusto:
 *
 *   * La barra de progreso se anima con `transform: scaleX`, nunca con `width`.
 *     Animar el ancho obliga al navegador a recalcular el diseño en cada cuadro
 *     y la barra tiembla en los equipos del laboratorio.
 *   * La entrada de la escalera y del ranking va escalonada 38 ms por elemento.
 *     Menos no se percibe; más se siente lento.
 *   * Todo cae bajo `prefers-reduced-motion`. A quien le marea, se le muestra el
 *     resultado final sin recorrido.
 *
 * La barra parte en cero y se llena una vez, al montar: el movimiento cuenta lo
 * que el alumno avanzó, y por eso ocurre cuando llega, no antes.
 */
@Component({
  selector: 'app-pase',
  imports: [DatePipe],
  template: `
    <div class="encabezado">
      <h1>Pase de batalla</h1>
      <p>{{ perfil.ramo()?.asignatura ?? 'Tu avance del parcial.' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (!pase()) {
      <div class="tarjeta">
        <div class="aviso dato">
          Este ramo todavía no tiene un pase configurado. Avísale al docente.
        </div>
      </div>
    } @else {
      @if (pase(); as p) {
        <!-- ============ Cabecera con el nivel y la barra ============ -->
        <div class="pase-cabecera">
          <div class="pase-nivel">
            <div><b>{{ p.nivel }}</b><span>nivel</span></div>
          </div>
          <div class="info">
            <h2>{{ p.nombre }}</h2>
            <div class="sub">
              @if (p.vigente) {
                Cierra el {{ p.hasta | date:'dd/MM' }} · {{ p.xp }} de experiencia
              } @else {
                Cerrado el {{ p.hasta | date:'dd/MM' }} · {{ p.xp }} de experiencia
              }
            </div>
            <div class="pase-barra" role="progressbar"
                 [attr.aria-valuenow]="p.xp_nivel" [attr.aria-valuemin]="0"
                 [attr.aria-valuemax]="p.xp_para_subir"
                 [attr.aria-label]="'Progreso al nivel ' + (p.nivel + 1)">
              <i [style.--llenado]="llenado()"></i>
            </div>
            <div class="sub" style="margin-top:8px">
              @if (p.completo) {
                <!-- Antes decía que el XP sobrante «se convierte en puntos» y
                     nadie los pagaba nunca: no hay un solo movimiento de puntos
                     en la lógica del pase. El sobrante se informa porque es
                     cierto; lo que se quitó es la promesa. -->
                Pase completo, con <strong>{{ p.xp_sobrante }}</strong> de XP de sobra.
                Las tiradas y los cosméticos que ganaste son tuyos.
              } @else {
                Te faltan <strong>{{ p.xp_para_subir - p.xp_nivel }}</strong>
                para el nivel {{ p.nivel + 1 }}
              }
            </div>
          </div>
        </div>

        @if (celebrar().length) {
          <div class="aviso ok surge" style="margin-top:16px">
            <strong>Desbloqueaste {{ celebrar().length === 1 ? 'una recompensa' : celebrar().length + ' recompensas' }}:</strong>
            {{ nombresNuevos() }}
          </div>
        }

        <!-- ============ La escalera ============ -->
        <div class="tarjeta" style="margin-top:20px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap">
            <h2>Recompensas</h2>
            <span class="chico suave">
              {{ desbloqueadas() }} de {{ p.recompensas.length }} desbloqueadas
            </span>
          </div>
          <div class="escalera">
            @for (r of p.recompensas; track r.nivel) {
              <div class="escalon surge"
                   [class.abierto]="r.desbloqueada"
                   [class.cerrado]="!r.desbloqueada"
                   [class.actual]="r.nivel === proximo()"
                   [style.--i]="$index">
                <div class="n">Nivel {{ r.nivel }}</div>
                <div class="premio" [class.con-cara]="r.cosmetico?.tipo === 'avatar'">
                  <!-- La cara de verdad y no una silueta: desde que los avatares
                       son imágenes concretas, un icono genérico esconde justo lo
                       que el alumno está jugando por conseguir. -->
                  @if (r.cosmetico?.tipo === 'avatar' && r.cosmetico?.valor?.startsWith('https://')) {
                    <img class="cara" [src]="r.cosmetico!.valor" [alt]="r.cosmetico!.nombre" loading="lazy">
                  } @else if (r.cosmetico) {
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      @if (r.cosmetico.tipo === 'titulo') {
                        <path d="M4 7h16"/><path d="M4 12h10"/><path d="M4 17h7"/>
                      } @else {
                        <rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3"/>
                      }
                    </svg>
                  } @else {
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 3l2.6 5.4 5.9.9-4.3 4.1 1 5.9L12 16.5 6.8 19.3l1-5.9L3.5 9.3l5.9-.9z"/>
                    </svg>
                  }
                </div>
                <div class="nom">
                  {{ r.cosmetico ? r.cosmetico.nombre : (r.tiradas === 1 ? 'Una tirada' : r.tiradas + ' tiradas') }}
                </div>
                @if (r.cosmetico && r.desbloqueada
                     && (r.cosmetico.tipo === 'titulo' || r.cosmetico.tipo === 'avatar')) {
                  <button class="boton contorno chico" style="margin-top:8px;width:100%"
                          [disabled]="equipando() === r.cosmetico.id"
                          (click)="equipar(r)">
                    {{ puesto(r) ? 'Puesto' : 'Usar' }}
                  </button>
                }
              </div>
            }
          </div>
          <p class="chico suave" style="margin-top:4px">
            La experiencia sale solo de las misiones. Las clases, actividades y
            laboratorios pagan puntos, que son otra cosa.
          </p>
        </div>
      }

      <!-- ============ Tabla de posiciones ============ -->
      <div class="tarjeta" style="margin-top:20px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap">
          <h2>Tabla de posiciones</h2>
          <span class="chico suave">Los diez primeros lugares de tu asignatura</span>
        </div>

        @if (errorTabla()) {
          <div class="aviso malo" style="margin-top:14px">{{ errorTabla() }}</div>
        } @else if (podio().length === 0) {
          <div class="aviso dato" style="margin-top:14px">
            Todavía nadie ha sumado experiencia. Haz tu misión del día y encabeza la tabla.
          </div>
        } @else {
          <div style="margin-top:14px">
            @for (q of podio(); track q.matricula_id) {
              <div class="puesto surge"
                   [class.yo]="q.soy_yo"
                   [class.podio-1]="q.lugar === 1"
                   [class.podio-2]="q.lugar === 2"
                   [class.podio-3]="q.lugar === 3"
                   [style.--i]="$index">
                <div class="lugar">{{ q.lugar }}</div>
                <img [src]="q.avatar" alt="">
                <div class="quien">
                  <div class="nom">{{ q.nombre }}</div>
                  @if (q.titulo) { <div class="tit">{{ q.titulo }}</div> }
                </div>
                <div class="xp">{{ q.xp }}</div>
              </div>
            }
          </div>

          @if (masEmpatados() > 0) {
            <p class="chico suave" style="margin-top:10px">
              Y {{ masEmpatados() }} más comparten el primer lugar.
            </p>
          }

          @if (yoAparte(); as y) {
            <p class="chico suave" style="margin:16px 0 8px">Tu posición</p>
            <div class="puesto yo">
              <div class="lugar">{{ y.lugar }}</div>
              <img [src]="y.avatar" alt="">
              <div class="quien">
                <div class="nom">{{ y.nombre }}</div>
                @if (y.titulo) { <div class="tit">{{ y.titulo }}</div> }
              </div>
              <div class="xp">{{ y.xp }}</div>
            </div>
          }
        }
      </div>
    }
  `,
})
export class PaseComponent {
  private datos = inject(DatosService);
  protected perfil = inject(PerfilStore);

  pase = signal<Pase | null>(null);
  tabla = signal<Posicion[]>([]);
  celebrar = signal<any[]>([]);
  cargando = signal(true);
  equipando = signal<string | null>(null);
  /** Arranca en 0 para que la barra se llene al montar, no que aparezca llena. */
  llenado = signal(0);
  tituloPuesto = signal<string | null>(null);
  error = signal('');
  errorTabla = signal('');

  miMatricula = computed(() => this.perfil.ramo()?.matricula_id ?? '');
  proximo = computed(() => (this.pase()?.nivel ?? 0) + 1);
  desbloqueadas = computed(() => this.pase()?.recompensas.filter(r => r.desbloqueada).length ?? 0);
  nombresNuevos = computed(() => this.celebrar().map(n => n.nombre).join(', '));

  /**
   * Los diez primeros lugares. Como los empatados comparten lugar, «diez
   * lugares» pueden ser más de diez filas; se corta en 12 para que la tarjeta
   * no se vuelva una lista de sesenta nombres y se dice cuántos quedaron fuera.
   */
  private hastaDiez = computed(() => this.tabla().filter(p => p.lugar <= 10));
  podio = computed(() => this.hastaDiez().slice(0, 12));
  masEmpatados = computed(() => Math.max(0, this.hastaDiez().length - 12));

  /** Si el alumno no está en el podio, se le muestra su fila aparte, solo a él. */
  yoAparte = computed(() => {
    const mia = this.miMatricula();
    if (this.podio().some(p => p.soy_yo)) return null;
    return this.tabla().find(p => p.soy_yo) ?? null;
  });

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      await this.perfil.cargar();
      const ramo = this.perfil.ramo();
      if (!ramo) return;

      // Primero se entrega lo desbloqueado, después se lee: así la escalera ya
      // llega con las recompensas marcadas como obtenidas.
      const nuevo = await this.datos.sincronizarPase(ramo.matricula_id);
      if (nuevo?.nuevos?.length) this.celebrar.set(nuevo.nuevos);

      // Por separado y a prueba de fallos: si el ranking se cae, el pase igual
      // tiene que verse. Con un `Promise.all` un 404 en la tabla dejaba la
      // pantalla entera en blanco diciendo «no hay pase configurado», que además
      // es mentira y manda a buscar el problema al lugar equivocado.
      const [rp, rt] = await Promise.allSettled([
        this.datos.miPase(ramo.matricula_id),
        this.datos.posiciones(ramo.matricula_id),
      ]);
      const p = rp.status === 'fulfilled' ? rp.value : null;
      if (rp.status === 'rejected') this.error.set('No se pudo cargar tu pase.');
      this.pase.set(p);
      if (rt.status === 'fulfilled') this.tabla.set(rt.value);
      else this.errorTabla.set('No se pudo cargar la tabla de posiciones.');
      const mio = this.tabla().find(x => x.soy_yo)?.titulo ?? null;
      this.tituloPuesto.set(
        mio ? (p?.recompensas.find(r => r.cosmetico?.valor === mio)?.cosmetico?.id ?? null) : null);

      // El llenado se aplica después de pintar, para que la transición tenga
      // desde dónde salir. Sin este respiro el navegador une los dos estados y
      // la barra aparece llena de golpe.
      if (p) {
        const meta = p.xp_para_subir > 0 ? Math.min(1, p.xp_nivel / p.xp_para_subir) : 1;
        requestAnimationFrame(() => requestAnimationFrame(() => this.llenado.set(meta)));
      }
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Si esa recompensa es la que lleva puesta.
   *
   * Son dos cosas distintas: el título vive en la matrícula y se lee de la tabla
   * de posiciones; la cara vive en el perfil, que es de la persona y no del ramo.
   */
  puesto(r: Recompensa): boolean {
    if (!r.cosmetico) return false;
    if (r.cosmetico.tipo === 'avatar') return this.perfil.perfil()?.avatar === r.cosmetico.valor;
    return this.tituloPuesto() === r.cosmetico.id;
  }

  async equipar(r: Recompensa): Promise<void> {
    const ramo = this.perfil.ramo();
    if (!ramo || !r.cosmetico || this.equipando()) return;
    this.equipando.set(r.cosmetico.id);
    try {
      await this.datos.equipar(ramo.matricula_id, r.cosmetico.id);
      if (r.cosmetico.tipo === 'avatar') {
        // La cara vive en el perfil: sin recargarlo, el botón sigue diciendo
        // «Usar» sobre algo que el alumno acaba de ponerse.
        await this.perfil.cargar(true);
      } else {
        this.tituloPuesto.set(r.cosmetico.id);
      }
      this.tabla.set(await this.datos.posiciones(ramo.matricula_id));
    } finally {
      this.equipando.set(null);
    }
  }
}
