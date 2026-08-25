import { Injectable, computed, inject, signal } from '@angular/core';
import { DatosService, RamoDocente, SeccionDocente } from './datos.service';

const CLAVE = 'pulso.ramo.docente';
const CLAVE_SECCION = 'pulso.seccion.docente';

/**
 * Qué está mirando el docente: **el ramo y la sección**.
 *
 * Vive aparte de los componentes porque el panel son cuatro pantallas —resumen,
 * clases, actividades, alumnos— y todas hablan del mismo curso. Si cada una
 * guardara su propia elección, cambiar de asignatura en una y volver a otra
 * mostraría el curso equivocado, que es la clase de error que nadie reporta y
 * todos sufren.
 *
 * ── Y eso es exactamente lo que estaba pasando ──
 *
 * Este store existía y decía esto mismo, pero **«Resumen» no lo usaba**: tenía su
 * propio `ramoId` y su propio selector dentro de la página. Así que había dos
 * selectores compitiendo: el de la barra lateral movía Alumnos, Clases y
 * Actividades, y el de Resumen no movía nada más que a sí mismo.
 *
 * Peor: ninguna pantalla **reaccionaba**. Leían el ramo una vez al construirse y
 * no volvían a mirar, así que cambiar el selector de la barra dejaba la tabla con
 * los datos del ramo anterior hasta que uno navegaba a otra pantalla y volvía. Con
 * 71 alumnos en un ramo y 23 en el otro, eso se ve exactamente como «no me salen
 * todos los alumnos» — y no hay ningún error que lo delate.
 *
 * La regla que queda: **el selector es uno y vive en la barra; las pantallas
 * reaccionan con un `effect`**. Ninguna vuelve a leer el ramo en su constructor.
 *
 * ── Por qué la sección también va acá ──
 *
 * Administrar un curso es administrar **una sección**: la nómina, los puntos, quién
 * falta. Antes la sección era un filtro local de la pantalla de Alumnos, que se
 * reiniciaba en cada recarga y no existía en las otras tres. Puesta acá, se elige
 * una vez y todo el panel queda acotado a ella.
 *
 * `seccionId` vacío significa **todas**, que es un estado legítimo y el que
 * conviene para comparar secciones entre sí.
 *
 * Las dos elecciones se recuerdan entre sesiones: un docente entra a lo mismo casi
 * siempre, y volver a elegirlo cada vez es una molestia diaria.
 */
@Injectable({ providedIn: 'root' })
export class DocenteStore {
  private datos = inject(DatosService);

  ramos = signal<RamoDocente[]>([]);
  ramoId = signal<string>(localStorage.getItem(CLAVE) ?? '');
  /** Las secciones del ramo elegido, con su cuenta de matriculados. */
  secciones = signal<SeccionDocente[]>([]);
  /** El id de la sección elegida, o '' para todas. */
  seccionId = signal<string>(localStorage.getItem(CLAVE_SECCION) ?? '');
  cargando = signal(false);
  private resuelto = false;
  private enCurso: Promise<void> | null = null;

  ramo = computed(() =>
    this.ramos().find(r => this.clave(r) === this.ramoId()) ?? this.ramos()[0] ?? null);

  /** La sección elegida, o null si está en «todas» —o si la guardada ya no existe—. */
  seccion = computed(() =>
    this.secciones().find(s => s.id === this.seccionId()) ?? null);

  /**
   * Cómo rotular lo que se está mirando. Lo usan los encabezados de las cuatro
   * pantallas para que nunca haya duda de sobre qué curso se está operando: la
   * queja de fondo era no saber qué se estaba administrando.
   */
  rotulo = computed(() => {
    const r = this.ramo();
    if (!r) return '';
    const s = this.seccion();
    return `${r.sigla} · ${s ? `sección ${s.codigo}` : 'todas las secciones'} · ${r.periodo}`;
  });

  clave(r: RamoDocente): string {
    return `${r.asignatura_id}|${r.periodo_id}`;
  }

  async cargar(forzar = false): Promise<void> {
    if (this.resuelto && !forzar) return;
    if (this.enCurso && !forzar) return this.enCurso;
    this.cargando.set(true);
    this.enCurso = (async () => {
      try {
        const ramos = await this.datos.ramosQueDicto();
        this.ramos.set(ramos);
        // Si lo guardado ya no existe —cambió de asignatura o de semestre— se cae
        // al primero en vez de dejar la pantalla en blanco.
        if (!ramos.some(r => this.clave(r) === this.ramoId()) && ramos.length) {
          this.ramoId.set(this.clave(ramos[0]));
          localStorage.setItem(CLAVE, this.ramoId());
        }
        await this.cargarSecciones();
        this.resuelto = true;
      } finally {
        this.cargando.set(false);
        this.enCurso = null;
      }
    })();
    return this.enCurso;
  }

  /**
   * Las secciones del ramo actual.
   *
   * Se piden acá y no en la pantalla que las usa por lo mismo que el selector vive
   * en la barra: son de la elección, no de la vista.
   *
   * Y al cargarlas se **valida la sección guardada**. Sin esto, quien tenía elegida
   * la 002D de Cloud Native y cambiaba a Arquitectura —que no la tiene— se quedaba
   * con un id que no calza con ninguna sección: la nómina salía vacía y la pantalla
   * no decía por qué. Es el mismo error de siempre, una elección que sobrevive al
   * cambio de contexto, y se corta cayendo a «todas».
   */
  private async cargarSecciones(): Promise<void> {
    const r = this.ramo();
    if (!r) { this.secciones.set([]); return; }
    const secciones = await this.datos.seccionesQueDicto(r.asignatura_id, r.periodo_id);
    this.secciones.set(secciones);
    if (this.seccionId() && !secciones.some(s => s.id === this.seccionId())) {
      this.elegirSeccion('');
    }
  }

  async elegir(clave: string): Promise<void> {
    if (clave === this.ramoId()) return;
    this.ramoId.set(clave);
    localStorage.setItem(CLAVE, clave);
    // El ramo cambió, así que la sección de antes es de otro curso. Se limpia antes
    // de pedir las nuevas para que ninguna pantalla alcance a filtrar por una
    // sección ajena mientras llega la respuesta.
    this.elegirSeccion('');
    await this.cargarSecciones();
  }

  elegirSeccion(id: string): void {
    this.seccionId.set(id);
    localStorage.setItem(CLAVE_SECCION, id);
  }

  /** Vuelve a pedir las secciones. Lo llama quien mueve a alguien de sección. */
  async refrescarSecciones(): Promise<void> {
    await this.cargarSecciones();
  }
}
