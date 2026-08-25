import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatosService, Mision, Ramo } from './datos.service';
import { PerfilStore } from './perfil.store';

/**
 * La misión del día.
 *
 * El alumno aprieta un botón y su misión se genera en ese momento, distinta a la
 * de sus compañeros. Se demora unos segundos, así que el botón lo dice: quedarse
 * mirando una pantalla quieta sin saber si pasa algo es la forma más rápida de
 * que alguien apriete cinco veces.
 *
 * El botón se rehabilita a las 23:59 de Chile, y la cuenta regresiva la calcula
 * el servidor: el reloj del computador del alumno no es fuente de verdad.
 */
@Component({
  selector: 'app-misiones',
  template: `
    <div class="encabezado">
      <h1>Misión del día</h1>
      <p>{{ perfil.ramo()?.asignatura ?? 'Una actividad distinta cada día, solo para ti.' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (!mision()) {
      <!-- ============ Sin misión: el botón ============ -->
      <div class="tarjeta" style="text-align:center;padding:44px 26px">
        @if (estado()?.puede_generar) {
          <h2 style="margin-bottom:8px">Tu misión de hoy te está esperando</h2>
          <p class="suave" style="max-width:34rem;margin:0 auto 26px">
            Se arma en el momento y es distinta a la de tus compañeros. Si la
            resuelves bien, suma <strong>{{ xpDelDia() }} de experiencia</strong>.
          </p>
          <button class="boton" (click)="generarla()" [disabled]="generando()">
            {{ generando() ? 'Armando tu misión…' : 'Generar mi misión' }}
          </button>
          @if (generando()) {
            <p class="chico suave" style="margin-top:14px">
              Puede tardar unos segundos. No cierres la página.
            </p>
          }
        } @else {
          <h2 style="margin-bottom:8px">Ya hiciste la de hoy</h2>
          <p class="suave">Vuelve {{ cuando() }} por la siguiente.</p>
        }
        @if (error()) {
          <div class="aviso malo" style="margin-top:20px;text-align:left">{{ error() }}</div>
        }
      </div>
    } @else {
      <!-- ============ Con misión: el quiz ============ -->
      <div class="tarjeta">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
          <div>
            <p class="etiqueta">{{ mision()!.nombre }}</p>
            @if (mision()!.enunciado.termino; as t) {
              <p class="chico suave" style="margin-top:2px">
                sobre <strong>{{ t }}</strong>
                @if (mision()!.enunciado.fuente; as f) { · clase {{ f }} }
              </p>
            }
          </div>
          @if (resultado(); as r) {
            <span class="insignia" [class.verde]="r.acertada" [class.amarilla]="!r.acertada">
              {{ r.acertada ? '+' + r.xp_ganada + ' de experiencia' : 'Sin puntos esta vez' }}
            </span>
          } @else {
            <span class="insignia celeste">{{ mision()!.xp }} de experiencia</span>
          }
        </div>

        <h2 style="margin:18px 0 20px">{{ mision()!.enunciado.pregunta }}</h2>

        <div style="display:flex;flex-direction:column;gap:10px">
          @for (o of mision()!.enunciado.opciones; track $index) {
            <button type="button"
                    class="opcion-mision"
                    [class.elegida]="elegida() === $index"
                    [class.correcta]="resultado() && $index === correcta()"
                    [class.incorrecta]="resultado() && elegida() === $index && $index !== correcta()"
                    [disabled]="!!resultado()"
                    (click)="elegir($index)">
              <span class="letra">{{ 'abcd'[$index] }}</span>
              <span>{{ o }}</span>
            </button>
          }
        </div>

        @if (!resultado()) {
          <button class="boton" style="margin-top:22px"
                  [disabled]="elegida() === null || respondiendo()"
                  (click)="responder()">
            {{ respondiendo() ? 'Corrigiendo…' : 'Responder' }}
          </button>
          <p class="chico suave" style="margin-top:10px">
            Tienes un solo intento. Si te equivocas no pierdes nada, pero tampoco sumas.
          </p>
        } @else {
          <div class="aviso" [class.ok]="resultado()!.acertada" [class.dato]="!resultado()!.acertada"
               style="margin-top:22px">
            {{ resultado()!.solucion.explicacion }}
          </div>
          <p class="chico suave" style="margin-top:14px">
            Tu próxima misión se habilita {{ cuando() }}.
          </p>
        }

        @if (error()) {
          <div class="aviso malo" style="margin-top:16px">{{ error() }}</div>
        }
      </div>
    }
  `,
})
export class MisionesComponent {
  private datos = inject(DatosService);
  protected perfil = inject(PerfilStore);

  mision = signal<Mision | null>(null);
  estado = signal<any>(null);
  elegida = signal<number | null>(null);
  resultado = signal<any>(null);
  cargando = signal(true);
  generando = signal(false);
  respondiendo = signal(false);
  error = signal('');

  correcta = computed(() => {
    const r = this.resultado();
    return r ? Number(r.solucion?.correcta) : -1;
  });

  /**
   * Reaccionar al ramo, y no cargar una sola vez al construirse.
   *
   * El selector de ramo vive en la barra lateral, así que cambia sin que esta
   * pantalla se destruya. Leyéndolo solo en el constructor, el alumno con dos
   * ramos cambiaba de ramo y seguía viendo el contenido del otro, sin ningún
   * error. Es el mismo defecto que tenía el panel del docente; `tienda`, `puntos`
   * e `inicio` ya lo hacían así.
   *
   * Ojo con la forma: el `effect` lee el ramo y **se lo pasa** a `cargar`. La
   * primera versión de esto dejaba el `await this.perfil.cargar()` dentro de
   * `cargar`, y eso es un ciclo — el effect depende de `perfil.ramo()`, y
   * `perfil.cargar()` escribe las señales de las que ese computed sale, así que
   * el effect se volvía a disparar solo. La pantalla de misiones dejó de ofrecer
   * el botón de generar y la prueba de navegador lo cazó.
   */
  constructor() {
    effect(() => {
      const ramo = this.perfil.ramo();
      if (ramo) void this.cargar(ramo);
      else this.cargando.set(false);
    });
    void this.perfil.cargar();
  }

  private async cargar(ramo: Ramo): Promise<void> {
    this.cargando.set(true);
    try {
      const r = await this.datos.misionDelDia(ramo.matricula_id);
      this.estado.set(r.estado);
      this.mision.set(r.mision);
      // Si ya la respondió, se muestra resuelta con su explicación.
      if (r.mision?.resuelta_en) {
        this.resultado.set({ acertada: r.mision.acertada, xp_ganada: 0, solucion: {} });
      }
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar tu misión.');
    } finally {
      this.cargando.set(false);
    }
  }

  /** Cuándo se rehabilita el botón, dicho como lo diría una persona. */
  cuando(): string {
    const s = this.estado()?.faltan_segundos ?? 0;
    if (s <= 0) return 'en un momento';
    const h = Math.floor(s / 3600);
    if (h >= 2) return `en ${h} horas`;
    if (h === 1) return 'en una hora';
    const m = Math.max(1, Math.round(s / 60));
    return `en ${m} minuto${m === 1 ? '' : 's'}`;
  }

  xpDelDia(): number {
    return this.estado()?.xp ?? 25;
  }

  async generarla(): Promise<void> {
    if (this.generando()) return;
    this.generando.set(true);
    this.error.set('');
    try {
      const ramo = this.perfil.ramo();
      if (!ramo) return;
      const r = await this.datos.generarMision(ramo.matricula_id);
      this.estado.set(r.estado);
      this.mision.set(r.mision);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo armar tu misión. Inténtalo de nuevo.');
    } finally {
      this.generando.set(false);
    }
  }

  elegir(i: number): void {
    if (this.resultado()) return;
    this.elegida.set(i);
  }

  async responder(): Promise<void> {
    const m = this.mision();
    const i = this.elegida();
    if (!m || i === null || this.respondiendo()) return;
    this.respondiendo.set(true);
    this.error.set('');
    try {
      this.resultado.set(await this.datos.responderMision(m.id, { elegida: String(i) }));
      // Los puntos del ramo no cambian —la experiencia es otra moneda— pero el
      // encabezado sí muestra el saldo, así que conviene refrescarlo igual.
      await this.perfil.cargar(true);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo corregir tu respuesta.');
    } finally {
      this.respondiendo.set(false);
    }
  }
}
