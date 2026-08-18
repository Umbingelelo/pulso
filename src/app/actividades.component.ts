import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Actividad, DatosService, EstadoLaboratorio, Resultado } from './datos.service';
import { PerfilStore } from './perfil.store';

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
              } @else if (esOpcional(a)) {
                <span class="insignia celeste">Opcional</span>
              } @else {
                <span class="insignia amarilla">Pendiente</span>
              }
            </div>

            @if (a.descripcion) {
              <p class="chico suave" style="margin-top:10px">{{ a.descripcion }}</p>
            }
            @if (esOpcional(a) && !hecha(a.id)) {
              <p class="chico suave" style="margin-top:8px">
                No entra en ninguna nota. Es para quien terminó y quiere más.
              </p>
            }

            <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:18px;flex-wrap:wrap">
              <span class="insignia celeste">{{ a.puntos }} puntos</span>
              @if (hecha(a.id); as r) {
                <a class="boton contorno chico" [routerLink]="ruta(a)">Ver mi resultado</a>
              } @else if (falta(a); as req) {
                <!-- Sin enlace: ofrecer «Empezar» sobre algo cerrado es prometer
                     una puerta que no abre. El candado real está en la base; esto
                     solo evita el viaje en falso. -->
                <span class="chico suave">Termina {{ req }} para desbloquearlo</span>
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

  constructor() {
    this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      await this.perfil.cargar();
      const ramo = this.perfil.ramo();
      if (!ramo) return;

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

  esOpcional(a: Actividad): boolean {
    return this.candados().get(a.codigo)?.opcional === true;
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
