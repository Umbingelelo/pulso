import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AvanceLab, ActividadDocente, DatosService } from './datos.service';
import { DocenteStore } from './docente.store';
import { aIso, aLocal, semanaDe } from './fechas';

/**
 * Laboratorios, entregas y el diagnóstico: crearlos y editarlos.
 *
 * Una actividad con entregas no se borra ni cambia de tipo. Borrarla se llevaría
 * por delante los resultados de los alumnos y los puntos que ya se pagaron —el
 * libro de movimientos no se edita nunca— así que lo que hay es desactivarla:
 * deja de aparecer y lo hecho queda.
 *
 * ── El plazo ──
 *
 * Un laboratorio paga en su semana y después no. Las dos fechas se escriben acá,
 * en la hora del computador del docente, y vacías significan «sin plazo»: así se
 * comportaba todo antes de que esto existiera.
 *
 * El botón «Esta semana» está porque es el caso de todas las veces —los
 * laboratorios de la semana dan puntos esa semana— y escribir dos fechas a mano en
 * cada actividad es justo donde uno se equivoca en un dígito y le deja de pagar al
 * curso completo sin enterarse.
 *
 * La columna «a tiempo» es el control de ese error: si dice «24 entregas · 5 a
 * tiempo», el plazo está mal puesto, no es que el curso sea flojo.
 */
@Component({
  selector: 'app-docente-actividades',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="encabezado">
      <h1>Actividades y laboratorios</h1>
      <p>{{ docente.rotulo() || 'Lo que el alumno tiene que entregar.' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else {
      @if (hecho()) { <div class="aviso ok" style="margin-bottom:14px">{{ hecho() }}</div> }
      @if (error()) { <div class="aviso malo" style="margin-bottom:14px">{{ error() }}</div> }

      <div class="tarjeta">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
          <h2>{{ lista().length }} actividades</h2>
          <button class="boton chico" (click)="nueva()">Crear una</button>
        </div>

        @if (lista().length === 0) {
          <div class="aviso dato" style="margin-top:14px">
            Este ramo todavía no tiene actividades. Los laboratorios que crees acá
            aparecen en la pantalla de Actividades de tus alumnos.
          </div>
        } @else {
          <table style="margin-top:14px">
            <tr>
              <th>Código</th><th>Actividad</th><th>Tipo</th><th>Plazo</th>
              <th class="der">Puntos</th><th class="der">Entregas</th><th></th>
            </tr>
            @for (a of lista(); track a.id) {
              <tr [style.opacity]="a.activa ? 1 : .5">
                <td class="num">{{ a.codigo }}</td>
                <td>
                  {{ a.titulo }}
                  @if (!a.activa) { <span class="insignia" style="margin-left:6px">Oculta</span> }
                  @if (a.descripcion) { <div class="chico suave">{{ a.descripcion }}</div> }
                </td>
                <td>{{ etiqueta(a.tipo) }}</td>
                <td>
                  @if (!a.puntua_desde && !a.puntua_hasta) {
                    <span class="chico suave">sin plazo</span>
                  } @else {
                    <span class="insignia" [class.verde]="a.en_plazo"
                          [class.amarilla]="!a.en_plazo">
                      {{ a.en_plazo ? 'Abierto' : 'Cerrado' }}
                    </span>
                    <div class="chico suave">{{ plazo(a) }}</div>
                  }
                </td>
                <td class="der num">{{ a.puntos }}</td>
                <td class="der num">
                  {{ a.entregas }}
                  <!-- Solo cuando difieren: en una actividad sin plazo todas están
                       a tiempo por definición y repetir el número no dice nada. -->
                  @if (a.entregas > 0 && a.a_tiempo < a.entregas) {
                    <div class="chico suave">{{ a.a_tiempo }} a tiempo</div>
                  }
                </td>
                <td class="der" style="white-space:nowrap">
                  @if (a.tipo === 'laboratorio') {
                    <button class="boton contorno chico" style="margin-right:6px"
                            (click)="verAvance(a)">
                      {{ viendo() === a.codigo ? 'Ocultar' : 'Avance' }}
                    </button>
                  }
                  <!-- La etiqueta mira las dos cosas: que el formulario apunte a
                       esta fila Y que esté abierto. Solo lo primero dejaba el
                       botón diciendo «Cerrar» después de guardar, con el
                       formulario ya cerrado. -->
                  <button class="boton contorno chico" (click)="editar(a)">
                    {{ form().id === a.id && abierto() ? 'Cerrar' : 'Editar' }}
                  </button>
                </td>
              </tr>
            }
          </table>
        }
      </div>

      @if (viendo(); as codigo) {
        <div class="tarjeta" style="margin-top:18px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;
                      gap:14px;flex-wrap:wrap">
            <h2>Avance en {{ codigo }}</h2>
            @if (!cargandoAvance()) {
              <span class="insignia celeste">
                {{ entregados() }} de {{ avance().length }} entregados
              </span>
            }
          </div>
          <p class="chico suave" style="margin-top:2px">
            Solo aparece quien ya abrió el laboratorio. El tramo es hasta qué punto de
            control dice haber llegado: tú lo validas en sala, esto no lo comprueba.
          </p>

          @if (cargandoAvance()) {
            <p class="suave" style="margin-top:14px">Cargando…</p>
          } @else if (avance().length === 0) {
            <div class="aviso dato" style="margin-top:14px">Todavía no lo abre nadie.</div>
          } @else {
            <table style="margin-top:14px">
              <tr>
                <th>Alumno</th><th>Sección</th><th class="der">Respuestas</th>
                <th class="der">Tramo</th><th>Entrega</th>
              </tr>
              @for (x of avance(); track x.matricula_id) {
                <tr>
                  <td>{{ x.alumno }}</td>
                  <td>{{ x.seccion }}</td>
                  <td class="der num">{{ x.respondidas }}/{{ x.de }}</td>
                  <td class="der num">{{ x.tramo }}</td>
                  <td>
                    @if (x.entregado_en) {
                      <span class="insignia verde">{{ x.entregado_en | date:'dd/MM HH:mm' }}</span>
                    } @else {
                      <span class="insignia amarilla">Trabajando</span>
                    }
                  </td>
                </tr>
              }
            </table>
          }
        </div>
      }

      @if (abierto()) {
        <div class="tarjeta" style="margin-top:18px">
          <h2>{{ form().id ? 'Editar actividad' : 'Nueva actividad' }}</h2>

          <div class="rejilla dos" style="margin-top:16px">
            <label>
              <span class="etiqueta">Código</span>
              <!-- Lectura simple y escritura por tocar(). Un enlace de dos vías
                   sobre la propiedad del objeto lo mutaría sin avisarle a la
                   señal, y la pantalla no se enteraría del cambio. -->
              <input [ngModel]="form().codigo" name="codigo" placeholder="LAB1"
                     (ngModelChange)="tocar('codigo', $event)">
            </label>
            <label>
              <span class="etiqueta">Tipo</span>
              <select [ngModel]="form().tipo" name="tipo" (ngModelChange)="tocar('tipo', $event)"
                      [disabled]="!!form().id && entregasDelAbierto() > 0">
                <option value="laboratorio">Laboratorio</option>
                <option value="entrega">Entrega</option>
                <option value="diagnostico">Diagnóstico</option>
              </select>
            </label>
          </div>

          <label>
            <span class="etiqueta">Título</span>
            <input [ngModel]="form().titulo" name="titulo" (ngModelChange)="tocar('titulo', $event)"
                   placeholder="Laboratorio 1 · levantar un endpoint">
          </label>

          <label>
            <span class="etiqueta">Descripción</span>
            <input [ngModel]="form().descripcion" name="desc" (ngModelChange)="tocar('descripcion', $event)"
                   placeholder="Qué tiene que hacer el alumno, en una línea">
          </label>

          <div class="rejilla dos">
            <label>
              <span class="etiqueta">Puntos</span>
              <input type="number" min="0" [ngModel]="form().puntos" name="puntos"
                     (ngModelChange)="tocar('puntos', +$event)">
            </label>
            <label>
              <span class="etiqueta">Orden</span>
              <input type="number" min="0" [ngModel]="form().orden" name="orden"
                     (ngModelChange)="tocar('orden', +$event)">
            </label>
          </div>

          <div class="rejilla dos">
            <label>
              <span class="etiqueta">Da puntos desde</span>
              <input type="datetime-local" [ngModel]="form().desde" name="desde"
                     (ngModelChange)="tocar('desde', $event)">
            </label>
            <label>
              <span class="etiqueta">Da puntos hasta</span>
              <input type="datetime-local" [ngModel]="form().hasta" name="hasta"
                     (ngModelChange)="tocar('hasta', $event)">
            </label>
          </div>

          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px">
            <button class="boton contorno chico" (click)="estaSemana()">Esta semana</button>
            @if (form().desde || form().hasta) {
              <button class="boton contorno chico" (click)="sinPlazo()">Quitar el plazo</button>
            }
            <span class="chico suave">{{ leyendaPlazo() }}</span>
          </div>

          <label style="display:flex;align-items:center;gap:8px;margin-top:14px">
            <input type="checkbox" [ngModel]="form().activa" name="activa" style="width:auto"
                   (ngModelChange)="tocar('activa', $event)">
            <span class="chico">Visible para los alumnos</span>
          </label>

          @if (form().id && entregasDelAbierto() > 0) {
            <div class="aviso dato" style="margin-top:14px">
              Ya tiene {{ entregasDelAbierto() }} entregas, así que no se puede cambiar de tipo.
              Si ya no corresponde, desmárcala como visible: lo entregado se conserva.
            </div>
          }

          <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
            <button class="boton" [disabled]="guardando() || !completo()" (click)="guardar()">
              {{ guardando() ? 'Guardando…' : 'Guardar' }}
            </button>
            <button class="boton contorno" (click)="abierto.set(false)">Cancelar</button>
          </div>
        </div>
      }
    }
  `,
})
export class DocenteActividadesComponent {
  private datos = inject(DatosService);
  protected docente = inject(DocenteStore);

  lista = signal<ActividadDocente[]>([]);
  avance = signal<AvanceLab[]>([]);
  viendo = signal<string | null>(null);
  cargandoAvance = signal(false);
  abierto = signal(false);
  cargando = signal(true);
  guardando = signal(false);
  error = signal('');
  hecho = signal('');

  form = signal<{
    id: string | null; codigo: string; titulo: string; descripcion: string;
    tipo: string; puntos: number; orden: number; activa: boolean;
    /** Hora local sin zona, como la quiere el `datetime-local`. Vacío = sin límite. */
    desde: string; hasta: string;
  }>(this.vacio());

  entregasDelAbierto = computed(() =>
    this.lista().find(a => a.id === this.form().id)?.entregas ?? 0);

  entregados = computed(() => this.avance().filter(x => !!x.entregado_en).length);

  /**
   * Recargar cuando cambia el ramo, y no una sola vez al construirse.
   *
   * El selector vive en la barra lateral, así que puede cambiar sin que esta
   * pantalla se destruya. Leyendo el ramo solo en el constructor, la tabla se
   * quedaba con los datos del ramo anterior y no había ningún error que lo
   * delatara. Ver `docente.store.ts`.
   */
  constructor() {
    effect(() => {
      const clave = this.docente.ramoId();
      void clave;
      if (this.docente.ramo()) void this.cargar();
    });
    void this.docente.cargar();
  }

  private vacio() {
    return { id: null, codigo: '', titulo: '', descripcion: '',
             tipo: 'laboratorio', puntos: 100, orden: 0, activa: true,
             desde: '', hasta: '' };
  }

  etiqueta(t: string): string {
    return t === 'diagnostico' ? 'Diagnóstico' : t === 'laboratorio' ? 'Laboratorio' : 'Entrega';
  }

  /** El plazo de una fila, en una línea. */
  plazo(a: ActividadDocente): string {
    const f = (iso: string) =>
      new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit',
                                              minute: '2-digit' });
    if (a.puntua_desde && a.puntua_hasta) return `${f(a.puntua_desde)} → ${f(a.puntua_hasta)}`;
    if (a.puntua_hasta) return `hasta ${f(a.puntua_hasta)}`;
    return `desde ${f(a.puntua_desde!)}`;
  }

  /** Qué significan los dos campos tal como están ahora, dicho en palabras. */
  leyendaPlazo(): string {
    const { desde, hasta } = this.form();
    if (!desde && !hasta) return 'Sin plazo: paga cuando sea.';
    if (desde && hasta) return 'Fuera de esas fechas se puede entregar, pero no paga puntos.';
    if (hasta) return 'Después de esa fecha se puede entregar, pero no paga puntos.';
    return 'Antes de esa fecha se puede entregar, pero no paga puntos.';
  }

  /** Lunes 00:00 a domingo 23:59 de la semana en curso. El caso de siempre. */
  estaSemana(): void {
    const { desde, hasta } = semanaDe(new Date());
    this.form.set({ ...this.form(), desde, hasta });
  }

  sinPlazo(): void {
    this.form.set({ ...this.form(), desde: '', hasta: '' });
  }

  completo(): boolean {
    const f = this.form();
    return f.codigo.trim().length > 0 && f.titulo.trim().length > 2;
  }

  /** Las señales son inmutables: se reemplaza el objeto, no se muta un campo. */
  tocar(campo: string, valor: any): void {
    this.form.set({ ...this.form(), [campo]: valor });
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      await this.docente.cargar();
      const r = this.docente.ramo();
      if (!r) return;
      this.lista.set(await this.datos.actividadesQueDicto(r.asignatura_id, r.periodo_id));
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudieron cargar las actividades.');
    } finally {
      this.cargando.set(false);
    }
  }

  nueva(): void {
    const siguiente = Math.max(0, ...this.lista().map(a => a.orden)) + 1;
    this.form.set({ ...this.vacio(), orden: siguiente });
    this.abierto.set(true);
    this.error.set(''); this.hecho.set('');
  }

  editar(a: ActividadDocente): void {
    if (this.form().id === a.id && this.abierto()) { this.abierto.set(false); return; }
    this.form.set({
      id: a.id, codigo: a.codigo, titulo: a.titulo, descripcion: a.descripcion ?? '',
      tipo: a.tipo, puntos: a.puntos, orden: a.orden, activa: a.activa,
      desde: aLocal(a.puntua_desde), hasta: aLocal(a.puntua_hasta),
    });
    this.abierto.set(true);
    this.error.set(''); this.hecho.set('');
  }

  /** Cómo va el curso en un laboratorio. Se pide al abrirlo, no al cargar la
   *  pantalla: son tantas consultas como laboratorios haya y casi siempre miras
   *  uno solo, el que estás dictando. */
  async verAvance(a: ActividadDocente): Promise<void> {
    if (this.viendo() === a.codigo) { this.viendo.set(null); return; }
    const r = this.docente.ramo();
    if (!r) return;
    this.viendo.set(a.codigo);
    this.avance.set([]);
    this.cargandoAvance.set(true);
    this.error.set('');
    try {
      this.avance.set(
        await this.datos.avancesLaboratorio(r.asignatura_id, r.periodo_id, a.codigo));
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar el avance.');
      this.viendo.set(null);
    } finally {
      this.cargandoAvance.set(false);
    }
  }

  async guardar(): Promise<void> {
    const r = this.docente.ramo();
    if (!r || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(''); this.hecho.set('');
    try {
      const f = this.form();
      await this.datos.guardarActividad({
        id: f.id, asignaturaId: r.asignatura_id, periodoId: r.periodo_id,
        codigo: f.codigo, titulo: f.titulo,
        descripcion: f.descripcion.trim() || null,
        tipo: f.tipo, puntos: f.puntos, orden: f.orden, activa: f.activa,
        puntuaDesde: aIso(f.desde), puntuaHasta: aIso(f.hasta),
      });
      await this.cargar();
      this.abierto.set(false);
      this.hecho.set(f.id ? 'Actividad actualizada.' : `«${f.titulo}» quedó creada.`);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo guardar.');
    } finally {
      this.guardando.set(false);
    }
  }
}
