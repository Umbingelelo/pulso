import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Actividad, DatosService, EstadoLaboratorio, Ramo, Resultado, plazoVigente } from './datos.service';
import { PerfilStore } from './perfil.store';

/**
 * Lo que hay que hacer y lo que ya se hizo.
 *
 * ── El plazo se dice acá, no después de entregar ──
 *
 * Una actividad puede tener un plazo para pagar: dentro da puntos, fuera se puede
 * hacer igual pero no paga. Eso tiene que estar en la tarjeta, antes de que el
 * alumno entre: descubrir el plazo al entregar no es un plazo, es una trampa. Por
 * eso la insignia dice «Fuera de plazo» en vez de «Pendiente» y la línea de abajo
 * pone la fecha.
 */

@Component({
  selector: 'app-actividades',
  imports: [RouterLink, DatePipe],
  template: `
    <div class="encabezado">
      <h1>Actividades</h1>
      <p>{{ perfil.ramo()?.asignatura ?? 'Lo que tienes que hacer, y lo que ya hiciste.' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (actividades().length === 0) {
      <div class="tarjeta">
        <div class="aviso dato">Todavía no hay actividades publicadas.</div>
      </div>
    } @else {
      <div class="rejilla dos">
        @for (a of actividades(); track a.id) {
          <div class="tarjeta">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
              <div>
                <p class="etiqueta">{{ esOpcional(a) ? 'Desafío' : etiquetaTipo(a.tipo) }}</p>
                <h2 style="margin-top:4px">{{ a.titulo }}</h2>
              </div>
              @if (hecha(a.id)) {
                <span class="insignia verde">Completada</span>
              } @else if (falta(a); as req) {
                <span class="insignia">Se abre con {{ req }}</span>
              } @else if (cerradoPor(a); as otro) {
                <!-- Antes que «Fuera de plazo» y que «Opcional»: que ya no se pueda
                     hacer es lo primero que el alumno necesita saber, y el resto
                     deja de importarle. -->
                <span class="insignia">Hiciste {{ otro }}</span>
              } @else if (!enPlazo(a)) {
                <!-- Antes que «Opcional» a propósito: que ya no pague es lo que
                     cambia la decisión del alumno, y es lo que tiene que leer
                     primero. -->
                <span class="insignia">Fuera de plazo</span>
              } @else if (esOpcional(a)) {
                <span class="insignia celeste">Opcional</span>
              } @else {
                <span class="insignia amarilla">Pendiente</span>
              }
            </div>

            @if (a.descripcion) {
              <p class="chico suave" style="margin-top:10px">{{ a.descripcion }}</p>
            }
            @if (cerradoPor(a); as otro) {
              <p class="chico suave" style="margin-top:8px">
                Este y <strong>{{ otro }}</strong> son alternativas: se hace uno o el
                otro, no los dos. Ya entregaste {{ otro }} y sus puntos están contados.
              </p>
            } @else if (!hecha(a.id) && alternativaDe(a); as otro) {
              <!-- Decirlo **antes** de que elija, no después de que cobre: es la
                   diferencia entre una regla y una sorpresa. Y solo antes: sobre una
                   tarjeta ya «Completada», «elige el que puedas hacer» le pide una
                   decisión que ya tomó. -->
              <p class="chico suave" style="margin-top:8px">
                Alternativa de <strong>{{ otro }}</strong>: al entregar uno, el otro se
                cierra. Elige el que puedas hacer.
              </p>
            } @else if (esOpcional(a) && !hecha(a.id)) {
              <p class="chico suave" style="margin-top:8px">
                No entra en ninguna nota. Es para quien terminó y quiere más.
              </p>
            }
            @if (!hecha(a.id) && leyendaPlazo(a); as aviso) {
              <p class="chico" style="margin-top:8px" [class.suave]="enPlazo(a)">{{ aviso }}</p>
            }

            <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:18px;flex-wrap:wrap">
              <!-- Sin plazo o dentro de él vale lo que dice; fuera vale cero, y
                   anunciar los 100 puntos que ya no se pagan sería mentirle. -->
              <span class="insignia" [class.celeste]="enPlazo(a)">
                {{ hecha(a.id) || enPlazo(a) ? a.puntos : 0 }} puntos
              </span>
              @if (hecha(a.id); as r) {
                <a class="boton contorno chico" [routerLink]="ruta(a)">Ver mi resultado</a>
              } @else if (falta(a); as req) {
                <!-- Sin enlace: ofrecer «Empezar» sobre algo cerrado es prometer
                     una puerta que no abre. El candado real está en la base; esto
                     solo evita el viaje en falso. -->
                <span class="chico suave">Termina {{ req }} para desbloquearlo</span>
              } @else if (cerradoPor(a); as otro) {
                <span class="chico suave">Elegiste {{ otro }}</span>
              } @else {
                <a class="boton accion chico" [routerLink]="ruta(a)">Empezar</a>
              }
            </div>

            @if (hecha(a.id); as r) {
              <p class="chico suave" style="margin-top:12px">
                Entregada el {{ r.completada_en | date:'dd/MM/yyyy' }}
              </p>
            }
          </div>
        }
      </div>
    }
  `,
})
export class ActividadesComponent {
  private datos = inject(DatosService);
  protected perfil = inject(PerfilStore);

  actividades = signal<Actividad[]>([]);
  private resultados = signal<Resultado[]>([]);
  /** El candado de cada laboratorio, por código. Las demás actividades no tienen. */
  private candados = signal<Map<string, EstadoLaboratorio>>(new Map());
  cargando = signal(true);

  private porActividad = computed(() => {
    const mapa = new Map<string, Resultado>();
    for (const r of this.resultados()) mapa.set(r.actividad_id, r);
    return mapa;
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

      const [acts, res, labs] = await Promise.all([
        this.datos.actividades(ramo),
        this.datos.resultados(ramo.matricula_id),
        this.datos.estadoLaboratorios(ramo.matricula_id),
      ]);
      this.actividades.set(acts);
      this.candados.set(new Map(labs.map(l => [l.codigo, l])));
      this.resultados.set(res);
    } finally {
      this.cargando.set(false);
    }
  }

  hecha(actividadId: string): Resultado | undefined {
    return this.porActividad().get(actividadId);
  }

  /** El código que hay que entregar antes, o `null` si está abierto. */
  falta(a: Actividad): string | null {
    return this.candados().get(a.codigo)?.falta ?? null;
  }

  /** El alternativo que ya entregó y que por eso cierra a éste. */
  cerradoPor(a: Actividad): string | null {
    return this.candados().get(a.codigo)?.cerrado_por ?? null;
  }

  /** Con quién es alternativa, esté cerrado o no. Sirve para avisar antes de elegir. */
  alternativaDe(a: Actividad): string | null {
    return this.candados().get(a.codigo)?.excluye ?? null;
  }

  esOpcional(a: Actividad): boolean {
    return this.candados().get(a.codigo)?.opcional === true;
  }

  /**
   * Si hacerla ahora paga. Se calcula con las dos fechas que ya trae la actividad
   * y no con el `en_plazo` de `mis_laboratorios`, porque así también sirve para el
   * diagnóstico y las entregas, que no pasan por ahí.
   */
  enPlazo(a: Actividad): boolean {
    return plazoVigente(a.puntua_desde, a.puntua_hasta);
  }

  /** El plazo en palabras, o `null` si no tiene. */
  leyendaPlazo(a: Actividad): string | null {
    if (!a.puntua_desde && !a.puntua_hasta) return null;
    const f = (iso: string) =>
      new Date(iso).toLocaleString('es-CL', { weekday: 'short', day: '2-digit', month: '2-digit',
                                              hour: '2-digit', minute: '2-digit' });
    const ahora = Date.now();

    if (a.puntua_desde && ahora < new Date(a.puntua_desde).getTime()) {
      return `Empieza a dar puntos el ${f(a.puntua_desde)}.`;
    }
    if (a.puntua_hasta && ahora > new Date(a.puntua_hasta).getTime()) {
      return `El plazo terminó el ${f(a.puntua_hasta)}. Puedes hacerla igual, ` +
             'pero ya no da puntos.';
    }
    return a.puntua_hasta ? `Da puntos hasta el ${f(a.puntua_hasta)}.` : null;
  }

  etiquetaTipo(tipo: string): string {
    return tipo === 'diagnostico' ? 'Diagnóstico'
         : tipo === 'laboratorio' ? 'Laboratorio'
         : 'Entrega';
  }

  ruta(a: Actividad): string {
    // Se enruta por tipo, no por código: el código solo es único dentro de una
    // asignatura y un periodo, así que cada ramo tiene el suyo.
    return a.tipo === 'diagnostico' ? '/diagnostico'
         : a.tipo === 'laboratorio' ? `/laboratorio/${a.codigo}`
         : '/actividades';
  }
}
