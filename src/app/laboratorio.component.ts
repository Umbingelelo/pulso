import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BloqueLab, DatosService, Laboratorio } from './datos.service';
import { ICONOS } from './iconos';
import { PerfilStore } from './perfil.store';

/**
 * El laboratorio: se lee, se va respondiendo y se entrega.
 *
 * ── Se guarda solo ──
 *
 * Un laboratorio son dos horas de trabajo. Pedirle al alumno que se acuerde de
 * apretar «Guardar» es garantizar que alguien va a cerrar la pestaña y perderlo
 * todo, y ese alguien va a estar en clase, en vivo, sin nada que hacer. Así que
 * se guarda solo mientras escribe, con una espera de dos segundos para no mandar
 * una petición por tecla.
 *
 * `beforeunload` fuerza el último guardado pendiente si cierra antes de que
 * corra el temporizador. Es la ventana donde de verdad se pierde texto.
 *
 * ── Entregar es una sola vez ──
 *
 * La entrega paga los puntos y cierra la edición. Por eso hay confirmación
 * explícita y se avisa cuántas cajas quedan en blanco: entregar sin querer, a
 * medio camino, sería irreversible desde el lado del alumno.
 */
@Component({
  selector: 'app-laboratorio',
  imports: [RouterLink, DatePipe],
  template: `
    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando el laboratorio…</p></div>
    } @else if (!lab()) {
      <div class="tarjeta">
        <div class="aviso malo">No encontré ese laboratorio en tu ramo.</div>
        <a class="boton contorno chico" routerLink="/actividades"
           style="margin-top:14px">Volver a actividades</a>
      </div>
    } @else if (lab(); as l) {
      <div class="encabezado">
        <p class="etiqueta">Laboratorio {{ l.codigo }}</p>
        <h1>{{ l.titulo }}</h1>
        @if (l.descripcion) { <p>{{ l.descripcion }}</p> }
      </div>

      <!-- La barra queda fija arriba: en un enunciado de dos horas el alumno
           necesita ver cuánto lleva sin volver al principio a buscarlo. -->
      <div class="barra-lab">
        <div class="progreso">
          <div class="barra" [class.verde]="respondidas() === l.cajas">
            <i [style.width.%]="l.cajas ? (respondidas() / l.cajas) * 100 : 0"></i>
          </div>
          <span class="chico num">{{ respondidas() }} de {{ l.cajas }} respuestas</span>
        </div>

        <div class="estado">
          @if (l.entregado_en) {
            <span class="insignia verde">
              <svg viewBox="0 0 24 24" [innerHTML]="icono('check')"></svg>
              Entregado el {{ l.entregado_en | date:'dd/MM HH:mm' }}
            </span>
          } @else {
            <span class="chico suave" aria-live="polite">{{ leyendaGuardado() }}</span>
            <button class="boton chico" [disabled]="entregando() || respondidas() === 0"
                    (click)="pedirEntrega()">Entregar</button>
          }
          <span class="insignia celeste num">{{ l.puntos }} puntos</span>
        </div>
      </div>

      @if (error()) { <div class="aviso malo" style="margin:0 0 16px">{{ error() }}</div> }
      @if (hecho()) { <div class="aviso ok" style="margin:0 0 16px">{{ hecho() }}</div> }

      @if (l.entregado_en) {
        <div class="aviso dato" style="margin-bottom:16px">
          Ya lo entregaste, así que quedó en solo lectura. Lo que escribiste sigue acá.
        </div>
      }

      <div class="tarjeta enunciado">
        @for (b of l.bloques; track $index) {
          @switch (b.tipo) {
            @case ('html') {
              <div [innerHTML]="confiar(b.html)"></div>
            }
            @case ('aviso') {
              <aside class="nota" [class]="'nota ' + b.clase">
                <svg viewBox="0 0 24 24" [innerHTML]="icono(iconoDeAviso(b.clase))"></svg>
                <div [innerHTML]="confiar(b.html)"></div>
              </aside>
            }
            @case ('control') {
              <div class="control" [class.alcanzado]="l.tramo >= b.numero">
                <div class="cabeza">
                  <svg viewBox="0 0 24 24" [innerHTML]="icono('flag')"></svg>
                  <strong>Punto de control {{ b.numero }}</strong>
                </div>
                <div [innerHTML]="confiar(b.html)"></div>
                @if (!l.entregado_en) {
                  <button class="boton contorno chico" style="margin-top:12px"
                          [disabled]="l.tramo >= b.numero" (click)="marcarControl(b.numero)">
                    {{ l.tramo >= b.numero ? 'Alcanzado' : 'Llegué hasta acá' }}
                  </button>
                }
              </div>
            }
            @case ('caja') {
              <div class="caja" [class.llena]="!!(respuestas()[b.id] || '').trim()">
                <div class="rotulo">
                  <span class="etiqueta">Respuesta {{ b.id }}</span>
                  @if ((respuestas()[b.id] || '').trim()) {
                    <svg class="tilde" viewBox="0 0 24 24" [innerHTML]="icono('check')"></svg>
                  }
                </div>
                <div class="pedido" [innerHTML]="confiar(b.enunciado)"></div>
                <textarea [class.codigo]="b.formato === 'codigo'"
                          [rows]="b.formato === 'codigo' ? 9 : 3"
                          [attr.aria-label]="'Respuesta ' + b.id"
                          [attr.spellcheck]="b.formato === 'codigo' ? 'false' : 'true'"
                          [disabled]="!!l.entregado_en"
                          [value]="respuestas()[b.id] || ''"
                          (input)="escribir(b.id, $any($event.target).value)"></textarea>
              </div>
            }
          }
        }
      </div>

      @if (!l.entregado_en) {
        <div class="tarjeta" style="margin-top:20px">
          @if (confirmando()) {
            <h2>¿Lo entregas así?</h2>
            <p class="suave" style="margin-top:6px">
              @if (respondidas() < l.cajas) {
                Te quedan <strong>{{ l.cajas - respondidas() }}</strong> de {{ l.cajas }} cajas
                en blanco. Puedes entregar igual —los puntos son por hacerlo, no por acertar—
                pero después no vas a poder seguir escribiendo.
              } @else {
                Respondiste las {{ l.cajas }} cajas. Después de entregar no se puede editar.
              }
            </p>
            <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
              <button class="boton" [disabled]="entregando()" (click)="entregar()">
                {{ entregando() ? 'Entregando…' : 'Sí, entregar' }}
              </button>
              <button class="boton contorno" [disabled]="entregando()"
                      (click)="confirmando.set(false)">Seguir trabajando</button>
            </div>
          } @else {
            <div style="display:flex;justify-content:space-between;align-items:center;
                        gap:14px;flex-wrap:wrap">
              <p class="chico suave" style="margin:0">
                Se guarda solo mientras escribes. Entrega cuando termines o cuando se acabe
                la hora: los {{ l.puntos }} puntos son por el trabajo hecho.
              </p>
              <button class="boton" [disabled]="respondidas() === 0" (click)="pedirEntrega()">
                Entregar laboratorio
              </button>
            </div>
          }
        </div>
      }
    }
  `,
  styles: [`
    .barra-lab{
      position:sticky; top:0; z-index:5;
      display:flex; justify-content:space-between; align-items:center; gap:18px; flex-wrap:wrap;
      background:var(--blanco); border:1px solid var(--borde); border-radius:var(--r);
      padding:14px 18px; margin-bottom:18px; box-shadow:var(--sombra);
    }
    .barra-lab .progreso{ flex:1 1 220px; min-width:180px; }
    .barra-lab .progreso .barra{ margin-bottom:6px; }
    .barra-lab .estado{ display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
    .insignia svg{ width:14px; height:14px; vertical-align:-2px; margin-right:4px; }

    /* El enunciado es prosa larga: se le da medida de lectura y aire, no el
       ancho completo de la pantalla. */
    .enunciado{ max-width:76ch; line-height:1.7; }

    /* ── Por qué ::ng-deep, que está deprecado ──
       El enunciado entra por [innerHTML], y Angular **no le pone** el atributo
       «_ngcontent» a lo que se inyecta así: sólo lo lleva lo que está escrito
       en la plantilla. Sin ::ng-deep estas reglas se compilan a
       «.enunciado pre[_ngcontent-x]», que no calza con nada, y **ninguna se
       aplicaba**. En producción eso se veía como bloques de código sin fondo,
       títulos sin aire y, sobre todo, un «pre» sin overflow-x: una sola línea
       larga de curl empujaba la página setecientos píxeles hacia el lado.
       Va con :host delante para que no se escape del componente — el otro
       camino, ViewEncapsulation.None, suelta todo esto al resto de la app, y
       una clase de nombre común como «.enunciado» ya nos costó una vez. */
    :host ::ng-deep .enunciado :is(h2,h3,h4){ margin:30px 0 10px; line-height:1.3; }
    :host ::ng-deep .enunciado h2{ font-size:21px; }
    :host ::ng-deep .enunciado h3{ font-size:17px; }
    :host ::ng-deep .enunciado > div > :first-child{ margin-top:0; }
    :host ::ng-deep .enunciado :is(p,ul,ol){ margin:12px 0; }
    :host ::ng-deep .enunciado li{ margin:5px 0; }
    :host ::ng-deep .enunciado hr{ border:0; border-top:1px solid var(--borde); margin:28px 0; }
    :host ::ng-deep .enunciado code{
      background:var(--fondo); border:1px solid var(--borde); border-radius:5px;
      padding:1px 5px; font-size:13px;
    }
    :host ::ng-deep .enunciado pre{
      background:var(--azul-900); color:#E8EEFF; border-radius:var(--r-chico);
      padding:14px 16px; overflow-x:auto; font-size:13px; line-height:1.55; margin:14px 0;
      /* Un «pre» sin esto se estira hasta donde llegue su línea más larga y
         arrastra la página entera con él. Los laboratorios están llenos de
         comandos de una línea que no caben. */
      max-width:100%;
    }
    :host ::ng-deep .enunciado pre code{
      background:none; border:0; padding:0; color:inherit; font-size:inherit;
    }
    /* Las tablas del enunciado sí pueden ser más anchas que la medida de
       lectura: se les da su propio desplazamiento en vez de encoger la letra. */
    :host ::ng-deep .enunciado table{ width:100%; }
    :host ::ng-deep .enunciado blockquote{
      margin:14px 0; padding-left:14px; border-left:3px solid var(--borde); color:var(--texto-suave);
    }

    .nota{
      display:flex; gap:11px; align-items:flex-start;
      border-radius:var(--r-chico); padding:13px 16px; margin:18px 0; font-size:14px;
    }
    .nota svg{ width:18px; height:18px; flex:none; margin-top:2px; }
    /* min-width:0 porque es un hijo de flex: sin eso no baja de su ancho
       mínimo de contenido y un «pre» adentro revienta el aviso hacia el lado. */
    .nota > div{ min-width:0; flex:1; }
    :host ::ng-deep .nota > div > :first-child{ margin-top:0; }
    :host ::ng-deep .nota > div > :last-child{ margin-bottom:0; }
    .nota.alerta{ background:var(--amarillo-suave); color:#8A4B08; }
    .nota.pista { background:var(--celeste-suave); color:#075985; }
    .nota.ojo   { background:var(--fondo);         color:var(--texto); }

    .control{
      border:1.5px dashed var(--borde); border-radius:var(--r-chico);
      padding:16px 18px; margin:24px 0; transition:border-color .2s ease, background-color .2s ease;
    }
    .control .cabeza{ display:flex; align-items:center; gap:8px; margin-bottom:8px; }
    .control .cabeza svg{ width:17px; height:17px; color:var(--azul); }
    .control.alcanzado{ border-style:solid; border-color:var(--verde); background:var(--verde-suave); }
    .control.alcanzado .cabeza svg{ color:var(--verde); }

    .caja{
      border:1px solid var(--borde); border-left:3px solid var(--celeste);
      border-radius:var(--r-chico); padding:16px 18px; margin:22px 0;
      transition:border-left-color .2s ease;
    }
    .caja.llena{ border-left-color:var(--verde); }
    .caja .rotulo{ display:flex; align-items:center; gap:7px; }
    .caja .rotulo .tilde{ width:15px; height:15px; color:var(--verde); }
    .caja .pedido{ margin:6px 0 10px; }
    :host ::ng-deep .caja .pedido > :first-child{ margin-top:0; }
    :host ::ng-deep .caja .pedido > :last-child{ margin-bottom:0; }
    .caja textarea{ width:100%; resize:vertical; }
    .caja textarea.codigo{
      font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size:13px; line-height:1.55; white-space:pre; overflow-wrap:normal; overflow-x:auto;
    }

    @media (prefers-reduced-motion: reduce){
      .control, .caja{ transition:none; }
    }
  `],
})
export class LaboratorioComponent implements OnDestroy {
  private datos = inject(DatosService);
  private ruta = inject(ActivatedRoute);
  private limpiador = inject(DomSanitizer);
  protected perfil = inject(PerfilStore);

  lab = signal<Laboratorio | null>(null);
  respuestas = signal<Record<string, string>>({});
  cargando = signal(true);
  entregando = signal(false);
  confirmando = signal(false);
  guardando = signal(false);
  pendiente = signal(false);
  error = signal('');
  hecho = signal('');

  private codigo = '';
  private matricula = '';
  private temporizador: any = null;
  private alCerrar = () => { if (this.pendiente()) this.guardar(); };

  respondidas = computed(() =>
    Object.values(this.respuestas()).filter(v => (v ?? '').trim().length > 0).length);

  leyendaGuardado = computed(() =>
    this.guardando() ? 'Guardando…' : this.pendiente() ? 'Sin guardar' : 'Guardado');

  constructor() {
    this.codigo = this.ruta.snapshot.paramMap.get('codigo') ?? '';
    addEventListener('beforeunload', this.alCerrar);
    this.cargar();
  }

  ngOnDestroy(): void {
    removeEventListener('beforeunload', this.alCerrar);
    clearTimeout(this.temporizador);
    // Al salir de la pantalla queda texto escrito hace menos de dos segundos que
    // todavía no viajó. Sin esto se pierde justo lo último que alcanzó a poner.
    if (this.pendiente()) this.guardar();
  }

  private async cargar(): Promise<void> {
    try {
      await this.perfil.cargar();
      const ramo = this.perfil.ramo();
      if (!ramo) return;
      this.matricula = ramo.matricula_id;
      const l = await this.datos.laboratorio(this.matricula, this.codigo);
      this.lab.set(l);
      this.respuestas.set({ ...(l?.respuestas ?? {}) });
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar el laboratorio.');
    } finally {
      this.cargando.set(false);
    }
  }

  /** El HTML viene del enunciado que el docente subió, no de nadie más. */
  confiar(html: string): SafeHtml {
    return this.limpiador.bypassSecurityTrustHtml(html);
  }

  icono(nombre: string): SafeHtml {
    return this.limpiador.bypassSecurityTrustHtml(ICONOS[nombre] ?? '');
  }

  iconoDeAviso(clase: string): string {
    return clase === 'alerta' ? 'triangle-alert' : clase === 'pista' ? 'lightbulb' : 'eye';
  }

  escribir(id: string, texto: string): void {
    this.respuestas.set({ ...this.respuestas(), [id]: texto });
    this.pendiente.set(true);
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.guardar(), 2000);
  }

  private async guardar(): Promise<void> {
    if (this.lab()?.entregado_en) return;
    this.pendiente.set(false);
    this.guardando.set(true);
    try {
      await this.datos.guardarLaboratorio(
        this.matricula, this.codigo, this.respuestas(), this.lab()?.tramo ?? 0);
      this.error.set('');
    } catch (e: any) {
      // Se vuelve a marcar pendiente: si falló, el texto todavía no está a salvo
      // y el próximo intento —o el cierre de la pantalla— tiene que reintentarlo.
      this.pendiente.set(true);
      this.error.set(e?.message ?? 'No pude guardar. Tu texto sigue en pantalla.');
    } finally {
      this.guardando.set(false);
    }
  }

  async marcarControl(numero: number): Promise<void> {
    const l = this.lab();
    if (!l || l.entregado_en) return;
    clearTimeout(this.temporizador);
    try {
      await this.datos.guardarLaboratorio(
        this.matricula, this.codigo, this.respuestas(), numero);
      this.pendiente.set(false);
      this.lab.set({ ...l, tramo: Math.max(l.tramo, numero) });
    } catch (e: any) {
      this.error.set(e?.message ?? 'No pude marcar el punto de control.');
    }
  }

  pedirEntrega(): void {
    this.error.set(''); this.hecho.set('');
    this.confirmando.set(true);
    scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  async entregar(): Promise<void> {
    if (this.entregando()) return;
    this.entregando.set(true);
    this.error.set('');
    try {
      // Primero lo que está escrito y después la entrega: al revés, lo que
      // escribió en los últimos dos segundos quedaría fuera de lo entregado.
      clearTimeout(this.temporizador);
      await this.guardar();
      const r = await this.datos.entregarLaboratorio(this.matricula, this.codigo);
      const l = await this.datos.laboratorio(this.matricula, this.codigo);
      this.lab.set(l);
      this.confirmando.set(false);
      this.hecho.set(`Entregado. Ganaste ${r?.puntos ?? 0} puntos.`);
      scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo entregar.');
    } finally {
      this.entregando.set(false);
    }
  }
}
