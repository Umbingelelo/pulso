import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { DatosService, Reunion } from './datos.service';
import { PerfilStore } from './perfil.store';

/** Cada cuánto se vuelve a preguntar si el profe entró o salió de reunión. */
const CADA_MS = 60_000;

/**
 * Si el docente de mi sección está en reunión.
 *
 * ── Por qué un store y no que cada pantalla pregunte ──
 *
 * Lo necesitan dos lugares a la vez: la barra lateral, que lo muestra siempre, y
 * la tienda, que rebaja los precios. Si cada uno preguntara por su cuenta, la
 * barra podría decir «en reunión» mientras la tienda cobra el precio entero.
 *
 * ── Por qué se pregunta cada minuto ──
 *
 * El docente enciende la reunión cuando entra, no antes, y el alumno ya tiene la
 * pantalla abierta. Sin volver a preguntar, el aviso aparecería recién en la
 * próxima recarga —o nunca— y el descuento sería un secreto. Un minuto es la
 * granularidad correcta para algo que dura una hora: no vale la pena ni un
 * websocket ni un sondeo agresivo por un aviso.
 *
 * La consulta es una fila por una llave primaria y solo corre con la pestaña a la
 * vista: con la pestaña oculta el navegador frena los temporizadores igual, y no
 * hay nada que avisarle a alguien que no está mirando.
 */
@Injectable({ providedIn: 'root' })
export class ReunionStore {
  private datos = inject(DatosService);
  private perfil = inject(PerfilStore);

  readonly reunion = signal<Reunion | null>(null);

  readonly enReunion = computed(() => this.reunion()?.en_reunion === true);
  readonly descuento = computed(() => (this.enReunion() ? (this.reunion()?.descuento ?? 0) : 0));

  private timer: any = null;
  /** La matrícula que se está vigilando, para no repetir la consulta al vuelo. */
  private mirando = '';

  constructor() {
    // El ramo elegido manda: cambiar de asignatura cambia de sección, y la
    // reunión es de una sección. Sin esto, un alumno con dos ramos vería el
    // estado del ramo anterior.
    effect(() => {
      const ramo = this.perfil.ramo();
      if (!ramo) { this.detener(); this.reunion.set(null); this.mirando = ''; return; }
      if (ramo.matricula_id === this.mirando) return;
      this.mirando = ramo.matricula_id;
      this.reunion.set(null);
      this.consultar();
      this.arrancar();
    });

    inject(DestroyRef).onDestroy(() => this.detener());
  }

  /** Después de encender o apagar desde el panel, para no esperar el minuto. */
  async refrescar(): Promise<void> {
    await this.consultar();
  }

  private arrancar(): void {
    this.detener();
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') this.consultar();
    }, CADA_MS);
  }

  private detener(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /**
   * Un fallo no se muestra en ninguna parte, a propósito: esto es un aviso
   * secundario. Si la consulta falla, la pantalla se queda como estaba en vez de
   * llenarse de errores rojos por algo que el alumno no pidió.
   */
  private async consultar(): Promise<void> {
    const matricula = this.mirando;
    if (!matricula) return;
    try {
      const r = await this.datos.miReunion(matricula);
      // Si cambió de ramo mientras viajaba la respuesta, se descarta: si no,
      // pisaría el estado del ramo nuevo con el del viejo.
      if (this.mirando === matricula) this.reunion.set(r);
    } catch {
      /* se reintenta en el próximo tic */
    }
  }
}
