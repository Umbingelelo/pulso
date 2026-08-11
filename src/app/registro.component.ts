import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Asignatura, DatosService, Periodo, Seccion } from './datos.service';

@Component({
  selector: 'app-registro',
  imports: [FormsModule, RouterLink],
  template: `
   <div class="acceso"><div class="caja">
    <img class="lockup" src="pulso-lockup.png" alt="Pulso">
    <div class="tarjeta">
      <h1>Crear mi cuenta</h1>
      <p class="suave chico" style="margin-top:4px">
        Regístrate con tu correo institucional. Al terminar recibes tus primeros puntos.
      </p>

      @if (enviado()) {
        <div class="aviso ok" style="margin:20px 0">
          <strong>Cuenta creada.</strong> Revisa tu correo para confirmarla y después inicia sesión.
        </div>
        <a routerLink="/ingresar" class="boton">Ir a iniciar sesión</a>
      } @else {
        <p class="suave chico" style="margin-top:14px">
          Si cursas más de una asignatura conmigo, empieza por una: las demás las agregas
          después desde <em>Mis ramos</em>, con la misma cuenta.
        </p>
        <form (ngSubmit)="registrar()" style="margin-top:22px">
          <label>
            <span class="etiqueta">Nombre completo</span>
            <input name="nombre" [(ngModel)]="nombre" required minlength="3"
                   autocomplete="name" placeholder="Nombre y apellido">
          </label>

          <label>
            <span class="etiqueta">Correo institucional</span>
            <input name="correo" type="email" [(ngModel)]="correo" required
                   autocomplete="email" placeholder="nombre@duocuc.cl">
          </label>

          <label>
            <span class="etiqueta">Contraseña</span>
            <input name="clave" type="password" [(ngModel)]="clave" required minlength="8"
                   autocomplete="new-password" placeholder="Mínimo 8 caracteres">
          </label>

          <!-- El periodo solo se pregunta si hay más de uno abierto. Hoy es uno
               solo, así que el alumno no ve este campo. -->
          @if (periodos().length > 1) {
            <label>
              <span class="etiqueta">Periodo</span>
              <select name="periodo" [ngModel]="periodoId()"
                      (ngModelChange)="cambiarPeriodo($event)" required>
                @for (p of periodos(); track p.id) {
                  <option [value]="p.id">{{ p.nombre }}</option>
                }
              </select>
            </label>
          }

          <label>
            <span class="etiqueta">Asignatura</span>
            <select name="asignatura" [ngModel]="asignaturaId()"
                    (ngModelChange)="cambiarAsignatura($event)" required>
              <option value="" disabled>Selecciona una</option>
              @for (a of asignaturas(); track a.id) {
                <option [value]="a.id">{{ a.sigla }} · {{ a.nombre }}</option>
              }
            </select>
          </label>

          <label>
            <span class="etiqueta">Sección</span>
            <select name="seccion" [(ngModel)]="seccionId" required
                    [disabled]="!asignaturaId() || secciones().length === 0">
              <option value="" disabled>
                {{ asignaturaId() ? 'Selecciona una' : 'Elige primero la asignatura' }}
              </option>
              @for (s of secciones(); track s.id) {
                <option [value]="s.id">{{ s.codigo }}</option>
              }
            </select>
          </label>

          @if (error()) {
            <div class="aviso malo">{{ error() }}</div>
          }

          <button class="boton" type="submit" [disabled]="cargando() || !completo()">
            {{ cargando() ? 'Creando…' : 'Crear mi cuenta' }}
          </button>
        </form>

        <p class="suave chico">
          ¿Ya tienes cuenta? <a routerLink="/ingresar">Inicia sesión</a>
        </p>
      }
    </div>
   </div></div>
  `,
})
export class RegistroComponent {
  private datos = inject(DatosService);
  private router = inject(Router);

  nombre = '';
  correo = '';
  clave = '';
  seccionId = '';

  periodos = signal<Periodo[]>([]);
  periodoId = signal('');
  asignaturaId = signal('');
  asignaturas = signal<Asignatura[]>([]);
  secciones = signal<Seccion[]>([]);
  cargando = signal(false);
  enviado = signal(false);
  error = signal('');

  constructor() {
    this.cargarCatalogo();
  }

  private async cargarCatalogo(): Promise<void> {
    try {
      const periodos = await this.datos.periodos();
      this.periodos.set(periodos);
      if (periodos.length) await this.cambiarPeriodo(periodos[0].id);
      else this.error.set('No hay periodos abiertos a matrícula.');
    } catch {
      this.error.set('No se pudo cargar la lista de asignaturas.');
    }
  }

  async cambiarPeriodo(id: string): Promise<void> {
    this.periodoId.set(id);
    this.asignaturaId.set('');
    this.seccionId = '';
    this.secciones.set([]);
    this.asignaturas.set(id ? await this.datos.asignaturasDe(id) : []);
  }

  completo(): boolean {
    return this.nombre.trim().length >= 3 && this.correo.includes('@')
      && this.clave.length >= 8 && !!this.seccionId;
  }

  async cambiarAsignatura(id: string): Promise<void> {
    this.asignaturaId.set(id);
    this.seccionId = '';
    this.secciones.set([]);
    if (!id) return;
    try {
      this.secciones.set(await this.datos.secciones(id, this.periodoId()));
    } catch {
      this.error.set('No se pudieron cargar las secciones.');
    }
  }

  async registrar(): Promise<void> {
    if (!this.completo() || this.cargando()) return;
    this.cargando.set(true);
    this.error.set('');
    try {
      const { conSesion } = await this.datos.registrar({
        correo: this.correo.trim(),
        clave: this.clave,
        nombre: this.nombre.trim(),
        seccionId: this.seccionId,
      });
      // Con confirmación de correo desactivada la sesión queda abierta al instante.
      if (conSesion) this.router.navigate(['/inicio']);
      else this.enviado.set(true);
    } catch (e: any) {
      this.error.set(traducir(e?.message ?? 'No se pudo crear la cuenta.'));
    } finally {
      this.cargando.set(false);
    }
  }
}

/**
 * Las funciones de `/api/auth/*` ya devuelven el mensaje en español, escrito por
 * `registrar_alumno()` en la base. Esto solo queda como red por si algún día se
 * cuela un error de más abajo.
 */
function traducir(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes('duplicate') || m.includes('unique'))
    return 'Ese correo ya tiene una cuenta. Inicia sesión.';
  return mensaje;
}
