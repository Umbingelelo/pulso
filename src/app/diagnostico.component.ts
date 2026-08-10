import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Actividad, DatosService } from './datos.service';
import { NO_SE, SECCIONES, puntuables, totalPreguntas } from './diagnostico.datos';

const CODIGO = 'diagnostico-entrada';

@Component({
  selector: 'app-diagnostico',
  imports: [RouterLink, NgTemplateOutlet],
  template: `
    <div class="encabezado">
      <h1>Diagnóstico de entrada</h1>
      <p>{{ actividad()?.descripcion }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (yaHecho()) {
      <!-- ============ Ya lo rindió ============ -->
      <div class="tarjeta" style="margin-bottom:20px">
        <div class="aviso ok">
          <strong>Ya completaste el diagnóstico.</strong>
          Se rinde una sola vez, así que estos son tus resultados definitivos.
        </div>
      </div>
      <ng-container [ngTemplateOutlet]="tablaResultado"></ng-container>
    } @else if (corregido()) {
      <!-- ============ Acaba de terminarlo ============ -->
      <div class="tarjeta" style="margin-bottom:20px">
        <div class="aviso ok">
          <strong>Listo.</strong> Tus respuestas quedaron registradas y ganaste
          {{ actividad()?.puntos }} puntos.
        </div>
      </div>
      <ng-container [ngTemplateOutlet]="tablaResultado"></ng-container>
      <div class="tarjeta" style="margin-top:20px">
        <h2>Revisa las respuestas</h2>
        <p class="chico suave" style="margin-top:4px">
          Cada pregunta quedó marcada más abajo con su explicación. Es la parte que de verdad te sirve.
        </p>
      </div>
    } @else {
      <!-- ============ Antes de empezar ============ -->
      <div class="tarjeta" style="margin-bottom:20px">
        <p><strong>Responde honestamente y sin buscar.</strong> No lleva nota. Si adivinas, el
        diagnóstico deja de servir: sirve para decidir cuánto reforzamos cada tema en clases.
        <em>No sé</em> es una respuesta válida y aporta más que un acierto por casualidad.</p>
        <p class="chico suave" style="margin-top:10px">
          {{ total }} preguntas en ocho secciones, unos 60 minutos.
          <strong>Se rinde una sola vez</strong>, así que hazlo con tiempo y sin apuro.
        </p>
      </div>
    }

    <!-- ============ Cuestionario ============ -->
    @if (!yaHecho()) {
      @for (sec of secciones; track sec.id) {
        <div class="tarjeta" style="margin-bottom:20px">
          <div class="cabecera-seccion">
            <h2>Sección {{ sec.id }} · {{ sec.titulo }}</h2>
            @if (!corregido()) {
              <span class="insignia" [class.verde]="respondidasEn(sec) === sec.preguntas.length"
                    [class.celeste]="respondidasEn(sec) < sec.preguntas.length">
                {{ respondidasEn(sec) }} de {{ sec.preguntas.length }}
              </span>
            } @else {
              <span class="insignia" [class.verde]="puntaje(sec.id) >= sec.umbral"
                    [class.roja]="puntaje(sec.id) < sec.umbral">
                {{ puntaje(sec.id) }} de {{ max(sec) }} correctas
              </span>
            }
          </div>

          @if (sec.intro) {
            <div class="aviso dato" style="margin-top:12px">{{ sec.intro }}</div>
          }

          @for (p of sec.preguntas; track $index; let ip = $index) {
            <div class="pregunta">
              <div class="enunciado">
                <span class="numero">{{ sec.id }}{{ ip + 1 }}</span>
                <span class="texto" [innerHTML]="p.t"></span>
              </div>

              @if (p.codigo) {
                <pre><code>{{ p.codigo }}</code></pre>
              }

              <div class="ops">
                @for (op of conNoSe(p.ops); track $index; let io = $index) {
                  <label class="op"
                         [class.bloqueada]="corregido()"
                         [class.marcada]="respuesta(sec.id, ip) === io && (!corregido() || p.ok === undefined)"
                         [class.correcta]="corregido() && p.ok === io"
                         [class.fallada]="corregido() && p.ok !== undefined && p.ok !== io && respuesta(sec.id, ip) === io">
                    <input type="radio" [name]="sec.id + ip"
                           [checked]="respuesta(sec.id, ip) === io"
                           [disabled]="corregido()"
                           (change)="marcar(sec.id, ip, io)">
                    <span class="letra">{{ letra(io) }}</span>
                    <span>{{ op }}</span>
                  </label>
                }
              </div>

              @if (corregido()) {
                <div class="explicacion">
                  <span class="rotulo">{{ p.ok === undefined ? 'Por qué la pregunté' : 'Por qué' }}</span>
                  <span [innerHTML]="p.exp"></span>
                </div>
              }
            </div>
          }
        </div>
      }

      @if (!corregido()) {
        <div class="tarjeta">
          @if (error()) { <div class="aviso malo" style="margin-bottom:14px">{{ error() }}</div> }
          <div class="barra-entrega">
            <div class="avance">
              <div class="cuenta">
                <span class="suave">{{ total - faltan() }} de {{ total }} respondidas</span>
                @if (faltan() === 0) {
                  <span style="color:var(--verde);font-weight:600">Listo para entregar</span>
                } @else {
                  <span class="suave">Faltan {{ faltan() }}</span>
                }
              </div>
              <div class="barra" [class.verde]="faltan() === 0">
                <i [style.width.%]="(total - faltan()) / total * 100"></i>
              </div>
            </div>
            <button class="boton" (click)="entregar()" [disabled]="guardando()">
              {{ guardando() ? 'Registrando…' : 'Entregar' }}
            </button>
          </div>
        </div>
      }
    }

    <!-- ============ Tabla de resultados, reutilizada ============ -->
    <ng-template #tablaResultado>
      <div class="tarjeta">
        <h2>Tu resultado por sección</h2>
        <table style="margin-top:14px">
          <tr><th>Sección</th><th class="der">Aciertos</th><th>Qué repasar si quedaste bajo</th></tr>
          @for (sec of secciones; track sec.id) {
            <tr>
              <td>{{ sec.id }} · {{ sec.titulo }}</td>
              <td class="der num" style="font-weight:600">
                {{ puntaje(sec.id) }} <span class="suave">de {{ max(sec) }}</span>
              </td>
              <td>
                @if (puntaje(sec.id) < sec.umbral) {
                  <span class="insignia roja">{{ sec.repaso }}</span>
                } @else {
                  <span class="insignia verde">Sin observaciones</span>
                }
              </td>
            </tr>
          }
        </table>

        @if (puntaje('D') < 4) {
          <div class="aviso malo" style="margin-top:16px">
            <strong>Atención con la sección D.</strong> Es la que sostiene el resto del semestre:
            los consumidores de mensajería de la semana 8 y los de streaming de la semana 13 son
            código asíncrono de principio a fin. Las demás secciones se recuperan sobre la marcha;
            esa no. Avísame en clase.
          </div>
        } @else {
          <div class="aviso ok" style="margin-top:16px">
            <strong>Buena noticia:</strong> la sección D es la que más pesa en este ramo y la tienes
            firme. Eso te deja margen para el resto.
          </div>
        }

        <p class="chico suave" style="margin-top:16px">
          <a routerLink="/actividades">Volver a actividades</a>
        </p>
      </div>
    </ng-template>
  `,
})
export class DiagnosticoComponent {
  private datos = inject(DatosService);

  protected readonly secciones = SECCIONES;
  protected readonly total = totalPreguntas();

  actividad = signal<Actividad | null>(null);
  cargando = signal(true);
  yaHecho = signal(false);
  corregido = signal(false);
  guardando = signal(false);
  error = signal('');

  /** clave "A0" → índice de la alternativa marcada */
  private elegidas = signal<Record<string, number>>({});
  private puntajes = signal<Record<string, number>>({});

  faltan = computed(() => this.total - Object.keys(this.elegidas()).length);

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      const act = await this.datos.actividad(CODIGO);
      this.actividad.set(act);
      if (!act) { this.error.set('La actividad no está disponible.'); return; }

      const previos = await this.datos.resultados();
      const mio = previos.find(r => r.actividad_id === act.id);
      if (mio) {
        this.yaHecho.set(true);
        this.puntajes.set(mio.detalle?.puntajes ?? {});
        if (mio.detalle?.respuestas) this.elegidas.set(mio.detalle.respuestas);
      }
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar el diagnóstico.');
    } finally {
      this.cargando.set(false);
    }
  }

  conNoSe(ops: string[]): string[] {
    return [...ops, NO_SE];
  }

  letra(i: number): string {
    return String.fromCharCode(65 + i);
  }

  respondidasEn(sec: typeof SECCIONES[number]): number {
    const e = this.elegidas();
    return sec.preguntas.filter((_, i) => e[`${sec.id}${i}`] !== undefined).length;
  }

  max(sec: typeof SECCIONES[number]): number {
    return puntuables(sec);
  }

  respuesta(seccion: string, i: number): number | undefined {
    return this.elegidas()[`${seccion}${i}`];
  }

  marcar(seccion: string, i: number, opcion: number): void {
    this.elegidas.update(e => ({ ...e, [`${seccion}${i}`]: opcion }));
  }

  puntaje(seccion: string): number {
    return this.puntajes()[seccion] ?? 0;
  }

  async entregar(): Promise<void> {
    const act = this.actividad();
    if (!act || this.guardando()) return;

    if (this.faltan() > 0) {
      this.error.set(`Faltan ${this.faltan()} preguntas. «No sé» también es una respuesta válida.`);
      return;
    }

    // Corregir
    const puntajes: Record<string, number> = {};
    for (const sec of SECCIONES) {
      let aciertos = 0;
      sec.preguntas.forEach((p, i) => {
        if (p.ok === undefined) return;               // encuesta: no puntúa
        if (this.elegidas()[`${sec.id}${i}`] === p.ok) aciertos++;
      });
      puntajes[sec.id] = aciertos;
    }

    this.guardando.set(true);
    this.error.set('');
    try {
      await this.datos.registrarResultado(act.id, {
        puntajes,
        respuestas: this.elegidas(),
        version: 1,
      });
      this.puntajes.set(puntajes);
      this.corregido.set(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      const m = (e?.message ?? '').toLowerCase();
      this.error.set(m.includes('duplicate') || m.includes('unique')
        ? 'Ya habías entregado este diagnóstico.'
        : (e?.message ?? 'No se pudo registrar tu resultado.'));
    } finally {
      this.guardando.set(false);
    }
  }
}
