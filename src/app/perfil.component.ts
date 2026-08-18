import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AVATAR_POR_DEFECTO, AvatarService } from './avatar.service';
import { Cosmetico, DatosService } from './datos.service';
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
        <div style="display:flex;align-items:center;gap:18px;margin-top:16px">
          <img class="avatar-grande" [src]="vistaPrevia()" alt="Avatar elegido">
          <div>
            <p style="font-weight:600">{{ perfil.perfil()?.nombre }}</p>
            @if (perfil.ramo()?.titulo; as t) {
              <p class="chico" style="color:var(--celeste-oscuro);font-weight:600">«{{ t }}»</p>
            }
            @if (perfil.ramo(); as r) {
              <p class="chico suave">{{ r.asignatura }}</p>
              <p class="chico suave">Sección {{ r.seccion }} · {{ r.periodo }}</p>
            }
          </div>
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
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudieron cargar tus caras.');
    } finally {
      this.cargando.set(false);
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
