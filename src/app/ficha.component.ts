import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AvatarService } from './avatar.service';
import { DatosService, Ficha } from './datos.service';
import { PerfilStore } from './perfil.store';

/**
 * La ficha del alumno en un ramo.
 *
 * Es una sola pantalla para los dos: el docente llega desde la nómina con el id
 * de la matrícula en la URL, el alumno entra sin id y ve la suya. Quién puede
 * ver qué lo decide `ficha_alumno()` en la base, así que cambiar el id en la
 * barra de direcciones no abre la ficha de nadie más.
 */
@Component({
  selector: 'app-ficha',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (error()) {
      <div class="tarjeta"><div class="aviso malo">{{ error() }}</div></div>
    } @else if (ficha(); as f) {
      <div class="encabezado">
        @if (f.soy_docente) {
          <p class="chico"><a routerLink="/curso">← Volver a la nómina</a></p>
        }
        <h1>{{ f.perfil.nombre }}</h1>
        <p>{{ f.ramo.asignatura }} · Sección {{ f.ramo.seccion }} · {{ f.ramo.periodo_nombre }}</p>
      </div>

      <!-- ============ Cabecera ============ -->
      <div class="tarjeta" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
          <img class="avatar-grande" [src]="avatar()" alt="">
          <div style="flex:1;min-width:220px">
            <p style="font-weight:600;font-size:18px">{{ f.perfil.nombre }}</p>
            <p class="chico suave">Se matriculó el {{ f.ramo.creado_en | date:'dd/MM/yyyy' }}</p>
            @if (!f.ramo.activa) {
              <span class="insignia roja" style="margin-top:6px">Dado de baja</span>
            }
            @if (f.otros_ramos.length) {
              <p class="chico suave" style="margin-top:8px">
                También cursa:
                @for (r of f.otros_ramos; track r.matricula_id) {
                  <a [routerLink]="['/ficha', r.matricula_id]">{{ r.sigla }} · {{ r.periodo }}</a>{{ $last ? '' : ' · ' }}
                }
              </p>
            }
          </div>
          <div style="display:flex;gap:26px;flex-wrap:wrap">
            <div>
              <p class="etiqueta">Saldo</p>
              <p class="cifra destacada">{{ f.saldo }}</p>
            </div>
            <div>
              <p class="etiqueta">Ganados</p>
              <p class="cifra" style="color:var(--verde)">+{{ f.ganados }}</p>
            </div>
            <div>
              <p class="etiqueta">Canjeados</p>
              <p class="cifra" style="color:var(--texto-suave)">{{ f.gastados }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="rejilla dos" style="margin-bottom:20px">
        <!-- ============ Diagnóstico ============ -->
        <div class="tarjeta">
          <h2>Diagnóstico de entrada</h2>
          @if (!f.diagnostico) {
            <div class="aviso dato" style="margin-top:14px">
              Este ramo todavía no tiene diagnóstico publicado.
            </div>
          } @else if (!f.diagnostico.rendido) {
            <div class="aviso dato" style="margin-top:14px">
              Todavía no lo rinde.
            </div>
          } @else {
            <table style="margin-top:14px">
              <tr><th>Sección</th><th class="der">Aciertos</th><th></th></tr>
              @for (s of f.diagnostico.secciones; track s.codigo) {
                <tr>
                  <td>
                    {{ s.codigo }} · {{ s.titulo }}
                    @if (s.critica) { <span class="insignia celeste">clave</span> }
                  </td>
                  <td class="der num" style="font-weight:600">
                    {{ s.puntaje }} <span class="suave">de {{ s.maximo }}</span>
                  </td>
                  <td>
                    @if (s.puntaje < s.umbral) {
                      <span class="insignia roja">Bajo el umbral</span>
                    } @else {
                      <span class="insignia verde">Al día</span>
                    }
                  </td>
                </tr>
              }
            </table>
            <p class="chico suave" style="margin-top:12px">
              {{ bajoUmbral() }} de {{ f.diagnostico.secciones.length }} secciones bajo el umbral.
            </p>
          }
        </div>

        <!-- ============ Actividades ============ -->
        <div class="tarjeta">
          <h2>Actividades</h2>
          @if (f.actividades.length === 0) {
            <div class="aviso dato" style="margin-top:14px">
              Todavía no hay actividades publicadas en este ramo.
            </div>
          } @else {
            <table style="margin-top:14px">
              <tr><th>Actividad</th><th class="der">Puntos</th><th class="der">Estado</th></tr>
              @for (a of f.actividades; track a.id) {
                <tr>
                  <td>{{ a.titulo }}<div class="chico suave">{{ etiquetaTipo(a.tipo) }}</div></td>
                  <td class="der num">{{ a.puntos }}</td>
                  <td class="der">
                    @if (a.completada_en) {
                      <span class="insignia verde">{{ a.completada_en | date:'dd/MM' }}</span>
                    } @else {
                      <span class="insignia amarilla">Pendiente</span>
                    }
                  </td>
                </tr>
              }
            </table>
            <p class="chico suave" style="margin-top:12px">
              {{ hechas() }} de {{ f.actividades.length }} completadas.
            </p>
          }
        </div>
      </div>

      <!-- ============ Canjes ============ -->
      <div class="tarjeta" style="margin-bottom:20px">
        <h2>Canjes</h2>
        @if (f.canjes.length === 0) {
          <p class="suave chico" style="margin-top:12px">Todavía no ha canjeado nada.</p>
        } @else {
          <table style="margin-top:14px">
            <tr><th>Artículo</th><th>Estado</th><th class="der">Puntos</th><th class="der">Fecha</th></tr>
            @for (c of f.canjes; track c.id) {
              <tr>
                <td>
                  {{ c.icono }} {{ c.articulo }}
                  @if (c.nota_alumno) { <div class="chico suave">«{{ c.nota_alumno }}»</div> }
                </td>
                <td><span class="insignia" [class]="claseEstado(c.estado)">{{ c.estado }}</span></td>
                <td class="der num">{{ c.precio_pagado }}</td>
                <td class="der num suave chico">{{ c.creado_en | date:'dd/MM/yyyy' }}</td>
              </tr>
            }
          </table>
        }
      </div>

      <!-- ============ Historial de puntos ============ -->
      <div class="tarjeta" style="margin-bottom:20px">
        <h2>Historial de puntos</h2>
        @if (f.movimientos.length === 0) {
          <p class="suave chico" style="margin-top:12px">Sin movimientos.</p>
        } @else {
          <table style="margin-top:14px">
            <tr><th>Motivo</th><th class="der">Puntos</th><th class="der">Fecha</th></tr>
            @for (m of f.movimientos; track m.id) {
              <tr>
                <td>{{ m.motivo }}</td>
                <td class="der num" [class.mas]="m.puntos > 0" [class.menos]="m.puntos < 0">
                  {{ m.puntos > 0 ? '+' : '' }}{{ m.puntos }}
                </td>
                <td class="der num suave chico">{{ m.creado_en | date:'dd/MM/yyyy HH:mm' }}</td>
              </tr>
            }
          </table>
        }
      </div>

      <!-- ============ Otorgar puntos, solo el docente ============ -->
      @if (f.soy_docente) {
        <div class="tarjeta">
          <h2>Otorgar o descontar puntos</h2>
          <p class="chico suave" style="margin-top:4px">
            Usa un número negativo para descontar. Todo movimiento queda registrado con su motivo.
          </p>
          <form (ngSubmit)="otorgar()" style="margin-top:16px">
            <div class="rejilla dos">
              <label>
                <span class="etiqueta">Puntos</span>
                <input type="number" name="puntos" [(ngModel)]="puntos" required>
              </label>
              <label>
                <span class="etiqueta">Motivo</span>
                <input name="motivo" [(ngModel)]="motivo" required placeholder="Laboratorio 3 aprobado">
              </label>
            </div>
            @if (errorPuntos()) { <div class="aviso malo">{{ errorPuntos() }}</div> }
            @if (hecho()) { <div class="aviso ok">{{ hecho() }}</div> }
            <button class="boton" type="submit" [disabled]="guardando() || !motivo.trim() || !puntos">
              {{ guardando() ? 'Registrando…' : 'Registrar movimiento' }}
            </button>
          </form>
        </div>
      }
    }
  `,
})
export class FichaComponent {
  private datos = inject(DatosService);
  private avatares = inject(AvatarService);
  private ruta = inject(ActivatedRoute);
  protected perfil = inject(PerfilStore);

  ficha = signal<Ficha | null>(null);
  cargando = signal(true);
  error = signal('');

  puntos: number | null = null;
  motivo = '';
  guardando = signal(false);
  errorPuntos = signal('');
  hecho = signal('');

  private idRuta = signal<string>('');

  avatar = computed(() => this.avatares.imagen(this.ficha()?.perfil?.avatar ?? 'thumbs:inicial', 152));
  hechas = computed(() => this.ficha()?.actividades.filter(a => a.completada_en).length ?? 0);
  bajoUmbral = computed(() =>
    this.ficha()?.diagnostico?.secciones.filter(s => s.puntaje < s.umbral).length ?? 0
  );

  constructor() {
    this.ruta.paramMap.subscribe(p => this.idRuta.set(p.get('matriculaId') ?? ''));

    effect(() => {
      // Sin id en la URL es «mi ficha»: la del ramo que tengo elegido.
      const id = this.idRuta() || this.perfil.ramo()?.matricula_id;
      if (id) this.cargar(id);
    });

    this.perfil.cargar();
  }

  private async cargar(matriculaId: string): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      const f = await this.datos.ficha(matriculaId);
      if (!f) { this.error.set('No se encontró esa ficha.'); return; }
      this.ficha.set(f);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar la ficha.');
    } finally {
      this.cargando.set(false);
    }
  }

  etiquetaTipo(tipo: string): string {
    return tipo === 'diagnostico' ? 'Diagnóstico'
         : tipo === 'laboratorio' ? 'Laboratorio'
         : 'Entrega';
  }

  claseEstado(e: string): string {
    return e === 'entregado' ? 'verde'
         : e === 'aprobado' ? 'celeste'
         : e === 'solicitado' ? 'amarilla'
         : 'roja';
  }

  async otorgar(): Promise<void> {
    const f = this.ficha();
    if (!f || !this.puntos || !this.motivo.trim()) return;
    this.guardando.set(true);
    this.errorPuntos.set('');
    this.hecho.set('');
    try {
      await this.datos.otorgarPuntos(f.ramo.matricula_id, this.puntos, this.motivo.trim());
      this.hecho.set(`${this.puntos > 0 ? '+' : ''}${this.puntos} puntos para ${f.perfil.nombre}`);
      this.puntos = null;
      this.motivo = '';
      await this.cargar(f.ramo.matricula_id);
    } catch (e: any) {
      this.errorPuntos.set(e?.message ?? 'No se pudo registrar el movimiento.');
    } finally {
      this.guardando.set(false);
    }
  }
}
