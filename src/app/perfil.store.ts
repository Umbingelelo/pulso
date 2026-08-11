import { Injectable, computed, inject, signal } from '@angular/core';
import { DatosService, Perfil, Ramo } from './datos.service';

const CLAVE_RAMO = 'pulso.ramo';

/**
 * Estado de sesión compartido: la persona, sus ramos, cuál está mirando, o su
 * condición de docente. Se resuelve una vez para que la barra lateral, los
 * guards y las páginas no pregunten por separado en cada navegación.
 *
 * El **ramo activo** es la pieza nueva: un alumno puede cursar varias asignaturas
 * a la vez, así que casi todo lo que se muestra depende de cuál tenga elegido.
 * La elección se guarda en el navegador para que sobreviva a una recarga.
 */
@Injectable({ providedIn: 'root' })
export class PerfilStore {
  private datos = inject(DatosService);

  readonly perfil = signal<Perfil | null>(null);
  readonly ramos = signal<Ramo[]>([]);
  readonly ramoId = signal<string>('');
  readonly esDocente = signal(false);
  readonly cargando = signal(false);
  readonly resuelto = signal(false);
  readonly error = signal('');

  /** El ramo que se está mirando. */
  readonly ramo = computed<Ramo | null>(
    () => this.ramos().find(r => r.matricula_id === this.ramoId()) ?? null,
  );

  /** Los del semestre abierto: son los que se ofrecen primero para cambiar. */
  readonly ramosVigentes = computed(() => this.ramos().filter(r => r.periodo_activo && r.activa));

  private enCurso: Promise<void> | null = null;

  async cargar(forzar = false): Promise<void> {
    if (this.resuelto() && !forzar) return;
    if (this.enCurso && !forzar) return this.enCurso;

    this.cargando.set(true);
    this.error.set('');

    this.enCurso = (async () => {
      try {
        const docente = await this.datos.esDocente();
        this.esDocente.set(docente);

        if (docente) {
          // Un docente no cursa: no tiene perfil de alumno ni ramos.
          this.perfil.set(null);
          this.ramos.set([]);
        } else {
          const [perfil, ramos] = await Promise.all([
            this.datos.miPerfil(),
            this.datos.misRamos(),
          ]);
          this.perfil.set(perfil);
          this.ramos.set(ramos);
          this.elegirRamoInicial(ramos);
        }

        this.resuelto.set(true);
      } catch (e: any) {
        this.error.set(e?.message ?? 'No se pudo cargar tu sesión.');
      } finally {
        this.cargando.set(false);
        this.enCurso = null;
      }
    })();

    return this.enCurso;
  }

  /** Respeta lo último que eligió; si ya no existe, toma el primer ramo vigente. */
  private elegirRamoInicial(ramos: Ramo[]): void {
    const guardado = leerGuardado();
    if (guardado && ramos.some(r => r.matricula_id === guardado)) {
      this.ramoId.set(guardado);
      return;
    }
    const preferido = ramos.find(r => r.periodo_activo && r.activa) ?? ramos[0];
    this.ramoId.set(preferido?.matricula_id ?? '');
    if (preferido) guardar(preferido.matricula_id);
  }

  elegirRamo(matriculaId: string): void {
    if (!this.ramos().some(r => r.matricula_id === matriculaId)) return;
    this.ramoId.set(matriculaId);
    guardar(matriculaId);
  }

  /** Después de matricularse en un ramo nuevo, para dejarlo elegido. */
  async recargarRamos(elegir?: string): Promise<void> {
    const ramos = await this.datos.misRamos();
    this.ramos.set(ramos);
    if (elegir && ramos.some(r => r.matricula_id === elegir)) this.elegirRamo(elegir);
    else if (!this.ramo()) this.elegirRamoInicial(ramos);
  }

  limpiar(): void {
    this.perfil.set(null);
    this.ramos.set([]);
    this.ramoId.set('');
    this.esDocente.set(false);
    this.resuelto.set(false);
    borrar();
  }

  get nombre(): string {
    return this.perfil()?.nombre ?? (this.esDocente() ? 'Docente' : '');
  }
}

// El almacenamiento del navegador puede estar bloqueado (modo privado, permisos):
// si falla, la app sigue funcionando y solo se pierde la preferencia.
function leerGuardado(): string {
  try {
    return localStorage.getItem(CLAVE_RAMO) ?? '';
  } catch {
    return '';
  }
}

function guardar(valor: string): void {
  try {
    localStorage.setItem(CLAVE_RAMO, valor);
  } catch {
    /* sin persistencia, pero la sesión funciona igual */
  }
}

function borrar(): void {
  try {
    localStorage.removeItem(CLAVE_RAMO);
  } catch {
    /* nada que hacer */
  }
}
