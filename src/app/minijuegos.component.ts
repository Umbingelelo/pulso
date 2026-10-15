import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Clase, Ramo } from './datos.service';
import { DatosService } from './datos.service';
import { agruparPorExperiencia, experienciaEnCurso } from './experiencias';
import { PerfilStore } from './perfil.store';

/**
 * El jefe final, el Conejo del Broker, en pixel art: una letra por píxel, y solo
 * la mitad izquierda; la derecha es su espejo, así queda simétrico sin cuidarlo.
 * k contorno · g pelaje · G sombra · p oreja · y ojo · Y brillo · w dientes ·
 * n collar · c corona · C sombra de la corona.
 */
const SPRITE_MITAD = [
  '....kkk.....',
  '...kgGgk....',
  '...kgpGk....',
  '...kgpGk....',
  '...kgpGk....',
  '...kgpGk..c.',
  '...kgpGk.ccc',
  '...kgGgk.cCc',
  '....kgggkkkk',
  '...kggggggGg',
  '..kgggggggGg',
  '..kgkkkkgggg',
  '..kgkyYykggg',
  '..kgkyyykggg',
  '..kggkkkgggg',
  '..kGgggggggk',
  '..kGgggggkpp',
  '...kGggggkkk',
  '...kGGggggkw',
  '....kkGgggkw',
  '...knnkkkkkk',
  '..knnnnnnnnn',
  '..knnnnnncnn',
  '..kkkkkkkkkk',
];
const SPRITE_MAPA = SPRITE_MITAD.map(f => f + [...f].reverse().join(''));
const SPRITE_COLORES: Record<string, string> = {
  k: '#15121a', g: '#e8e2ee', G: '#b9b0c6', p: '#f29ab5', y: '#ff3048', Y: '#ffd34d',
  w: '#ffffff', n: '#3b2f4a', c: '#ffb800', C: '#c98a00',
  // Los del daño: arañazo, parche, moretón y gota de sudor.
  m: '#c0263a', b: '#e9d8b4', B: '#c8b48a', x: '#6b3a7a', e: '#7fd3ff',
};

/**
 * El daño del jefe, en cinco golpes acumulativos (seis etapas contando la de
 * entero): cada golpe son píxeles que se pintan encima del mapa completo (ya
 * espejado), como `[fila, columna, letra]`, donde '.' borra. Va asimétrico a
 * propósito: un golpe no cae en los dos lados.
 */
type Parche = [number, number, string][];
const borrar = (filas: number[], cols: number[]): Parche =>
  filas.flatMap(f => cols.map(c => [f, c, '.'] as [number, number, string]));
const DANO: Parche[] = [
  // 1 · rasguñado: le falta una punta a la corona y tiene arañazos en la mejilla.
  [[5, 13, '.'], [6, 14, 'C'],
   [15, 18, 'm'], [16, 19, 'm'], [15, 20, 'm'], [16, 21, 'm']],
  // 2 · parchado: un parche en la otra mejilla, y ya empieza a sudar.
  [[16, 4, 'b'], [16, 5, 'B'], [16, 6, 'b'], [15, 5, 'b'], [17, 5, 'b'],
   [7, 1, 'e'], [8, 0, 'e'], [8, 1, 'e'], [9, 0, 'e'], [9, 1, 'e']],
  // 3 · machucado: la oreja derecha se corta en la fila 3 y la punta cae doblada
  // hacia afuera; además pierde un diente.
  [...borrar([0, 1, 2], [16, 17, 18, 19, 20]),
   [3, 16, 'k'], [3, 17, 'k'], [3, 18, 'k'], [3, 19, 'k'], [3, 20, 'k'], [3, 21, 'k'], [3, 22, 'k'], [3, 23, 'k'],
   [4, 20, 'G'], [4, 21, 'p'], [4, 22, 'g'], [4, 23, 'k'],
   [5, 21, 'k'], [5, 22, 'k'], [5, 23, 'k'],
   [18, 12, 'k'], [19, 12, 'k']],
  // 4 · vendado: ojo morado y una venda en la frente, con el nudo al costado.
  [[11, 4, 'x'], [11, 5, 'x'], [11, 6, 'x'], [11, 7, 'x'], [11, 8, 'x'], [12, 4, 'x'], [13, 4, 'x'],
   [12, 8, 'x'], [13, 8, 'x'], [14, 4, 'x'], [14, 5, 'x'], [14, 6, 'x'], [14, 7, 'x'], [14, 8, 'x'],
   ...Array.from({ length: 18 }, (_, i) => [10, 3 + i, i % 3 === 2 ? 'B' : 'b'] as [number, number, string]),
   [9, 22, 'b'], [10, 22, 'B'], [11, 22, 'b'], [11, 23, 'b'], [9, 23, 'b']],
  // 5 · derrotado: ojos en X y sin corona.
  [[12, 5, 'k'], [12, 6, 'g'], [12, 7, 'k'], [13, 5, 'g'], [13, 6, 'k'], [13, 7, 'g'],
   [12, 16, 'k'], [12, 17, 'g'], [12, 18, 'k'], [13, 16, 'g'], [13, 17, 'k'], [13, 18, 'g'],
   ...borrar([5, 6, 7], [9, 10, 11, 12, 13, 14])],
];

function pixeles(mapa: string[]) {
  return mapa.flatMap((fila, y) => [...fila].flatMap((c, x) =>
    c === '.' ? [] : [{ x, y, color: SPRITE_COLORES[c], ojo: c === 'y' }]));
}

/** El jefe en cada etapa de daño: 0 entero, `DANO.length` derrotado. */
const SPRITE_ETAPAS = Array.from({ length: DANO.length + 1 }, (_, etapa) => {
  const mapa = SPRITE_MAPA.map(f => [...f]);
  for (const parche of DANO.slice(0, etapa)) for (const [f, c, l] of parche) mapa[f][c] = l;
  return pixeles(mapa.map(f => f.join('')));
});
const SPRITE = SPRITE_ETAPAS[0];

/** Lo que dura una clase de DSY1107: el timer parte con esto al aceptar el desafío. */
const DURACION_DESAFIO_MS = 79 * 60 * 1000;

/**
 * Los minijuegos del ramo: el repaso jugable de la evaluación en curso.
 *
 * En la base un minijuego es una clase con `tipo = 'minijuego'`: se sirve por
 * `/api/clase`, lo instrumenta el mismo rastreo y lo pagan las mismas funciones.
 * Por eso cada juego paga lo suyo y una sola vez: abrirlo, cada pregunta de
 * control acertada y llegar al cierre. Esta pantalla es la de Clases con otro
 * resumen arriba —cuánto del repaso lleva hecho— y sin el botón de descargar:
 * los puntos son de jugarlo acá.
 */
@Component({
  selector: 'app-minijuegos',
  imports: [DecimalPipe],
  styles: `
    .jefe-fondo {
      position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 18px;
      background: rgba(8, 8, 12, .88); animation: jefe-entra .3s ease-out both;
    }
    .jefe {
      width: min(620px, 100%); max-height: calc(100dvh - 36px); overflow-y: auto;
      background: #16141b; color: #eeeaf2; border: 1px solid #3a3342; border-radius: 18px;
      padding: 26px 26px 22px; animation: jefe-golpe .5s cubic-bezier(.2, 1.3, .4, 1) .05s both;
    }
    .jefe-alerta { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 800;
      letter-spacing: .22em; text-transform: uppercase; color: #ff6b7d; }
    .jefe-alerta::before { content: ''; width: 9px; height: 9px; border-radius: 50%; background: #ff3048;
      animation: jefe-late 1s ease-in-out infinite; }
    .jefe h2 { margin: 10px 0 4px; font-size: clamp(26px, 5vw, 36px); line-height: 1.1; color: #fff; }
    .jefe-reloj { margin: 14px 0 0; font-size: 14px; color: #b9b0c6; }
    /* El diálogo: el jefe habla de a una línea, como en un juego. */
    .globo { position: relative; margin: 18px 0 0; padding: 14px 16px; border-radius: 14px; min-height: 76px;
      background: #f4f1f7; color: #1b1722; font-size: 16px; line-height: 1.5; font-weight: 500; }
    .globo::before { content: ''; position: absolute; top: -9px; left: 50%; margin-left: -9px;
      border: 9px solid transparent; border-top: 0; border-bottom-color: #f4f1f7; }
    .globo-quien { display: block; font-size: 11px; font-weight: 800; letter-spacing: .14em;
      text-transform: uppercase; color: #8a2a3a; margin-bottom: 4px; }
    .globo-pasos { display: flex; gap: 6px; justify-content: center; margin-top: 10px; }
    .globo-pasos i { width: 7px; height: 7px; border-radius: 50%; background: #3a3342; }
    .globo-pasos i.on { background: #ffb800; }
    .trato { margin-top: 16px; padding: 14px 16px; border-radius: 14px; border: 1px solid #8a6400;
      background: #2a2212; font-size: 15px; line-height: 1.5; }
    .trato b.titulo { display: block; font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
      color: #ffd34d; margin-bottom: 6px; }
    .trato strong { color: #ffd34d; }
    .jefe-acciones .secundario { background: transparent; color: #eeeaf2; border: 1px solid #3a3342; }
    .jefe-acciones .secundario:hover { background: #1e1b25; }
    .jefe-acciones { gap: 10px; }
    /* El jefe acompaña la lista: su vida es lo que falta por terminar. */
    .jefe-panel { display: grid; grid-template-columns: auto 1fr; gap: 18px; align-items: center;
      margin-bottom: 18px; padding: 16px 20px; border-radius: 16px; background: #16141b; color: #eeeaf2;
      border: 1px solid #3a3342; }
    .jefe-panel svg { width: 92px; height: auto; animation: jefe-flota 2.4s ease-in-out infinite; }
    .jefe-panel.derrotado svg { animation: none; opacity: .55; transform: rotate(-12deg); }
    /* El golpe: cuando baja la vida, el jefe se sacude y se pone rojo un instante. */
    .jefe-panel.golpe svg { animation: jefe-golpeado .6s ease-out; }
    .jefe-panel.golpe .hp-barra { animation: jefe-sacude .4s ease-out; }
    @keyframes jefe-golpeado {
      0% { transform: translateX(0); filter: none; }
      15% { transform: translateX(-8px) rotate(-6deg); filter: brightness(.7) sepia(1) saturate(6) hue-rotate(-30deg); }
      35% { transform: translateX(7px) rotate(5deg); }
      55% { transform: translateX(-4px); filter: none; }
      100% { transform: translateX(0); }
    }
    @keyframes jefe-sacude { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
    .jefe-panel-etq { font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #ff6b7d; }
    .jefe-panel-nombre { font-size: 20px; font-weight: 800; margin: 2px 0 8px; }
    .hp { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 800; letter-spacing: .08em; }
    .hp-barra { flex: 1; height: 14px; border-radius: 4px; background: #2a2432; border: 1px solid #3a3342; overflow: hidden; }
    .hp-barra i { display: block; height: 100%; transition: width .8s ease, background .8s; }
    .hp-num { font-variant-numeric: tabular-nums; min-width: 64px; text-align: right; }
    .jefe-panel .globo { margin-top: 12px; min-height: 0; font-size: 15px; padding: 10px 14px; }
    .jefe-panel .globo::before { top: 50%; left: -9px; margin: -9px 0 0; border: 9px solid transparent;
      border-left: 0; border-right-color: #f4f1f7; }
    @media (max-width: 560px) {
      .jefe-panel { grid-template-columns: 1fr; justify-items: center; text-align: center; }
      .jefe-panel .globo::before { top: -9px; left: 50%; margin: 0 0 0 -9px; border: 9px solid transparent;
        border-top: 0; border-bottom-color: #f4f1f7; }
      .hp { width: 100%; }
    }
    .jefe-sprite { display: block; width: min(168px, 40vw); height: auto; margin: 4px auto 14px;
      animation: jefe-flota 2.4s ease-in-out infinite; }
    .jefe-ojo { animation: jefe-ojos 1.6s steps(2, jump-none) infinite; }
    .jefe-acciones { display: flex; justify-content: flex-end; margin-top: 18px; }
    .jefe-acciones button { font: inherit; font-weight: 800; font-size: 16px; padding: 12px 22px;
      border-radius: 12px; border: 0; cursor: pointer; color: #1a1300; background: #ffb800; }
    .jefe-acciones button:hover { background: #ffc633; }
    .jefe-acciones button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
    /* El marcador del desafío: fijo arriba a la derecha mientras dura. */
    .marcador {
      position: fixed; top: 14px; right: 14px; z-index: 900; display: flex; gap: 6px;
      background: #16141b; color: #eeeaf2; border: 1px solid #3a3342; border-radius: 14px; padding: 6px;
    }
    .marcador div { padding: 6px 12px; border-radius: 10px; background: #1e1b25; text-align: center; min-width: 74px; }
    .marcador span { display: block; font-size: 10.5px; font-weight: 800; letter-spacing: .12em;
      text-transform: uppercase; color: #b9b0c6; }
    .marcador b { font-size: 20px; font-variant-numeric: tabular-nums; }
    .marcador .fin b { color: #ff6b7d; }
    .marcador .listo b { color: #3ddc84; }
    @media (max-width: 760px) { .marcador { top: auto; bottom: 12px; right: 12px; } }
    @keyframes jefe-entra { from { opacity: 0; } }
    @keyframes jefe-golpe { from { opacity: 0; transform: scale(.9) translateY(16px); } }
    @keyframes jefe-late { 50% { opacity: .35; } }
    @keyframes jefe-flota { 50% { transform: translateY(-6px); } }
    @keyframes jefe-ojos { 50% { fill: #ff8a96; } }
    @media (prefers-reduced-motion: reduce) {
      .jefe-fondo, .jefe, .jefe-alerta::before, .jefe-sprite, .jefe-ojo, .jefe-panel svg,
      .jefe-panel.golpe svg, .jefe-panel.golpe .hp-barra { animation: none; }
    }
  `,
  template: `
    <!-- El desafío de DSY1107: el jefe final se presenta con un diálogo y propone
         el trato. Hay que aceptarlo para ver los juegos, y aceptar arranca el reloj. -->
    @if (verDesafio()) {
      <div class="jefe-fondo" role="dialog" aria-modal="true" aria-labelledby="jefe-titulo">
        <div class="jefe">
          <svg class="jefe-sprite" [attr.viewBox]="'0 0 ' + SPRITE_ANCHO + ' ' + SPRITE_ALTO"
               shape-rendering="crispEdges" role="img" aria-label="El Conejo del Broker, el jefe final">
            @for (p of SPRITE; track $index) {
              <rect [attr.x]="p.x" [attr.y]="p.y" width="1" height="1" [attr.fill]="p.color"
                    [class.jefe-ojo]="p.ojo"/>
            }
          </svg>
          <div class="jefe-alerta">Jefe final de la EP2</div>
          <h2 id="jefe-titulo">Bienvenido a los Juegos del Hambre</h2>

          <div class="globo" aria-live="polite">
            <span class="globo-quien">El Conejo del Broker</span>
            {{ DIALOGO[paso()] }}
          </div>
          <div class="globo-pasos" aria-hidden="true">
            @for (d of DIALOGO; track $index) { <i [class.on]="$index <= paso()"></i> }
          </div>

          @if (ultimoPaso()) {
            <div class="trato">
              <b class="titulo">El trato</b>
              Basta con que <strong>un integrante del grupo</strong> termine los {{ juegos().length }}
              minijuegos. El <strong>primer grupo</strong> en derrotarlo <strong>elige en qué orden presenta</strong>;
              después elige el segundo, y así. Si nadie termina, cuenta el que llegue más lejos.
              Apenas lo logren, avísenle al profe.
            </div>
            @if (!aceptadoEn()) {
              <p class="jefe-reloj">Al aceptar parte el reloj: <strong>79 minutos</strong>, lo que dura la clase.
                El reloj ordena el desafío, no los puntos: cuando se acabe, los juegos siguen abiertos y siguen pagando.</p>
            }
          }

          <div class="jefe-acciones">
            @if (!ultimoPaso()) {
              <button type="button" class="secundario" (click)="paso.set(DIALOGO.length - 1)">Saltar</button>
              <button type="button" (click)="paso.set(paso() + 1)" autofocus>Siguiente ▸</button>
            } @else if (aceptadoEn()) {
              <button type="button" (click)="releyendo.set(false)" autofocus>Volver a los juegos</button>
            } @else {
              <button type="button" (click)="aceptar()" autofocus>Aceptar el desafío</button>
            }
          </div>
        </div>
      </div>
    }

    @if (hayDesafio() && aceptadoEn()) {
      <div class="marcador" aria-live="off">
        <div [class.listo]="terminados() === juegos().length">
          <span>Juegos</span><b data-mj-marcador="juegos">{{ terminados() }}/{{ juegos().length }}</b>
        </div>
        <div [class.fin]="restanteMs() === 0">
          <span>{{ restanteMs() === 0 ? 'Se acabó' : 'Quedan' }}</span>
          <b data-mj-marcador="reloj">{{ reloj() }}</b>
        </div>
      </div>
    }

    <div class="encabezado">
      <h1>Minijuegos</h1>
      <p>
        El repaso jugable de la evaluación{{ perfil.ramo() ? ' · ' + perfil.ramo()!.asignatura : '' }}.
      </p>
      @if (hayDesafio() && aceptadoEn()) {
        <button type="button" class="boton chico contorno" style="margin-top:10px"
                (click)="paso.set(0); releyendo.set(true)">Ver el desafío</button>
      }
    </div>

    @if (cargando()) {
      <div class="tarjeta"><p class="suave">Cargando…</p></div>
    } @else if (juegos().length === 0) {
      <div class="tarjeta">
        <div class="aviso dato">
          Todavía no hay minijuegos publicados en este ramo.
        </div>
      </div>
    } @else if (hayDesafio() && !aceptadoEn()) {
      <div class="tarjeta">
        <div class="aviso dato">Acepta el desafío para ver los minijuegos.</div>
      </div>
    } @else {
      @if (hayDesafio()) {
        <div class="jefe-panel" [class.derrotado]="hp() === 0" [class.golpe]="golpe()">
          <svg [attr.viewBox]="'0 0 ' + SPRITE_ANCHO + ' ' + SPRITE_ALTO" shape-rendering="crispEdges"
               role="img" [attr.aria-label]="'El Conejo del Broker, ' + ['entero', 'rasguñado', 'parchado', 'machucado', 'vendado', 'derrotado'][etapaDano()]">
            @for (p of spriteDanado(); track $index) {
              <rect [attr.x]="p.x" [attr.y]="p.y" width="1" height="1" [attr.fill]="p.color"/>
            }
          </svg>
          <div>
            <div class="jefe-panel-etq">Jefe final de la EP2</div>
            <div class="jefe-panel-nombre">El Conejo del Broker</div>
            <div class="hp">
              <span>HP</span>
              <span class="hp-barra"><i [style.width.%]="hp() / juegos().length * 100"
                [style.background]="hp() / juegos().length > .5 ? '#3ddc84' : hp() / juegos().length > .25 ? '#ffb800' : '#ff3048'"></i></span>
              <span class="hp-num" data-mj-hp>{{ hp() }}/{{ juegos().length }}</span>
            </div>
            <div class="globo">{{ burla() }}</div>
          </div>
        </div>
      }
      <div class="rejilla tres" style="margin-bottom:18px">
        <div class="tarjeta">
          <p class="etiqueta">Terminados</p>
          <p class="cifra destacada" data-mj-resumen="terminados">
            {{ terminados() }}<span class="suave" style="font-size:20px">/{{ juegos().length }}</span>
          </p>
          <div style="height:6px;border-radius:99px;background:var(--borde);overflow:hidden;margin-top:8px">
            <div [style.width.%]="porcentajeTerminados()"
                 style="height:100%;background:var(--celeste);transition:width .3s"></div>
          </div>
        </div>
        <div class="tarjeta">
          <p class="etiqueta">Preguntas de control</p>
          <p class="cifra" data-mj-resumen="preguntas">
            {{ preguntasResueltas() }}<span class="suave" style="font-size:20px">/{{ preguntasTotales() }}</span>
          </p>
          <p class="chico suave">acertadas, entre todos los juegos</p>
        </div>
        <div class="tarjeta">
          <p class="etiqueta">Puntos por ganar</p>
          <p class="cifra" data-mj-resumen="por-ganar">{{ totalPorGanar() }}</p>
          <p class="chico suave">en los minijuegos que te quedan</p>
        </div>
      </div>

      <div class="tarjeta" style="margin-bottom:18px">
        <p class="chico suave" style="margin:0">
          Cada minijuego paga por separado, hasta <strong>{{ maximoPorJuego() }} puntos</strong>:
          @if (juegos()[0].puntos_abrir > 0) { <strong>{{ juegos()[0].puntos_abrir }}</strong> por abrirlo, }
          <strong>{{ juegos()[0].puntos_actividad }}</strong> por cada pregunta de control que aciertes
          y el resto por llegar al cierre. Cada cosa se paga una sola vez: volver a jugar es para practicar.
        </p>
        @if (hayPlazos()) {
          <p class="chico suave" style="margin:10px 0 0">
            Algunos tienen plazo: mientras esté abierto pagan completo, y después siguen
            sumando pero menos.
          </p>
        }
      </div>

      @for (g of grupos(); track g.numero) {
        <details class="experiencia" [open]="g.numero === null || g.numero === enCurso()">
          <summary>
            <span class="experiencia-titulo">{{ g.titulo }}</span>
            <span class="chico suave">{{ g.terminados }} de {{ g.items.length }} terminados</span>
          </summary>
          <div class="rejilla dos">
            @for (j of g.items; track j.id) {
              <div class="tarjeta" [attr.data-minijuego]="j.codigo">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
                  <div>
                    <p class="etiqueta">Minijuego {{ j.codigo }}</p>
                    <h2 style="margin-top:4px">{{ j.titulo }}</h2>
                  </div>
                  @if (j.terminada_en) {
                    <span class="insignia verde">Terminado</span>
                  } @else if (j.abierta) {
                    <span class="insignia amarilla">En curso</span>
                  } @else {
                    <span class="insignia celeste">Nuevo</span>
                  }
                </div>

                @if (j.ventana_hasta && !j.terminada_en && !j.en_ventana) {
                  <p class="chico suave" style="margin-top:10px">
                    El plazo cerró: ahora paga
                    <strong>{{ j.factor_atrasado * 100 | number:'1.0-0' }}%</strong> de los puntos.
                  </p>
                }

                @if (j.descripcion) {
                  <p class="chico suave" style="margin-top:10px">{{ j.descripcion }}</p>
                }

                <!-- Lo que paga este juego, tramo por tramo, y qué ya cobró. -->
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:14px">
                  @if (j.puntos_abrir > 0) {
                    <span class="insignia" [class.verde]="j.abierta">Abrir · {{ j.puntos_abrir }}</span>
                  }
                  @if (j.actividades > 0) {
                    <span class="insignia" [class.verde]="j.resueltas >= j.actividades">
                      Preguntas {{ j.resueltas }}/{{ j.actividades }} · {{ j.puntos_actividad }} c/u
                    </span>
                  }
                  <span class="insignia" [class.verde]="!!j.terminada_en">
                    Cierre · {{ j.puntos_terminar }}
                  </span>
                </div>

                @if (j.abierta && !j.terminada_en) {
                  <div style="margin-top:14px">
                    <div style="height:6px;border-radius:99px;background:var(--borde);overflow:hidden">
                      <div [style.width.%]="avance(j)"
                           style="height:100%;background:var(--celeste);transition:width .3s"></div>
                    </div>
                    <p class="chico suave" style="margin-top:8px">
                      Vas en la etapa {{ (j.slide_max ?? 0) + 1 }} de {{ j.slides }}
                    </p>
                  </div>
                }

                <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:18px;flex-wrap:wrap">
                  @if (porGanar(j) > 0) {
                    <span class="insignia celeste">{{ porGanar(j) }} puntos por ganar</span>
                  } @else {
                    <span class="insignia verde">Todo cobrado</span>
                  }
                  <a class="boton chico" [class.accion]="!j.abierta" [class.contorno]="j.abierta"
                     [href]="'/api/clase?id=' + j.id" target="_blank" rel="noopener"
                     (click)="alVolver()">
                    {{ j.terminada_en ? 'Jugar de nuevo' : j.abierta ? 'Seguir' : 'Jugar' }}
                  </a>
                </div>
              </div>
            }
          </div>
        </details>
      }
    }
  `,
})
export class MinijuegosComponent {
  private datos = inject(DatosService);
  protected perfil = inject(PerfilStore);

  juegos = signal<Clase[]>([]);
  private experiencias = signal<string[]>([]);
  cargando = signal(true);

  grupos = computed(() =>
    agruparPorExperiencia(this.juegos(), this.experiencias())
      .map(g => ({ ...g, terminados: g.items.filter(j => !!j.terminada_en).length })));
  enCurso = computed(() => experienciaEnCurso(this.grupos()));

  terminados = computed(() => this.juegos().filter(j => !!j.terminada_en).length);
  porcentajeTerminados = computed(() =>
    this.juegos().length ? Math.round((this.terminados() / this.juegos().length) * 100) : 0);
  preguntasResueltas = computed(() =>
    this.juegos().reduce((s, j) => s + Math.min(j.resueltas, j.actividades), 0));
  preguntasTotales = computed(() => this.juegos().reduce((s, j) => s + j.actividades, 0));
  totalPorGanar = computed(() => this.juegos().reduce((s, j) => s + this.porGanar(j), 0));
  hayPlazos = computed(() => this.juegos().some(j => !!j.ventana_hasta));

  /**
   * Solo DSY1107 tiene el desafío del orden de presentación, y solo con juegos
   * publicados: antes de la hora de apertura no hay nada que desafiar. Los juegos
   * no se muestran hasta aceptarlo, y aceptar arranca un reloj de 79 minutos.
   *
   * La aceptación se guarda en este navegador, por matrícula: recargar o volver
   * desde la pestaña de un juego no reinicia el reloj. En otro equipo se acepta
   * de nuevo y el reloj parte de ahí; es un empujón para la clase, no un control.
   */
  hayDesafio = computed(() => this.perfil.ramo()?.sigla === 'DSY1107' && this.juegos().length > 0);
  protected readonly SPRITE = SPRITE;
  protected readonly SPRITE_ANCHO = SPRITE_MAPA[0].length;
  protected readonly SPRITE_ALTO = SPRITE_MAPA.length;
  aceptadoEn = signal<number | null>(null);
  releyendo = signal(false);
  verDesafio = computed(() => this.hayDesafio() && (!this.aceptadoEn() || this.releyendo()));

  /** Lo que dice el jefe al presentarse, una línea por paso; la última deja el trato a la vista. */
  protected readonly DIALOGO = [
    'Así que llegaron. Soy el Conejo del Broker, jefe final de la EP2.',
    'El profe me contrató porque hoy no tenía ganas de hacer la clase. Me paga en zanahorias y mensajes sin ack.',
    'Mi pega es simple: que no terminen. Tengo tantos puntos de vida como minijuegos hay en esta sala.',
    'Pero el profe me obligó a ofrecerles un trato. Léanlo bien, porque no lo voy a repetir… bueno, sí, está en el botón.',
  ];
  paso = signal(0);
  ultimoPaso = computed(() => this.paso() >= this.DIALOGO.length - 1);

  /** La vida del jefe: los minijuegos que faltan por terminar. */
  hp = computed(() => this.juegos().length - this.terminados());
  /**
   * La etapa de daño: el último golpe (derrotado) queda para la vida en cero, y
   * los demás se reparten parejo entre lo que lleva perdido. Con 15 juegos, un
   * golpe nuevo cada 3 terminados.
   */
  etapaDano = computed(() => {
    const total = this.juegos().length || 1;
    if (this.hp() === 0) return DANO.length;
    return Math.min(DANO.length - 1, Math.floor(((total - this.hp()) / total) * DANO.length));
  });
  maximoPorJuego = computed(() => Math.max(0, ...this.juegos().map(j =>
    j.puntos_abrir + j.actividades * j.puntos_actividad + j.puntos_terminar)));
  spriteDanado = computed(() => SPRITE_ETAPAS[this.etapaDano()]);
  /** Se enciende un instante cada vez que la vida baja, para que el golpe se note. */
  golpe = signal(false);
  /** Lo que el jefe va diciendo al lado de la lista, según cuánto le queda y el reloj. */
  burla = computed(() => {
    const hp = this.hp();
    const total = this.juegos().length;
    if (hp === 0) return 'Me derrotaron… Corran a avisarle al profe antes que otro grupo, y díganle que me debe las zanahorias.';
    if (this.restanteMs() === 0) return 'Se acabó el tiempo del desafío: si nadie me ganó, que avise el que llegó más lejos. Los puntos se siguen ganando igual.';
    if (hp === total) return '¿Ni uno todavía? El profe me dijo que esto iba a ser fácil.';
    if (hp > total * 2 / 3) return `Eso fue suerte. Me quedan ${hp} de vida.`;
    if (hp > total / 3) return `Ya, ya… me dolió. Pero un consumidor sin idempotencia procesa dos veces. Me quedan ${hp}.`;
    if (hp > 1) return `¡Paren! Me quedan ${hp}. Voy a pedirle aumento al profe.`;
    return 'Uno. Me queda uno. Por favor, piénsenlo dos veces… o una sola, si es idempotente.';
  });
  private ahora = signal(Date.now());
  restanteMs = computed(() =>
    Math.max(0, (this.aceptadoEn() ?? this.ahora()) + DURACION_DESAFIO_MS - this.ahora()));
  reloj = computed(() => {
    const s = Math.ceil(this.restanteMs() / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  aceptar(): void {
    const matricula = this.perfil.matricula();
    if (!matricula) return;
    const ahora = Date.now();
    try { localStorage.setItem(`pulso.desafio.${matricula}`, String(ahora)); } catch { /* sin almacenamiento: dura lo que la pestaña */ }
    this.aceptadoEn.set(ahora);
  }

  /** Igual que en Clases: reacciona a la matrícula y lee el ramo sin registrarlo. */
  constructor() {
    effect(() => {
      const matricula = this.perfil.matricula();
      let guardado: string | null = null;
      try { guardado = matricula ? localStorage.getItem(`pulso.desafio.${matricula}`) : null; } catch { /* sin almacenamiento */ }
      this.aceptadoEn.set(guardado ? Number(guardado) : null);
      this.releyendo.set(false);
    });
    const tic = setInterval(() => this.ahora.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tic));
    // El golpe se marca solo cuando la vida baja respecto de la que ya se mostró:
    // la primera carga no cuenta, y cambiar de ramo tampoco (vuelve a partir).
    let hpAnterior: number | null = null;
    let apagar: number | undefined;
    effect(() => {
      const hp = this.juegos().length ? this.hp() : null;
      if (hp !== null && hpAnterior !== null && hp < hpAnterior) {
        this.golpe.set(false);
        queueMicrotask(() => this.golpe.set(true));
        clearTimeout(apagar);
        apagar = window.setTimeout(() => this.golpe.set(false), 700);
      }
      hpAnterior = hp;
    });
    effect(() => {
      const ramo = this.perfil.matricula() ? untracked(() => this.perfil.ramo()) : null;
      if (ramo) void this.cargar(ramo);
      else this.cargando.set(false);
    });
    void this.perfil.cargar();
  }

  private async cargar(ramo: Ramo): Promise<void> {
    this.cargando.set(true);
    try {
      const [clases, experiencias] = await Promise.all([
        this.datos.clases(ramo),
        this.datos.experiencias(ramo),
      ]);
      this.juegos.set(clases.filter(c => c.tipo === 'minijuego'));
      this.experiencias.set(experiencias);
    } finally {
      this.cargando.set(false);
    }
  }

  /** Al volver de la pestaña del juego se recarga, para ver lo recién ganado. */
  alVolver(): void {
    const alVolverAca = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', alVolverAca);
      const ramo = this.perfil.ramo();
      if (ramo) void this.cargar(ramo);
    };
    document.addEventListener('visibilitychange', alVolverAca);
  }

  avance(j: Clase): number {
    if (!j.slides) return 0;
    return Math.min(100, Math.round((((j.slide_max ?? 0) + 1) / j.slides) * 100));
  }

  /** Lo que le queda por cobrar en el juego, con el factor si el plazo cerró. */
  porGanar(j: Clase): number {
    const factor = j.en_ventana ? 1 : Number(j.factor_atrasado);
    const abrir = j.abierta ? 0 : Math.round(j.puntos_abrir * factor);
    const preguntas = Math.max(0, j.actividades - j.resueltas)
      * Math.round(j.puntos_actividad * factor);
    const cierre = j.terminada_en ? 0 : Math.round(j.puntos_terminar * factor);
    return abrir + preguntas + cierre;
  }
}
