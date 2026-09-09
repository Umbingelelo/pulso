import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AVATAR_POR_DEFECTO, AvatarService } from './avatar.service';
import { Cosmetico, DatosService, FormaTitulo } from './datos.service';
import { PerfilStore } from './perfil.store';

@Component({
  selector: 'app-perfil',
  imports: [RouterLink],
  template: `
    <div class="encabezado">
      <h1>Mi perfil</h1>
      <p>Cómo apareces en Pulso, y las caras que te has ganado.</p>
    </div>

    <div class="rejilla dos" style="margin-bottom:20px">
      <div class="tarjeta">
        <h2>Cómo te ven</h2>
        <div style="display:flex;align-items:flex-start;gap:18px;margin-top:16px">
          <!-- La cara y el título son una sola pieza: el título va debajo, que es
               donde el alumno lo mira, y no compitiendo con el nombre. -->
          <div class="cara-con-titulo">
            <img class="avatar-grande" [src]="vistaPrevia()" alt="Avatar elegido">
            @if (perfil.ramo()?.titulo; as t) {
              <p class="chico titulo-cara">«{{ t }}»</p>
            }
          </div>
          <div style="min-width:0">
            <p style="font-weight:600">{{ perfil.perfil()?.nombre }}</p>
            @if (perfil.ramo(); as r) {
              <p class="chico suave">{{ r.asignatura }}</p>
              <p class="chico suave">Sección {{ r.seccion }} · {{ r.periodo }}</p>
            }
          </div>
        </div>

        <!-- La pregunta es sobre **los títulos y no sobre la persona**: no se le pide su
             género ni se infiere del nombre, que en un curso es misgendering garantizado
             y además un dato que la app no necesita para nada más. El ejemplo en vivo es
             lo que hace la opción evidente sin tener que explicarla. -->
        <div class="forma-titulo">
          <p class="etiqueta">Cómo se escriben tus títulos</p>
          <div class="botones-forma">
            @for (f of formas; track f.id) {
              <button type="button" class="boton chico"
                      [class.contorno]="forma() !== f.id"
                      [disabled]="guardandoForma()"
                      (click)="cambiarForma(f.id)">{{ f.nombre }}</button>
            }
          </div>
          @if (ejemplo(); as e) {
            <p class="chico suave">Así se te vería: «{{ e }}»</p>
          }
          <p class="chico suave">
            Es solo cómo se escribe el texto. No cambia lo que ganaste ni lo que puedes ganar.
          </p>
        </div>
      </div>

      <div class="tarjeta">
        <h2>Mis ramos</h2>
        @if (perfil.ramos().length === 0) {
          <p class="suave chico" style="margin-top:12px">Todavía no estás matriculado en ninguno.</p>
        } @else {
          <table style="margin-top:12px">
            <tr><th>Asignatura</th><th>Sección</th><th>Periodo</th><th class="der">Puntos</th></tr>
            @for (r of perfil.ramos(); track r.matricula_id) {
              <tr>
                <td>{{ r.sigla }}</td>
                <td><span class="insignia celeste">{{ r.seccion }}</span></td>
                <td class="suave chico">{{ r.periodo }}</td>
                <td class="der num" style="font-weight:600">{{ r.puntos }}</td>
              </tr>
            }
          </table>
        }
        <p class="chico suave" style="margin-top:14px">
          <a routerLink="/ramos">Agregar otro ramo</a>. Si una sección está mal, escríbele al docente.
        </p>
      </div>
    </div>

    <div class="tarjeta">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <h2>Tus caras</h2>
        <a class="boton contorno chico" routerLink="/gacha">Ir al gacha</a>
      </div>

      <p class="chico suave" style="margin-top:8px">
        La cara ya no se elige de una galería: <strong>se gana</strong>. Cada tirada del gacha puede
        traerte un personaje nuevo, y acá te pones el que quieras de los que llevas.
      </p>

      @if (cargando()) {
        <p class="suave chico" style="margin-top:14px">Cargando…</p>
      } @else if (mias().length === 0) {
        <div class="aviso dato" style="margin-top:14px">
          Todavía no te has ganado ninguna. Las tiradas se consiguen subiendo de nivel en el pase, y
          se gastan en el <a routerLink="/gacha">gacha</a>. Mientras tanto te dibujamos una por
          defecto: no la pierdes, solo se reemplaza cuando ganes la primera.
        </div>
      } @else {
        <div class="galeria-avatares" style="margin-top:18px">
          @for (c of mias(); track c.id) {
            <button type="button" class="opcion-avatar" [class.elegido]="c.equipado"
                    [disabled]="poniendo() === c.id" (click)="ponerse(c)"
                    [attr.aria-label]="c.nombre + (c.descripcion ? ' de ' + c.descripcion : '')"
                    [title]="c.nombre + (c.descripcion ? ' · ' + c.descripcion : '')">
              <img [src]="c.valor" alt="" loading="lazy">
            </button>
          }
        </div>
      }

      @if (mensaje()) { <span class="insignia verde" style="margin-top:16px;display:inline-block">{{ mensaje() }}</span> }
      @if (error()) { <div class="aviso malo" style="margin-top:14px">{{ error() }}</div> }
    </div>
  `,
  styles: [`
    .forma-titulo{ margin-top:18px; padding-top:16px; border-top:1px solid var(--borde); }
    .forma-titulo .botones-forma{ display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
    .forma-titulo p.chico{ margin:8px 0 0; }
  `],
})
export class PerfilComponent {
  protected perfil = inject(PerfilStore);
  private datos = inject(DatosService);
  private avatares = inject(AvatarService);

  /**
   * Las caras que se ganó, no un catálogo.
   *
   * Antes acá había una galería de DiceBear con un botón «mostrar otros»: se
   * elegía un dibujo cualquiera y listo. Ahora la cara se gana en el gacha, así
   * que esta pantalla solo muestra lo que ya tiene y sirve para ponerse una.
   *
   * La puerta de atrás también está cerrada: `perfiles.avatar` dejó de tener grant
   * de escritura para `pulso_app`, así que ni reconstruyendo la llamada a mano se
   * puede poner una cara que no se haya ganado.
   */
  mias = signal<Cosmetico[]>([]);
  cargando = signal(true);
  poniendo = signal('');
  mensaje = signal('');
  error = signal('');

  actual = computed(() => this.perfil.perfil()?.avatar ?? AVATAR_POR_DEFECTO);
  vistaPrevia = computed(() => this.avatares.imagen(this.actual(), 152));

  protected readonly formas: { id: FormaTitulo; nombre: string }[] = [
    { id: 'masculino', nombre: 'En masculino' },
    { id: 'femenino', nombre: 'En femenino' },
  ];

  guardandoForma = signal(false);
  forma = computed<FormaTitulo>(() => this.perfil.perfil()?.forma_titulo ?? 'masculino');

  /**
   * Un título de ejemplo, para que la opción no sea abstracta.
   *
   * Sale del que lleva puesto —que ya viene resuelto de la base, así que cambia solo al
   * apretar— y si no lleva ninguno, de alguno de los que tiene. Sin caso concreto nadie
   * sabe qué está eligiendo: «en femenino» no dice nada, «La Elegida del Algoritmo» sí.
   */
  private algunTitulo = signal<Cosmetico | null>(null);
  ejemplo = computed(() => this.perfil.ramo()?.titulo ?? this.algunTitulo()?.valor ?? null);

  constructor() {
    this.perfil.cargar().then(() => this.cargar());
  }

  private async cargar(): Promise<void> {
    const ramo = this.perfil.ramo();
    if (!ramo) { this.cargando.set(false); return; }
    this.cargando.set(true);
    try {
      const todos = await this.datos.misCosmeticos(ramo.matricula_id);
      this.mias.set(todos.filter(c => c.tipo === 'avatar' && c.tengo));
      // Para el ejemplo: primero uno que tenga, y si no tiene ninguno, cualquiera del
      // pozo. Da igual cuál sea: lo que importa es que se lea la diferencia.
      this.algunTitulo.set(
        todos.find(c => c.tipo === 'titulo' && c.tengo)
        ?? todos.find(c => c.tipo === 'titulo')
        ?? null);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudieron cargar tus caras.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cambiarForma(f: FormaTitulo): Promise<void> {
    if (this.guardandoForma() || this.forma() === f) return;
    this.guardandoForma.set(true);
    this.mensaje.set(''); this.error.set('');
    try {
      await this.datos.cambiarFormaTitulo(f);
      // El texto viene ya resuelto de la base, así que hay que recargar: el perfil para
      // que el encabezado cambie, y la colección para que el ejemplo cambie con él.
      await this.perfil.cargar(true);
      await this.cargar();
      this.mensaje.set(f === 'femenino'
        ? 'Tus títulos se escribirán en femenino'
        : 'Tus títulos se escribirán en masculino');
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cambiar.');
    } finally {
      this.guardandoForma.set(false);
    }
  }

  async ponerse(c: Cosmetico): Promise<void> {
    const ramo = this.perfil.ramo();
    if (!ramo || this.poniendo() || c.equipado) return;
    this.poniendo.set(c.id);
    this.mensaje.set(''); this.error.set('');
    try {
      await this.datos.equiparCosmetico(ramo.matricula_id, c.id);
      await this.perfil.cargar(true);
      await this.cargar();
      this.mensaje.set(`Ahora apareces como ${c.nombre}`);
      setTimeout(() => this.mensaje.set(''), 2600);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo poner esa cara.');
    } finally {
      this.poniendo.set('');
    }
  }
}
