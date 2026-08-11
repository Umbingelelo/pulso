import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Cuestionario, DatosService, PreguntaDiagnostico, SeccionDiagnostico } from './datos.service';
import { PerfilStore } from './perfil.store';

/**
 * El contenido ya no vive en el código: llega de `diagnostico_cuestionario()`,
 * que devuelve las preguntas **sin la pauta**. `correcta` y `explicacion` viajan
 * en null hasta que el alumno entrega, y quien corrige es el servidor.
 */
@Component({
  selector: 'app-diagnostico',
  imports: [RouterLink, NgTemplateOutlet],
  template: `
    <div class="encabezado">
      <h1>Diagnóstico de entrada</h1>
      <p>{{ cuestionario()?.actividad?.descripcion ?? perfil.ramo()?.asignatura ?? '' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (!cuestionario()) {
      <div class="tarjeta">
        <div class="aviso dato">
          Este ramo todavía no tiene diagnóstico de entrada publicado.
          <p class="chico" style="margin-top:8px">
            <a routerLink="/actividades">Volver a actividades</a>
          </p>
        </div>
      </div>
    } @else {
      @if (yaHecho() && !reciencorregido()) {
        <div class="tarjeta" style="margin-bottom:20px">
          <div class="aviso ok">
            <strong>Ya completaste el diagnóstico.</strong>
            Se rinde una sola vez, así que estos son tus resultados definitivos.
          </div>
        </div>
        <ng-container [ngTemplateOutlet]="tablaResultado"></ng-container>
      } @else if (reciencorregido()) {
        <div class="tarjeta" style="margin-bottom:20px">
          <div class="aviso ok">
            <strong>Listo.</strong> Tus respuestas quedaron registradas y ganaste
            {{ cuestionario()!.actividad.puntos }} puntos.
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
        <div class="tarjeta" style="margin-bottom:20px">
          <p><strong>Responde honestamente y sin buscar.</strong> No lleva nota. Si adivinas, el
          diagnóstico deja de servir: sirve para decidir cuánto reforzamos cada tema en clases.
          <em>No sé</em> es una respuesta válida y aporta más que un acierto por casualidad.</p>
          <p class="chico suave" style="margin-top:10px">
            {{ total() }} preguntas en {{ secciones().length }} secciones, unos 60 minutos.
            <strong>Se rinde una sola vez</strong>, así que hazlo con tiempo y sin apuro.
          </p>
        </div>
      }

      <!-- ============ Cuestionario ============ -->
      @if (!yaHecho() || reciencorregido()) {
        @for (sec of secciones(); track sec.codigo) {
          <div class="tarjeta" style="margin-bottom:20px">
            <div class="cabecera-seccion">
              <h2>Sección {{ sec.codigo }} · {{ sec.titulo }}</h2>
              @if (!corregido()) {
                <span class="insignia" [class.verde]="respondidasEn(sec) === sec.preguntas.length"
                      [class.celeste]="respondidasEn(sec) < sec.preguntas.length">
                  {{ respondidasEn(sec) }} de {{ sec.preguntas.length }}
                </span>
              } @else {
                <span class="insignia" [class.verde]="puntaje(sec.codigo) >= sec.umbral"
                      [class.roja]="puntaje(sec.codigo) < sec.umbral">
                  {{ puntaje(sec.codigo) }} de {{ max(sec) }} correctas
                </span>
              }
            </div>

            @if (sec.intro) {
              <div class="aviso dato" style="margin-top:12px">{{ sec.intro }}</div>
            }

            @for (p of sec.preguntas; track p.orden) {
              <div class="pregunta">
                <div class="enunciado">
                  <span class="numero">{{ sec.codigo }}{{ p.orden }}</span>
                  <span class="texto" [innerHTML]="p.enunciado"></span>
                </div>

                @if (p.codigo) {
                  <pre><code>{{ p.codigo }}</code></pre>
                }

                <div class="ops">
                  @for (op of p.opciones; track $index; let io = $index) {
                    <label class="op"
                           [class.bloqueada]="corregido()"
                           [class.marcada]="respuesta(sec.codigo, p.orden) === io && (!corregido() || !p.puntua)"
                           [class.correcta]="corregido() && p.correcta === io"
                           [class.fallada]="corregido() && p.puntua && p.correcta !== io && respuesta(sec.codigo, p.orden) === io">
                      <input type="radio" [name]="sec.codigo + p.orden"
                             [checked]="respuesta(sec.codigo, p.orden) === io"
                             [disabled]="corregido()"
                             (change)="marcar(sec.codigo, p.orden, io)">
                      <span class="letra">{{ letra(io) }}</span>
                      <span>{{ op }}</span>
                    </label>
                  }
                </div>

                @if (corregido() && p.explicacion) {
                  <div class="explicacion">
                    <span class="rotulo">{{ p.puntua ? 'Por qué' : 'Por qué la pregunté' }}</span>
                    <span [innerHTML]="p.explicacion"></span>
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
                  <span class="suave">{{ total() - faltan() }} de {{ total() }} respondidas</span>
                  @if (faltan() === 0) {
                    <span style="color:var(--verde);font-weight:600">Listo para entregar</span>
                  } @else {
                    <span class="suave">Faltan {{ faltan() }}</span>
                  }
                </div>
                <div class="barra" [class.verde]="faltan() === 0">
                  <i [style.width.%]="total() ? (total() - faltan()) / total() * 100 : 0"></i>
                </div>
              </div>
              <button class="boton" (click)="entregar()" [disabled]="guardando()">
                {{ guardando() ? 'Registrando…' : 'Entregar' }}
              </button>
            </div>
          </div>
        }
      }
    }

    <!-- ============ Tabla de resultados, reutilizada ============ -->
    <ng-template #tablaResultado>
      <div class="tarjeta">
        <h2>Tu resultado por sección</h2>
        <table style="margin-top:14px">
          <tr><th>Sección</th><th class="der">Aciertos</th><th>Qué repasar si quedaste bajo</th></tr>
          @for (sec of secciones(); track sec.codigo) {
            <tr>
              <td>{{ sec.codigo }} · {{ sec.titulo }}</td>
              <td class="der num" style="font-weight:600">
                {{ puntaje(sec.codigo) }} <span class="suave">de {{ max(sec) }}</span>
              </td>
              <td>
                @if (puntaje(sec.codigo) < sec.umbral) {
                  <span class="insignia roja">{{ sec.repaso }}</span>
                } @else {
                  <span class="insignia verde">Sin observaciones</span>
                }
              </td>
            </tr>
          }
        </table>

        <!-- El aviso lo decide la sección marcada como crítica en la base, no el
             código: así cada asignatura señala la suya sin tocar la app. -->
        @if (critica(); as c) {
          @if (puntaje(c.codigo) < c.umbral) {
            <div class="aviso malo" style="margin-top:16px">
              <strong>Atención con la sección {{ c.codigo }}.</strong>
              {{ c.titulo }} es la que sostiene el resto del semestre. Las demás se recuperan
              sobre la marcha; esa no. Avísame en clase.
            </div>
          } @else {
            <div class="aviso ok" style="margin-top:16px">
              <strong>Buena noticia:</strong> {{ c.titulo }} es la sección que más pesa en este ramo
              y la tienes firme. Eso te deja margen para el resto.
            </div>
          }
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
  protected perfil = inject(PerfilStore);

  cuestionario = signal<Cuestionario | null>(null);
  cargando = signal(true);
  reciencorregido = signal(false);
  guardando = signal(false);
  error = signal('');

  /** clave "A1" → índice de la alternativa marcada */
  private elegidas = signal<Record<string, number>>({});

  secciones = computed(() => this.cuestionario()?.secciones ?? []);
  yaHecho = computed(() => this.cuestionario()?.rendido ?? false);
  corregido = computed(() => this.yaHecho());
  critica = computed(() => this.secciones().find(s => s.critica) ?? null);
  total = computed(() => this.secciones().reduce((n, s) => n + s.preguntas.length, 0));
  faltan = computed(() => this.total() - Object.keys(this.elegidas()).length);

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      await this.perfil.cargar();
      const ramo = this.perfil.ramo();
      if (!ramo) { this.error.set('Primero elige un ramo.'); return; }

      const c = await this.datos.cuestionario(ramo.matricula_id);
      this.cuestionario.set(c);
      if (c?.respuestas) this.elegidas.set({ ...c.respuestas });
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar el diagnóstico.');
    } finally {
      this.cargando.set(false);
    }
  }

  letra(i: number): string {
    return String.fromCharCode(65 + i);
  }

  respondidasEn(sec: SeccionDiagnostico): number {
    const e = this.elegidas();
    return sec.preguntas.filter(p => e[`${sec.codigo}${p.orden}`] !== undefined).length;
  }

  max(sec: SeccionDiagnostico): number {
    return sec.preguntas.filter((p: PreguntaDiagnostico) => p.puntua).length;
  }

  respuesta(seccion: string, orden: number): number | undefined {
    return this.elegidas()[`${seccion}${orden}`];
  }

  marcar(seccion: string, orden: number, opcion: number): void {
    this.elegidas.update(e => ({ ...e, [`${seccion}${orden}`]: opcion }));
  }

  puntaje(seccion: string): number {
    return this.cuestionario()?.puntajes?.[seccion] ?? 0;
  }

  async entregar(): Promise<void> {
    const ramo = this.perfil.ramo();
    if (!ramo || this.guardando()) return;

    if (this.faltan() > 0) {
      this.error.set(`Faltan ${this.faltan()} preguntas. «No sé» también es una respuesta válida.`);
      return;
    }

    this.guardando.set(true);
    this.error.set('');
    try {
      // Corrige el servidor y devuelve el cuestionario con la pauta ya visible.
      const corregido = await this.datos.rendirDiagnostico(ramo.matricula_id, this.elegidas());
      this.cuestionario.set(corregido);
      this.reciencorregido.set(true);
      await this.perfil.recargarRamos(ramo.matricula_id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      const m = (e?.message ?? '').toLowerCase();
      this.error.set(m.includes('ya rendiste')
        ? 'Ya habías entregado este diagnóstico.'
        : (e?.message ?? 'No se pudo registrar tu resultado.'));
    } finally {
      this.guardando.set(false);
    }
  }
}
