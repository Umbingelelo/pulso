import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlumnoDocente, DatosService, RamoDocente } from './datos.service';
import { DocenteStore } from './docente.store';

/**
 * Administrar alumnos: sus puntos, moverlos de sección, darlos de baja, reiniciar
 * su clave.
 *
 * Nada se borra nunca. Dar de baja es `activa = false`, que lo saca de las listas
 * y de los promedios sin perder lo que hizo mientras cursaba; y cambiar de
 * sección mueve la matrícula entera, así que se lleva sus puntos y su progreso
 * consigo. Cambiarse de sección no debería costarle a nadie lo que ya trabajó.
 *
 * ── Por qué los puntos se ajustan también acá ──
 *
 * El formulario ya existía, pero solo en «Resumen». Y esta pantalla se llama
 * «Alumnos», muestra la columna de puntos, y es donde uno va a buscar cualquier
 * cosa que se le haga a un alumno: tener la acción en la otra lista la volvía
 * invisible. Es el mismo `otorgarPuntos()` de siempre, así que no hay dos maneras
 * de hacer lo mismo, hay una en los dos lugares donde se busca.
 *
 * El libro de movimientos **no se edita**: ajustar es agregar una línea, positiva o
 * negativa, con su motivo. Por eso el campo pide un motivo obligatorio —el alumno
 * lo va a leer en su pantalla de puntos, y «−50» sin explicación es peor que no
 * descontar— y por eso no hay ningún botón que diga «corregir».
 */
@Component({
  selector: 'app-docente-alumnos',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <div class="encabezado">
      <h1>Alumnos</h1>
      <p>{{ docente.rotulo() || 'Administrar matrículas del curso.' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else {
      <!-- Las secciones primero, porque administrar un curso es administrar una
           sección. Son pestañas y no un desplegable: con tres secciones, verlas
           todas con su cuenta al lado dice de un vistazo cómo está repartido el
           curso, y elegir es un clic en vez de dos. Cambian la elección del store,
           así que la barra lateral y las otras tres pantallas se enteran. -->
      <div class="tarjeta" style="margin-bottom:18px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="boton chico" [class.contorno]="docente.seccionId() !== ''"
                  (click)="docente.elegirSeccion('')">
            Todas · {{ total() }}
          </button>
          @for (s of secciones(); track s.id) {
            <button class="boton chico" [class.contorno]="docente.seccionId() !== s.id"
                    (click)="docente.elegirSeccion(s.id)">
              {{ s.codigo }} · {{ s.matriculados }}
            </button>
          }
          @if (secciones().length === 0) {
            <span class="chico suave">Este ramo todavía no tiene secciones cargadas.</span>
          }
        </div>

        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:14px">
          <input style="flex:1 1 240px" placeholder="Buscar por nombre o correo"
                 [ngModel]="busca()" (ngModelChange)="busca.set($event)" name="busca">
          <label style="display:flex;align-items:center;gap:8px;margin:0">
            <input type="checkbox" [ngModel]="verBajas()" (ngModelChange)="verBajas.set($event)"
                   name="bajas" style="width:auto">
            <span class="chico">Ver dados de baja</span>
          </label>
          <!-- Tres números y no uno: cuántos se ven, cuántos tiene la sección y
               cuántos el ramo. Sin el del medio no hay forma de saber si la lista
               está corta porque filtraste o porque falta gente. -->
          <span class="insignia celeste">
            {{ visibles().length }} de {{ deLaSeccion().length }}
            @if (docente.seccionId()) { · {{ alumnos().length }} en el ramo }
          </span>
        </div>
      </div>

      @if (hecho()) { <div class="aviso ok" style="margin-bottom:14px">{{ hecho() }}</div> }
      @if (error()) { <div class="aviso malo" style="margin-bottom:14px">{{ error() }}</div> }

      <div class="tarjeta">
        <table>
          <tr>
            <th>Alumno</th><th>Sección</th><th class="der">Puntos</th>
            <th class="der">Exp.</th><th class="der">Clases</th><th>Diag.</th><th></th>
          </tr>
          @for (a of visibles(); track a.matricula_id) {
            <tr [style.opacity]="a.activa ? 1 : .5">
              <td>
                <strong>{{ a.nombre }}</strong>
                @if (!a.activa) { <span class="insignia" style="margin-left:6px">De baja</span> }
                <div class="chico suave">{{ a.correo }}</div>
              </td>
              <td>{{ a.seccion }}</td>
              <td class="der num">{{ a.puntos }}</td>
              <td class="der num">{{ a.experiencia }}</td>
              <td class="der num">{{ a.clases_terminadas }}/{{ a.clases_abiertas }}</td>
              <td>
                @if (a.diagnostico) { <span class="insignia verde">sí</span> }
                @else { <span class="insignia amarilla">no</span> }
              </td>
              <td class="der" style="white-space:nowrap">
                <button class="boton contorno chico" style="margin-right:6px"
                        (click)="abrirEnPuntos(a)">Puntos</button>
                <button class="boton contorno chico" (click)="abrir(a)">
                  {{ editando()?.matricula_id === a.matricula_id ? 'Cerrar' : 'Editar' }}
                </button>
              </td>
            </tr>
          }
        </table>
        @if (visibles().length === 0) {
          <div class="aviso dato" style="margin-top:14px">Nadie calza con ese filtro.</div>
        }
      </div>

      @if (editando(); as a) {
        <div class="tarjeta" style="margin-top:18px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap">
            <h2>{{ a.nombre }}</h2>
            <a class="boton contorno chico" [routerLink]="['/ficha', a.matricula_id]">Ver su ficha</a>
          </div>
          <p class="chico suave" style="margin-top:2px">
            {{ a.correo }} · se matriculó el {{ a.creado_en | date:'dd/MM/yyyy' }}
            @if (a.ultimo_ingreso) { · último ingreso {{ a.ultimo_ingreso | date:'dd/MM HH:mm' }} }
            @else { · nunca ha entrado }
          </p>

          <!-- Primero los puntos: es lo que más se toca, y es lo que se venía a
               hacer si se entró por el botón «Puntos» de la fila. -->
          <div id="bloque-puntos" style="margin-top:20px;padding:16px;
                                         border-radius:var(--r-chico);background:var(--fondo)">
            <div style="display:flex;justify-content:space-between;align-items:baseline;
                        gap:14px;flex-wrap:wrap">
              <span class="etiqueta">Ajustar puntos</span>
              <span class="insignia celeste num">{{ a.puntos }} ahora</span>
            </div>

            <div class="rejilla dos" style="margin-top:10px">
              <label style="margin:0">
                <span class="etiqueta">Cuántos</span>
                <input type="number" [(ngModel)]="monto" name="monto"
                       placeholder="100 · o −50 para descontar">
              </label>
              <label style="margin:0">
                <span class="etiqueta">Motivo</span>
                <input [(ngModel)]="motivo" name="motivoPuntos"
                       placeholder="Laboratorio 1 hecho en clase">
              </label>
            </div>

            <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;align-items:center">
              <button class="boton chico"
                      [disabled]="ocupado() || !monto || !motivo.trim()"
                      (click)="ajustar(a)">
                {{ ocupado() ? 'Registrando…' : etiquetaAjuste() }}
              </button>
              <span class="chico suave">
                Queda como un movimiento con su motivo, y el alumno lo ve en su pantalla de
                puntos. El libro no se edita: para deshacer, se registra el contrario.
              </span>
            </div>
          </div>

          <div class="rejilla dos" style="margin-top:20px">
            <div>
              <span class="etiqueta">Sección</span>
              <div style="display:flex;gap:8px;margin-top:6px">
                <select [(ngModel)]="nuevaSeccion" name="sec" style="flex:1">
                  @for (s of secciones(); track s.id) {
                    <option [value]="s.id">{{ s.codigo }}</option>
                  }
                </select>
                <button class="boton chico" [disabled]="ocupado() || nuevaSeccion === a.seccion_id"
                        (click)="mover(a)">Mover</button>
              </div>
              <p class="chico suave" style="margin-top:6px">
                Se lleva sus puntos y su progreso: cambiarse de sección no borra nada.
              </p>
            </div>

            <div>
              <span class="etiqueta">Contraseña</span>
              <div style="display:flex;gap:8px;margin-top:6px">
                <input type="text" [(ngModel)]="clave" name="clave" style="flex:1"
                       placeholder="Mínimo 8 caracteres" autocomplete="off">
                <button class="boton chico" [disabled]="ocupado() || clave.length < 8"
                        (click)="reiniciar(a)">Cambiar</button>
              </div>
              <p class="chico suave" style="margin-top:6px">
                Se la dictas tú al alumno. Todavía no hay pantalla de recuperación.
              </p>
            </div>
          </div>

          <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;
                      padding-top:18px;border-top:1px solid var(--borde)">
            @if (a.activa) {
              <button class="boton contorno chico" [disabled]="ocupado()" (click)="baja(a, false)">
                Dar de baja
              </button>
              <span class="chico suave" style="align-self:center">
                Sale de listas y promedios. No se borra nada.
              </span>
            } @else {
              <button class="boton chico" [disabled]="ocupado()" (click)="baja(a, true)">
                Reactivar
              </button>
            }
          </div>
        </div>
      }
    }
  `,
})
export class DocenteAlumnosComponent {
  private datos = inject(DatosService);
  protected docente = inject(DocenteStore);

  alumnos = signal<AlumnoDocente[]>([]);
  editando = signal<AlumnoDocente | null>(null);
  cargando = signal(true);
  ocupado = signal(false);
  error = signal('');
  hecho = signal('');

  /**
   * Los filtros son señales, no propiedades.
   *
   * `visibles` es un `computed`, y un computed solo se recalcula cuando cambia
   * una **señal** que lee. Con propiedades normales el buscador no filtraba nada:
   * la lista se quedaba completa y «Editar» terminaba abriendo al alumno
   * equivocado, que es mucho peor que no filtrar.
   */
  busca = signal('');
  verBajas = signal(false);

  /**
   * La sección la manda el store, no esta pantalla.
   *
   * Antes era una señal local: se reiniciaba en cada recarga —incluso al ajustar
   * los puntos de alguien, porque `operar()` recarga— y no existía en las otras
   * tres pantallas. Elegir la sección en la barra y que las cuatro obedezcan es
   * la diferencia entre filtrar una tabla y administrar una sección.
   */
  secciones = computed(() => this.docente.secciones());

  /** Los matriculados del ramo entero, para la pestaña «Todas». */
  total = computed(() => this.secciones().reduce((n, s) => n + s.matriculados, 0));

  nuevaSeccion = '';
  clave = '';
  /** El ajuste de puntos. Negativo descuenta. */
  monto: number | null = null;
  motivo = '';

  /** Los del ramo que caen en la sección elegida. '' = todas. */
  deLaSeccion = computed(() => {
    const sec = this.docente.seccionId();
    return sec ? this.alumnos().filter(a => a.seccion_id === sec) : this.alumnos();
  });

  visibles = computed(() => {
    const q = this.busca().trim().toLowerCase();
    const bajas = this.verBajas();
    return this.deLaSeccion().filter(a =>
      (bajas || a.activa)
      && (!q || a.nombre.toLowerCase().includes(q) || a.correo.toLowerCase().includes(q)));
  });

  /**
   * Recargar cuando cambia el ramo, y no una sola vez al construirse.
   *
   * El bug de fondo era éste: la pantalla leía el ramo en el constructor y no
   * volvía a mirar. Cambiar el selector de la barra dejaba la tabla con los
   * alumnos del ramo anterior, sin ningún error — con 71 en un ramo y 23 en el
   * otro, se ve igual que «no me salen todos los alumnos».
   *
   * El `effect` mira **el ramo y no la sección**: la sección se aplica en
   * `deLaSeccion`, sobre los datos que ya están en memoria. Volver a pedir la
   * nómina entera para filtrar por sección sería un viaje al servidor por un
   * `filter`.
   */
  constructor() {
    let anterior = '';
    effect(() => {
      const clave = this.docente.ramoId();
      const r = this.docente.ramo();
      if (!r) return;
      // La ficha abierta es de un alumno del ramo anterior: se cierra. Solo acá,
      // que es el único momento en que la selección dejó de tener sentido.
      if (anterior && anterior !== clave) this.editando.set(null);
      anterior = clave;
      void this.cargar(r);
    });
    void this.docente.cargar();
  }

  /**
   * Trae la nómina del ramo. **No toca `editando`**, a propósito: `operar()`
   * recarga después de cada cambio y tiene que dejar la ficha abierta donde
   * estaba. Limpiarla acá cerraba la tarjeta tras «Dar de baja», y entonces
   * «Reactivar» —que vive dentro de esa tarjeta— ya no existía. Quien limpia la
   * selección es el `effect`, y solo cuando de verdad cambió el ramo.
   */
  private async cargar(r: RamoDocente): Promise<void> {
    this.cargando.set(true);
    try {
      this.alumnos.set(await this.datos.alumnosDelRamo(r.asignatura_id, r.periodo_id));
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar el curso.');
    } finally {
      this.cargando.set(false);
    }
  }

  abrir(a: AlumnoDocente): void {
    if (this.editando()?.matricula_id === a.matricula_id) { this.editando.set(null); return; }
    this.editando.set(a);
    this.nuevaSeccion = a.seccion_id;
    this.clave = '';
    this.monto = null;
    this.motivo = '';
    this.error.set(''); this.hecho.set('');
  }

  /**
   * Igual que `abrir`, pero baja hasta el bloque de puntos.
   *
   * Sin el desplazamiento el botón parecía no hacer nada: la tarjeta se abre más
   * abajo del pliegue en una nómina de sesenta alumnos, y el docente se queda
   * mirando la misma tabla. Y **no** alterna como «Editar» —vuelve a bajar si ya
   * estaba abierta— porque cerrar no es lo que se pide al apretar «Puntos».
   */
  abrirEnPuntos(a: AlumnoDocente): void {
    if (this.editando()?.matricula_id !== a.matricula_id) this.abrir(a);
    // Después del render, si no el nodo todavía no existe.
    setTimeout(() =>
      document.getElementById('bloque-puntos')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  /** «Sumar 100 puntos» / «Descontar 50 puntos», según el signo. */
  etiquetaAjuste(): string {
    const n = this.monto;
    if (!n) return 'Registrar movimiento';
    return n > 0 ? `Sumar ${n} puntos` : `Descontar ${Math.abs(n)} puntos`;
  }

  ajustar(a: AlumnoDocente): void {
    const n = this.monto;
    const porQue = this.motivo.trim();
    if (!n || !porQue) return;
    this.operar(async () => {
      await this.datos.otorgarPuntos(a.matricula_id, n, porQue);
      this.monto = null;
      this.motivo = '';
    }, `${n > 0 ? '+' : ''}${n} puntos para ${a.nombre.split(' ')[0]}: ${porQue}`);
  }

  private async operar(f: () => Promise<void>, mensaje: string): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.error.set(''); this.hecho.set('');
    // Antes de recargar: después, `editando` ya apunta a una fila vieja.
    const id = this.editando()?.matricula_id;
    try {
      await f();
      const r = this.docente.ramo();
      if (r) await this.cargar(r);
      // Mover a alguien de sección cambia las cuentas del selector de la barra.
      await this.docente.refrescarSecciones();
      // La ficha abierta quedó obsoleta tras recargar: se vuelve a apuntar a la
      // fila nueva para no mostrar datos viejos junto a un mensaje de éxito.
      this.editando.set(this.alumnos().find(x => x.matricula_id === id) ?? null);
      this.hecho.set(mensaje);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo completar la operación.');
    } finally {
      this.ocupado.set(false);
    }
  }

  mover(a: AlumnoDocente): void {
    const destino = this.secciones().find(s => s.id === this.nuevaSeccion)?.codigo ?? '';
    this.operar(() => this.datos.cambiarSeccion(a.matricula_id, this.nuevaSeccion),
      `${a.nombre} quedó en la sección ${destino}.`);
  }

  reiniciar(a: AlumnoDocente): void {
    const dicha = this.clave;
    this.operar(() => this.datos.reiniciarClave(a.matricula_id, dicha),
      `Contraseña cambiada. Dísela a ${a.nombre.split(' ')[0]}: ${dicha}`);
  }

  baja(a: AlumnoDocente, activa: boolean): void {
    this.operar(() => this.datos.activarAlumno(a.matricula_id, activa),
      activa ? `${a.nombre} vuelve al curso.` : `${a.nombre} quedó de baja.`);
  }
}
