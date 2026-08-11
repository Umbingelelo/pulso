import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Articulo, Canje, Categoria, DatosService } from './datos.service';
import { PerfilStore } from './perfil.store';

const CATEGORIAS: { id: Categoria | ''; nombre: string }[] = [
  { id: '',           nombre: 'Todo' },
  { id: 'nota',       nombre: 'Nota' },
  { id: 'evaluacion', nombre: 'Evaluaciones' },
  { id: 'plazo',      nombre: 'Plazos' },
  { id: 'apoyo',      nombre: 'Apoyo' },
  { id: 'equipo',     nombre: 'Equipo' },
  { id: 'comodin',    nombre: 'Comodines' },
];

@Component({
  selector: 'app-tienda',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="encabezado">
      <h1>Tienda</h1>
      <p>
        Canjea los puntos que llevas en {{ perfil.ramo()?.sigla ?? 'este ramo' }}.
        Cada ramo tiene su propia vitrina y su propio saldo.
      </p>
    </div>

    <div class="rejilla tres" style="margin-bottom:20px">
      <div class="tarjeta">
        <p class="etiqueta">Tu saldo</p>
        <p class="cifra destacada">{{ saldo() }}</p>
      </div>
      <div class="tarjeta">
        <p class="etiqueta">Canjes activos</p>
        <p class="cifra">{{ activos().length }}</p>
        <p class="chico suave">{{ pendientes().length }} esperando respuesta</p>
      </div>
      <div class="tarjeta">
        <p class="etiqueta">Artículos con precio</p>
        <p class="cifra">{{ conPrecio().length }}<span class="suave" style="font-size:20px">/{{ articulos().length }}</span></p>
        <p class="chico suave">Los demás todavía no salen a la venta</p>
      </div>
    </div>

    @if (aviso()) { <div class="aviso ok" style="margin-bottom:20px">{{ aviso() }}</div> }
    @if (error()) { <div class="aviso malo" style="margin-bottom:20px">{{ error() }}</div> }

    <!-- ============ Vitrina ============ -->
    <div class="tarjeta" style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <h2>Qué puedes pedir</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          @for (c of categorias; track c.id) {
            <button class="boton chico" [class.contorno]="filtro() !== c.id"
                    (click)="filtro.set(c.id)">{{ c.nombre }}</button>
          }
        </div>
      </div>

      @if (cargando()) {
        <p class="suave chico" style="margin-top:14px">Cargando…</p>
      } @else if (visibles().length === 0) {
        <div class="aviso dato" style="margin-top:14px">
          No hay artículos en esta categoría.
        </div>
      } @else {
        <div class="vitrina" style="margin-top:18px">
          @for (a of visibles(); track a.id) {
            <div class="articulo" [class.agotado]="!disponible(a)">
              <div class="cabeza">
                <span class="icono">{{ a.icono || '🎁' }}</span>
                @if (a.precio === null) {
                  <span class="insignia">Próximamente</span>
                } @else {
                  <span class="precio">{{ a.precio }}<span class="pt">pts</span></span>
                }
              </div>

              <h3>{{ a.nombre }}</h3>
              <p class="chico suave">{{ a.descripcion }}</p>

              @if (a.detalle) {
                <p class="letra-chica">{{ a.detalle }}</p>
              }

              <div class="pie-articulo">
                @if (a.requiere_aprobacion) {
                  <span class="insignia amarilla">Necesita visto bueno</span>
                } @else {
                  <span class="insignia verde">Al instante</span>
                }
                @if (a.limite_por_alumno !== null) {
                  <span class="insignia">{{ a.ya_canjeados }} de {{ a.limite_por_alumno }}</span>
                }
              </div>

              @if (eligiendo() === a.id) {
                <form (ngSubmit)="confirmar(a)" style="margin-top:14px">
                  <label>
                    <span class="etiqueta">¿Para qué lo quieres? (opcional)</span>
                    <input name="nota" [(ngModel)]="nota" placeholder="Ej: para la EP2">
                  </label>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
                    <button class="boton chico" type="submit" [disabled]="guardando()">
                      {{ guardando() ? 'Canjeando…' : 'Confirmar canje' }}
                    </button>
                    <button class="boton contorno chico" type="button" (click)="eligiendo.set('')">
                      Cancelar
                    </button>
                  </div>
                </form>
              } @else {
                <button class="boton chico" style="margin-top:14px"
                        [disabled]="!disponible(a)" (click)="elegir(a)">
                  {{ motivoBoton(a) }}
                </button>
              }
            </div>
          }
        </div>
      }
    </div>

    <!-- ============ Mis canjes ============ -->
    <div class="tarjeta">
      <h2>Mis canjes</h2>
      @if (canjes().length === 0) {
        <div class="aviso dato" style="margin-top:14px">
          Todavía no has canjeado nada. Los puntos se guardan solos, no vencen dentro del semestre.
        </div>
      } @else {
        <table style="margin-top:14px">
          <tr>
            <th>Artículo</th><th>Estado</th><th class="der">Puntos</th>
            <th class="der">Pedido</th><th></th>
          </tr>
          @for (c of canjes(); track c.id) {
            <tr>
              <td>
                {{ c.icono }} {{ c.articulo }}
                @if (c.nota_alumno) { <div class="chico suave">«{{ c.nota_alumno }}»</div> }
                @if (c.comentario_docente) {
                  <div class="chico" style="color:var(--texto-suave)">
                    <strong>Respuesta:</strong> {{ c.comentario_docente }}
                  </div>
                }
              </td>
              <td><span class="insignia" [class]="claseEstado(c.estado)">{{ rotulo(c.estado) }}</span></td>
              <td class="der num">{{ c.precio_pagado }}</td>
              <td class="der num suave chico">{{ c.creado_en | date:'dd/MM' }}</td>
              <td class="der">
                @if (c.estado === 'solicitado') {
                  <button class="boton contorno chico" (click)="cancelar(c)">Cancelar</button>
                }
              </td>
            </tr>
          }
        </table>
      }
    </div>
  `,
})
export class TiendaComponent {
  private datos = inject(DatosService);
  protected perfil = inject(PerfilStore);

  protected readonly categorias = CATEGORIAS;

  articulos = signal<Articulo[]>([]);
  canjes = signal<Canje[]>([]);
  filtro = signal<Categoria | ''>('');
  cargando = signal(true);

  eligiendo = signal('');
  nota = '';
  guardando = signal(false);
  aviso = signal('');
  error = signal('');

  saldo = computed(() => this.articulos()[0]?.saldo ?? this.perfil.ramo()?.puntos ?? 0);
  conPrecio = computed(() => this.articulos().filter(a => a.precio !== null));
  visibles = computed(() =>
    this.filtro() ? this.articulos().filter(a => a.categoria === this.filtro()) : this.articulos()
  );
  activos = computed(() =>
    this.canjes().filter(c => c.estado === 'solicitado' || c.estado === 'aprobado' || c.estado === 'entregado')
  );
  pendientes = computed(() => this.canjes().filter(c => c.estado === 'solicitado'));

  constructor() {
    this.perfil.cargar();
    effect(() => {
      const ramo = this.perfil.ramo();
      if (ramo) this.cargar(ramo.matricula_id);
      else this.cargando.set(false);
    });
  }

  private async cargar(matriculaId: string): Promise<void> {
    this.cargando.set(true);
    try {
      const [arts, cs] = await Promise.all([
        this.datos.vitrina(matriculaId),
        this.datos.misCanjes(matriculaId),
      ]);
      this.articulos.set(arts);
      this.canjes.set(cs);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar la tienda.');
    } finally {
      this.cargando.set(false);
    }
  }

  disponible(a: Articulo): boolean {
    if (a.precio === null) return false;
    if (a.saldo < a.precio) return false;
    if (a.limite_por_alumno !== null && a.ya_canjeados >= a.limite_por_alumno) return false;
    if (a.stock !== null && a.colocados >= a.stock) return false;
    return true;
  }

  /** El botón dice por qué no se puede, que es más útil que quedar apagado y mudo. */
  motivoBoton(a: Articulo): string {
    if (a.precio === null) return 'Todavía sin precio';
    if (a.limite_por_alumno !== null && a.ya_canjeados >= a.limite_por_alumno) return 'Ya lo usaste';
    if (a.stock !== null && a.colocados >= a.stock) return 'Agotado';
    if (a.saldo < a.precio) return `Te faltan ${a.precio - a.saldo} puntos`;
    return 'Canjear';
  }

  elegir(a: Articulo): void {
    this.eligiendo.set(a.id);
    this.nota = '';
    this.aviso.set('');
    this.error.set('');
  }

  async confirmar(a: Articulo): Promise<void> {
    const ramo = this.perfil.ramo();
    if (!ramo || this.guardando()) return;
    this.guardando.set(true);
    this.error.set('');
    try {
      await this.datos.solicitarCanje(ramo.matricula_id, a.id, this.nota);
      this.aviso.set(a.requiere_aprobacion
        ? `Pediste «${a.nombre}». Te descontamos ${a.precio} puntos y queda esperando respuesta; si te la rechazan, se devuelven solos.`
        : `Canjeaste «${a.nombre}» por ${a.precio} puntos. Ya es tuyo.`);
      this.eligiendo.set('');
      this.nota = '';
      await this.refrescar(ramo.matricula_id);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo completar el canje.');
    } finally {
      this.guardando.set(false);
    }
  }

  async cancelar(c: Canje): Promise<void> {
    this.aviso.set('');
    this.error.set('');
    try {
      await this.datos.cancelarCanje(c.id);
      this.aviso.set(`Cancelaste «${c.articulo}». Te devolvimos ${c.precio_pagado} puntos.`);
      await this.refrescar(c.matricula_id);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cancelar.');
    }
  }

  private async refrescar(matriculaId: string): Promise<void> {
    await this.cargar(matriculaId);
    await this.perfil.recargarRamos(matriculaId);
  }

  claseEstado(e: string): string {
    return e === 'entregado' ? 'verde'
         : e === 'aprobado' ? 'celeste'
         : e === 'solicitado' ? 'amarilla'
         : 'roja';
  }

  rotulo(e: string): string {
    return e === 'solicitado' ? 'Esperando respuesta'
         : e === 'aprobado' ? 'Aprobado'
         : e === 'entregado' ? 'Entregado'
         : e === 'rechazado' ? 'Rechazado'
         : 'Cancelado';
  }
}
