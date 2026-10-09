import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatosService, Mision, ResultadoMision } from './datos.service';
import { DiagramaMisionComponent } from './diagrama-mision.component';
import { PerfilStore } from './perfil.store';

/**
 * La misión del día.
 *
 * El alumno aprieta un botón y su misión se genera en ese momento, distinta a la
 * de sus compañeros. Se demora unos segundos, así que el botón lo dice: quedarse
 * mirando una pantalla quieta sin saber si pasa algo es la forma más rápida de
 * que alguien apriete cinco veces.
 *
 * El botón se rehabilita a las 23:59 de Chile, y la cuenta regresiva la calcula
 * el servidor: el reloj del computador del alumno no es fuente de verdad.
 *
 * ── Cinco mecánicas, una pantalla ──
 *
 * La misión del día ya no es siempre un quiz: puede ser alternativas, emparejar,
 * verdadero/falso, completar un diagrama o una pregunta de desarrollo. Cada una
 * tiene su bloque del `@switch` y su forma de armar la respuesta (`armarRespuesta`),
 * pero comparten todo lo demás: encabezado, insignia, aviso de resultado y el
 * cierre con la cuenta regresiva. La corrección nunca se hace acá: el navegador
 * manda lo que el alumno marcó y recibe de vuelta qué estaba bien.
 *
 * Al recargar una misión ya respondida, la pantalla se reconstruye con lo que el
 * alumno contestó (`solucion.respuesta`, que guarda la 0043) para marcar cuáles
 * estaban mal. Las misiones anteriores no lo traen y solo muestran la correcta.
 */
@Component({
  selector: 'app-misiones',
  imports: [DiagramaMisionComponent],
  template: `
    <div class="encabezado">
      <h1>Misión del día</h1>
      <p>{{ perfil.ramo()?.asignatura ?? 'Una actividad distinta cada día, solo para ti.' }}</p>
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (!mision()) {
      <!-- ============ Sin misión: el botón ============ -->
      <div class="tarjeta" style="text-align:center;padding:44px 26px">
        @if (estado()?.puede_generar) {
          <h2 style="margin-bottom:8px">Tu misión de hoy te está esperando</h2>
          <p class="suave" style="max-width:34rem;margin:0 auto 26px">
            Se arma en el momento y es distinta a la de tus compañeros. Si la
            resuelves bien, suma
            @if (estado()?.xp; as xp) { <strong>{{ xp }} de experiencia</strong>. }
            @else { experiencia para tu pase. }
          </p>
          <button class="boton" (click)="generarla()" [disabled]="generando()">
            {{ generando() ? 'Armando tu misión…' : 'Generar mi misión' }}
          </button>
          @if (generando()) {
            <p class="chico suave" style="margin-top:14px">
              Puede tardar unos segundos. No cierres la página.
            </p>
          }
        } @else {
          <h2 style="margin-bottom:8px">Ya hiciste la de hoy</h2>
          <p class="suave">Vuelve {{ cuando() }} por la siguiente.</p>
        }
        @if (error()) {
          <div class="aviso malo" style="margin-top:20px;text-align:left">{{ error() }}</div>
        }
      </div>
    } @else {
      <!-- ============ Con misión ============ -->
      <div class="tarjeta">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
          <div>
            <p class="etiqueta">{{ mision()!.nombre }}</p>
            @if (mision()!.enunciado.termino; as t) {
              <p class="chico suave" style="margin-top:2px">
                sobre <strong>{{ t }}</strong>
                @if (mision()!.enunciado.fuente; as f) { · clase {{ f }} }
              </p>
            }
          </div>
          @if (insignia(); as i) {
            <span class="insignia" [class]="'insignia ' + i.clase">{{ i.texto }}</span>
          } @else {
            <span class="insignia celeste">{{ mision()!.xp }} de experiencia</span>
          }
        </div>

        <h2 style="margin:18px 0 20px">{{ mision()!.enunciado.pregunta }}</h2>

        @switch (mision()!.mecanica) {

          @case ('emparejar') {
            <!-- Cada definición pide su término: fichas en vez de un select, para el dedo. -->
            <div class="pares">
              @for (d of mision()!.enunciado.definiciones ?? []; track $index; let j = $index) {
                <div class="par" [class.ok]="resultado() && parOk(j) === true"
                     [class.mal]="resultado() && parOk(j) === false">
                  <p class="par-def"><span class="numero">{{ j + 1 }}</span>{{ d }}</p>
                  <div class="fichas" role="group" [attr.aria-label]="'Término de la definición ' + (j + 1)">
                    @for (t of mision()!.enunciado.terminos ?? []; track $index; let k = $index) {
                      <button type="button" class="ficha"
                              [class.elegida]="!resultado() && parejas()[j] === k"
                              [class.usada]="!resultado() && parejas()[j] !== k && parejas().includes(k)"
                              [class.correcta]="resultado() && parCorrecto(j) === k"
                              [class.incorrecta]="resultado() && parejas()[j] === k && parCorrecto(j) !== k"
                              [disabled]="!!resultado()"
                              [attr.aria-pressed]="parejas()[j] === k"
                              (click)="emparejar(j, k)">{{ t }}</button>
                    }
                  </div>
                </div>
              }
            </div>
          }

          @case ('verdadero_falso') {
            <div class="afirmaciones">
              @for (a of mision()!.enunciado.afirmaciones ?? []; track $index; let i = $index) {
                <div class="afirmacion" [class.ok]="resultado() && vfOk(i) === true"
                     [class.mal]="resultado() && vfOk(i) === false">
                  <p class="afirmacion-texto">{{ a }}</p>
                  <div class="vf" role="group" [attr.aria-label]="'Afirmación ' + (i + 1)">
                    @for (v of vfOpciones; track v.valor) {
                      <button type="button" class="vf-boton"
                              [class.elegida]="!resultado() && vf()[i] === v.valor"
                              [class.correcta]="resultado() && resultado()!.solucion.respuestas?.[i] === v.valor"
                              [class.incorrecta]="resultado() && vf()[i] === v.valor && resultado()!.solucion.respuestas?.[i] !== v.valor"
                              [disabled]="!!resultado()"
                              [attr.aria-pressed]="vf()[i] === v.valor"
                              (click)="marcarVf(i, v.valor)">{{ v.texto }}</button>
                    }
                  </div>
                  @if (resultado()?.solucion?.porques?.[i]; as porque) {
                    <p class="porque">{{ porque }}</p>
                  }
                </div>
              }
            </div>
          }

          @case ('diagrama') {
            <div class="lienzo">
              <app-diagrama-mision [titulo]="mision()!.enunciado.titulo ?? ''"
                                   [nodos]="mision()!.enunciado.nodos ?? []"
                                   [flechas]="mision()!.enunciado.flechas ?? []"
                                   [relleno]="rellenoHueco()"
                                   [estado]="estadoHueco()" />
            </div>
            <div style="display:flex;flex-direction:column;gap:10px">
              @for (o of mision()!.enunciado.opciones ?? []; track $index) {
                <button type="button"
                        class="opcion-mision"
                        [class.elegida]="elegida() === $index"
                        [class.correcta]="resultado() && $index === correcta()"
                        [class.incorrecta]="resultado() && elegida() === $index && !resultado()!.acertada"
                        [disabled]="!!resultado()"
                        (click)="elegir($index)">
                  <span class="letra">{{ 'abcd'[$index] }}</span>
                  <span>{{ o }}</span>
                </button>
              }
            </div>
          }

          @case ('desarrollo') {
            <label class="sr-only" for="respuesta-desarrollo">Tu respuesta</label>
            <textarea id="respuesta-desarrollo" class="desarrollo" rows="6"
                      [attr.maxlength]="mision()!.enunciado.max_caracteres ?? 600"
                      [disabled]="!!resultado() || respondiendo()"
                      [value]="texto()"
                      (input)="texto.set($any($event.target).value)"
                      placeholder="Respóndela con tus palabras, en dos a cuatro oraciones."></textarea>
            <p class="contador" [class.falta]="!resultado() && texto().trim().length < minimo()">
              {{ texto().length }} / {{ mision()!.enunciado.max_caracteres ?? 600 }}
              @if (!resultado() && texto().trim().length < minimo()) { · escribe al menos {{ minimo() }} caracteres }
            </p>
          }

          @default {
            <div style="display:flex;flex-direction:column;gap:10px">
              @for (o of mision()!.enunciado.opciones ?? []; track $index) {
                <button type="button"
                        class="opcion-mision"
                        [class.elegida]="elegida() === $index"
                        [class.correcta]="resultado() && $index === correcta()"
                        [class.incorrecta]="resultado() && elegida() === $index && !resultado()!.acertada"
                        [disabled]="!!resultado()"
                        (click)="elegir($index)">
                  <span class="letra">{{ 'abcd'[$index] }}</span>
                  <span>{{ o }}</span>
                </button>
              }
            </div>
          }
        }

        @if (!resultado()) {
          <button class="boton" style="margin-top:22px"
                  [disabled]="!completa() || respondiendo()"
                  (click)="responder()">
            {{ respondiendo() ? (mision()!.mecanica === 'desarrollo' ? 'Leyendo tu respuesta…' : 'Corrigiendo…') : 'Responder' }}
          </button>
          @if (respondiendo() && mision()!.mecanica === 'desarrollo') {
            <p class="chico suave" style="margin-top:10px">Esto puede tardar unos segundos. No cierres la página.</p>
          } @else if (mision()!.mecanica === 'desarrollo') {
            <p class="chico suave" style="margin-top:10px">
              Un solo intento. Te corrige un modelo de IA: si «va bien encaminado» suma la mitad de la
              experiencia, y si el servicio falla puedes reenviar sin perder nada.
            </p>
          } @else {
            <p class="chico suave" style="margin-top:10px">
              Tienes un solo intento. Si te equivocas no pierdes nada, pero tampoco sumas.
            </p>
          }
        } @else {
          @if (resumen(); as r) {
            <div class="aviso" [class.ok]="r.ok" [class.dato]="!r.ok" style="margin-top:22px">
              {{ r.texto }}
            </div>
          }
          @if (resultado()!.solucion.explicacion; as porque) {
            <div class="aviso" [class.ok]="resultado()!.acertada" [class.dato]="!resultado()!.acertada"
                 style="margin-top:12px">
              {{ porque }}
            </div>
          }
          @if (mision()!.mecanica === 'desarrollo' && resultado()!.solucion.definicion) {
            <div class="pauta" style="margin-top:12px">
              <p class="etiqueta">Lo que define el docente</p>
              <p>{{ resultado()!.solucion.definicion }}</p>
              @if (resultado()!.solucion.criterios?.length) {
                <ul>
                  @for (c of resultado()!.solucion.criterios; track $index) { <li>{{ c }}</li> }
                </ul>
              }
            </div>
          }
          <p class="chico suave" style="margin-top:14px">
            Tu próxima misión se habilita {{ cuando() }}.
          </p>
        }

        @if (error()) {
          <div class="aviso malo" style="margin-top:16px">{{ error() }}</div>
        }
      </div>
    }
  `,
  styles: [`
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    /* ---------- emparejar ---------- */
    .pares, .afirmaciones { display: flex; flex-direction: column; gap: 12px; }
    .par, .afirmacion {
      border: 1.5px solid var(--borde); background: var(--blanco);
      border-radius: var(--r-chico); padding: 14px 16px;
    }
    .par.ok, .afirmacion.ok { border-color: var(--verde); background: var(--verde-suave); }
    .par.mal, .afirmacion.mal { border-color: var(--rojo); background: var(--rojo-suave); }
    .par-def { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; color: var(--texto); }
    .numero {
      flex: none; width: 26px; height: 26px; border-radius: 50%;
      display: grid; place-items: center; font-weight: 700; font-size: 13px;
      background: var(--fondo); color: var(--texto-suave);
    }
    .fichas, .vf { display: flex; flex-wrap: wrap; gap: 8px; }
    .ficha, .vf-boton {
      font: inherit; font-size: 14px; cursor: pointer; color: var(--texto);
      padding: 8px 14px; border-radius: 999px;
      border: 1.5px solid var(--borde); background: var(--blanco);
      transition: border-color .15s, background .15s;
    }
    .ficha:hover:not(:disabled), .vf-boton:hover:not(:disabled) { border-color: var(--celeste); background: var(--celeste-suave); }
    .ficha:disabled, .vf-boton:disabled { cursor: default; }
    .ficha.usada { opacity: .5; }
    .ficha.elegida, .vf-boton.elegida { border-color: var(--azul); background: var(--celeste-suave); font-weight: 600; }
    .ficha.correcta, .vf-boton.correcta { border-color: var(--verde); background: var(--verde-suave); font-weight: 600; opacity: 1; }
    .ficha.incorrecta, .vf-boton.incorrecta { border-color: var(--rojo); background: var(--rojo-suave); opacity: 1; }

    /* ---------- verdadero / falso ---------- */
    .afirmacion-texto { margin-bottom: 12px; color: var(--texto); }
    .vf-boton { min-width: 108px; }
    .porque { margin-top: 10px; font-size: 13.5px; color: var(--texto-suave); }

    /* ---------- diagrama ---------- */
    .lienzo {
      margin-bottom: 20px; padding: 18px 14px;
      border: 1.5px solid var(--borde); border-radius: var(--r-chico); background: var(--fondo);
    }

    /* ---------- desarrollo ---------- */
    .desarrollo {
      width: 100%; resize: vertical; font: inherit; line-height: 1.5; color: var(--texto);
      padding: 12px 14px; border-radius: var(--r-chico);
      border: 1.5px solid var(--borde); background: var(--blanco);
    }
    .desarrollo:focus { outline: none; border-color: var(--azul); }
    .desarrollo:disabled { background: var(--fondo); }
    .contador { margin-top: 6px; text-align: right; font-size: 12.5px; color: var(--texto-suave); }
    .contador.falta { color: var(--texto-suave); }
    .pauta {
      padding: 14px 16px; border-radius: var(--r-chico);
      border: 1.5px solid var(--borde); background: var(--fondo); font-size: 14px;
    }
    .pauta ul { margin: 8px 0 0 18px; color: var(--texto-suave); }
  `],
})
export class MisionesComponent {
  private datos = inject(DatosService);
  protected perfil = inject(PerfilStore);

  mision = signal<Mision | null>(null);
  estado = signal<any>(null);
  /** Quiz y diagrama: la alternativa marcada. */
  elegida = signal<number | null>(null);
  /** Verdadero/falso: lo marcado en cada afirmación. */
  vf = signal<('v' | 'f' | null)[]>([]);
  /** Emparejar: para cada definición, el índice del término elegido. */
  parejas = signal<(number | null)[]>([]);
  /** Desarrollo: lo que escribe. */
  texto = signal('');
  resultado = signal<ResultadoMision | null>(null);
  cargando = signal(true);
  generando = signal(false);
  respondiendo = signal(false);
  error = signal('');

  /**
   * El índice de la correcta, y **-1 cuando no se sabe**.
   *
   * `Number(undefined)` es `NaN`, y con NaN adentro toda comparación se vuelve
   * mentira: `$index !== NaN` da verdadero para las cuatro alternativas, así que
   * la que el alumno eligió se pintaba roja aunque hubiera acertado. Pasaba cada
   * vez que el resultado venía sin pauta —al releer una misión ya resuelta— y era
   * la mitad de «la marca como buena y después aparece mala».
   */
  correcta = computed(() => {
    // El `?? ''` es para que un nulo no pase por `Number` y salga 0, que pintaría
    // de verde la primera alternativa sin que nadie lo haya dicho.
    const bruto = this.resultado()?.solucion?.correcta ?? '';
    const i = Number(bruto);
    return bruto !== '' && Number.isInteger(i) ? i : -1;
  });

  protected readonly vfOpciones = [
    { valor: 'v' as const, texto: 'Verdadero' },
    { valor: 'f' as const, texto: 'Falso' },
  ];

  /** ¿Se puede enviar? Cada mecánica pide lo suyo. */
  completa = computed(() => {
    const m = this.mision();
    if (!m) return false;
    switch (m.mecanica) {
      case 'verdadero_falso': {
        const n = m.enunciado.afirmaciones?.length ?? 0;
        return n > 0 && Array.from({ length: n }).every((_, i) => this.vf()[i] != null);
      }
      case 'emparejar': {
        const n = m.enunciado.definiciones?.length ?? 0;
        return n > 0 && Array.from({ length: n }).every((_, i) => this.parejas()[i] != null);
      }
      case 'desarrollo': return this.texto().trim().length >= this.minimo();
      default: return this.elegida() !== null;
    }
  });

  minimo = computed(() => this.mision()?.enunciado.min_caracteres ?? 40);

  /** La insignia de arriba a la derecha: lo que paga, y lo que pagó. */
  insignia = computed(() => {
    const r = this.resultado();
    if (!r) return null;
    if (r.xp_ganada > 0) {
      const parcial = r.veredicto === 'parcial';
      return {
        clase: parcial ? 'amarilla' : 'verde',
        texto: `+${r.xp_ganada} de experiencia${parcial ? ' · respuesta parcial' : ''}`,
      };
    }
    return { clase: 'amarilla', texto: 'Sin puntos esta vez' };
  });

  /** Lo que se dibuja dentro del hueco del diagrama. */
  rellenoHueco = computed(() => {
    const m = this.mision();
    const r = this.resultado();
    const opciones = m?.enunciado.opciones ?? [];
    const elegida = this.elegida();
    const marcada = elegida !== null ? opciones[elegida] ?? null : null;
    if (!r) return marcada;
    // Corregido: lo que eligió si se equivocó (y se sabe), y si no, el paso real.
    const real = r.solucion.paso ?? opciones[this.correcta()] ?? null;
    return r.acertada || marcada === null ? real : marcada;
  });

  estadoHueco = computed<'pendiente' | 'elegida' | 'correcta' | 'incorrecta'>(() => {
    const r = this.resultado();
    if (!r) return this.elegida() === null ? 'pendiente' : 'elegida';
    if (r.acertada || this.elegida() === null) return 'correcta';
    return 'incorrecta';
  });

  /** El cierre de verdadero/falso y emparejar: cuántas acertó, si se sabe. */
  resumen = computed<{ ok: boolean; texto: string } | null>(() => {
    const r = this.resultado();
    const m = this.mision();
    if (!r || !m) return null;
    if (m.mecanica === 'verdadero_falso') {
      const n = r.solucion.respuestas?.length ?? 0;
      const buenas = (r.solucion.respuestas ?? []).filter((_, i) => this.vf()[i] === r.solucion.respuestas![i]).length;
      if (!n) return null;
      if (r.acertada) return { ok: true, texto: `Las ${n} bien. Se corrige todo o nada, y esta la hiciste completa.` };
      return this.vf().some((x) => x !== null)
        ? { ok: false, texto: `Acertaste ${buenas} de ${n}. Hay que tener todas bien para sumar; abajo está el porqué de cada una.` }
        : null;
    }
    if (m.mecanica === 'emparejar') {
      const n = r.solucion.pares?.length ?? 0;
      const buenas = (r.solucion.pares ?? []).filter((_, j) => this.parejas()[j] === Number(r.solucion.pares![j])).length;
      if (!n) return null;
      if (r.acertada) return { ok: true, texto: `Las ${n} parejas bien.` };
      return this.parejas().some((x) => x !== null)
        ? { ok: false, texto: `Acertaste ${buenas} de ${n} parejas. Hay que tener todas bien para sumar; en verde está la que correspondía.` }
        : null;
    }
    if (m.mecanica === 'diagrama' && !r.acertada && r.solucion.paso) {
      return { ok: false, texto: `El paso que faltaba era «${r.solucion.paso}».` };
    }
    return null;
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
   *
   * ── Y por qué depende de la matrícula y no del ramo ──
   *
   * Porque `perfil.ramo()` cambia de identidad en cada refresco del perfil, y
   * `responder()` refresca el perfil al terminar: la misión se releía y la
   * corrección recién hecha quedaba reemplazada por el relleno de «ya resuelta».
   * La explicación completa está en `perfil.store.ts`, sobre `matricula`.
   */
  constructor() {
    effect(() => {
      const matricula = this.perfil.matricula();
      if (matricula) void this.cargar(matricula);
      else this.cargando.set(false);
    });
    void this.perfil.cargar();
  }

  private async cargar(matricula: string): Promise<void> {
    this.cargando.set(true);
    // Lo elegido y lo corregido pertenecen a la misión que se está dejando: si
    // sobreviven, el ramo nuevo abre con una alternativa marcada que nadie marcó.
    this.reiniciarRespuesta(null);
    this.resultado.set(null);
    try {
      const r = await this.datos.misionDelDia(matricula);
      this.estado.set(r.estado);
      this.mision.set(r.mision);
      this.reiniciarRespuesta(r.mision);
      // Si ya la respondió, se muestra resuelta con su explicación. La experiencia
      // que se anuncia es la que se abonó —`misiones.xp`, lo mismo que le sumó
      // `mision_responder`— y no un cero que haría ver la misión como no pagada.
      if (r.mision?.resuelta_en) {
        const sol = r.mision.solucion ?? {};
        this.resultado.set({
          acertada: !!r.mision.acertada,
          // `desarrollo` puede pagar la mitad: ese monto viaja en la pauta. Para el
          // resto, pagó todo o nada.
          xp_ganada: sol.xp_ganada ?? (r.mision.acertada ? r.mision.xp : 0),
          veredicto: sol.veredicto,
          // La pauta de una misión ya respondida sí baja (migración 0033), así que
          // al recargar la página vuelven la alternativa correcta y su explicación.
          solucion: sol,
        });
        this.restaurarRespuesta(r.mision);
      }
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo cargar tu misión.');
    } finally {
      this.cargando.set(false);
    }
  }

  /** Cuándo se rehabilita el botón, dicho como lo diría una persona. */
  cuando(): string {
    const s = this.estado()?.faltan_segundos ?? 0;
    if (s <= 0) return 'en un momento';
    const h = Math.floor(s / 3600);
    if (h >= 2) return `en ${h} horas`;
    if (h === 1) return 'en una hora';
    const m = Math.max(1, Math.round(s / 60));
    return `en ${m} minuto${m === 1 ? '' : 's'}`;
  }

  async generarla(): Promise<void> {
    if (this.generando()) return;
    this.generando.set(true);
    this.error.set('');
    try {
      const ramo = this.perfil.ramo();
      if (!ramo) return;
      const r = await this.datos.generarMision(ramo.matricula_id);
      this.estado.set(r.estado);
      this.mision.set(r.mision);
      this.reiniciarRespuesta(r.mision);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo armar tu misión. Inténtalo de nuevo.');
    } finally {
      this.generando.set(false);
    }
  }

  /** Deja la respuesta en blanco, con el tamaño que pide la mecánica de `m`. */
  private reiniciarRespuesta(m: Mision | null): void {
    this.elegida.set(null);
    this.texto.set('');
    this.vf.set(Array.from({ length: m?.enunciado.afirmaciones?.length ?? 0 }, () => null));
    this.parejas.set(Array.from({ length: m?.enunciado.definiciones?.length ?? 0 }, () => null));
  }

  /**
   * Al recargar una misión ya respondida, vuelve lo que el alumno contestó para
   * marcar cuáles estaban mal. Solo está desde la 0043: las anteriores no lo
   * guardaban y muestran únicamente la correcta.
   */
  private restaurarRespuesta(m: Mision): void {
    const r = m.solucion?.respuesta;
    if (r === undefined) return;
    switch (m.mecanica) {
      case 'verdadero_falso':
        if (Array.isArray(r)) this.vf.set(r.map((x) => (x === 'v' || x === 'f' ? x : null)));
        break;
      case 'emparejar':
        if (Array.isArray(r)) this.parejas.set(r.map((x) => (x === '' || x == null ? null : Number(x))));
        break;
      case 'desarrollo':
        if (typeof r === 'string') this.texto.set(r);
        break;
      default: {
        const i = typeof r === 'string' && r !== '' ? Number(r) : NaN;
        if (Number.isInteger(i)) this.elegida.set(i);
      }
    }
  }

  elegir(i: number): void {
    if (this.resultado()) return;
    this.elegida.set(i);
  }

  marcarVf(i: number, valor: 'v' | 'f'): void {
    if (this.resultado()) return;
    this.vf.update((v) => v.map((x, k) => (k === i ? valor : x)));
  }

  /** Lo que el alumno puso en la afirmación `i` estaba bien: `null` si no se sabe. */
  vfOk(i: number): boolean | null {
    const buena = this.resultado()?.solucion.respuestas?.[i];
    const mia = this.vf()[i];
    return buena && mia ? buena === mia : null;
  }

  /**
   * Asigna el término `k` a la definición `j`. Cada término va a una sola
   * definición: si ya estaba en otra, se suelta de ahí.
   */
  emparejar(j: number, k: number): void {
    if (this.resultado()) return;
    this.parejas.update((p) => p.map((x, i) => {
      if (i === j) return x === k ? null : k;
      return x === k ? null : x;
    }));
  }

  /** El índice del término que correspondía a la definición `j`, o -1 si no se sabe. */
  parCorrecto(j: number): number {
    const bruto = this.resultado()?.solucion.pares?.[j];
    return bruto === undefined ? -1 : Number(bruto);
  }

  parOk(j: number): boolean | null {
    const mia = this.parejas()[j];
    return this.parCorrecto(j) < 0 || mia === null ? null : mia === this.parCorrecto(j);
  }

  /** Lo que se manda al servidor, con las claves que espera cada mecánica. */
  private armarRespuesta(m: Mision): Record<string, string> {
    switch (m.mecanica) {
      case 'verdadero_falso':
        return Object.fromEntries(this.vf().map((v, i) => [`a${i}`, v ?? '']));
      case 'emparejar':
        return Object.fromEntries(this.parejas().map((k, j) => [`d${j}`, String(k ?? '')]));
      case 'desarrollo':
        return { texto: this.texto().trim() };
      default:
        return { elegida: String(this.elegida()) };
    }
  }

  async responder(): Promise<void> {
    const m = this.mision();
    if (!m || !this.completa() || this.respondiendo()) return;
    this.respondiendo.set(true);
    this.error.set('');
    try {
      this.resultado.set(await this.datos.responderMision(m.id, this.armarRespuesta(m)));
      // Los puntos del ramo no cambian —la experiencia es otra moneda— pero el
      // encabezado sí muestra el saldo, así que conviene refrescarlo igual.
      await this.perfil.cargar(true);
    } catch (e: any) {
      // En desarrollo, un fallo del corrector deja la misión pendiente y lo
      // escrito intacto: el alumno reenvía con el mismo botón.
      this.error.set(e?.message ?? 'No se pudo corregir tu respuesta.');
    } finally {
      this.respondiendo.set(false);
    }
  }
}
