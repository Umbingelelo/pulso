import { Injectable, signal } from '@angular/core';
import { NeonPostgrestClient, fetchWithToken } from '@neondatabase/postgrest-js';

export interface Periodo {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
}

export interface Asignatura {
  id: string;
  sigla: string;
  nombre: string;
}

export interface Seccion {
  id: string;
  codigo: string;
  asignatura_id: string;
  periodo_id: string;
}

export interface Perfil {
  id: string;
  nombre: string;
  avatar: string;
  creado_en: string;
}

/**
 * Una matrícula vista desde el alumno: «curso esta sección de esta asignatura en
 * este periodo, y llevo estos puntos». Es la unidad con la que trabaja toda la
 * app: el saldo, las actividades y los resultados cuelgan de acá, no del perfil.
 */
export interface Ramo {
  matricula_id: string;
  perfil_id: string;
  activa: boolean;
  creado_en: string;
  seccion_id: string;
  seccion: string;
  asignatura_id: string;
  sigla: string;
  asignatura: string;
  periodo_id: string;
  periodo: string;
  periodo_nombre: string;
  periodo_activo: boolean;
  puntos: number;
}

export interface Movimiento {
  id: number;
  puntos: number;
  motivo: string;
  creado_en: string;
}

export interface Actividad {
  id: string;
  codigo: string;
  titulo: string;
  descripcion: string | null;
  tipo: string;
  puntos: number;
  orden: number;
}

export interface Resultado {
  id: number;
  actividad_id: string;
  matricula_id: string;
  detalle: any;
  completada_en: string;
}

/**
 * Una clase, con el avance del alumno pegado.
 *
 * No trae la ruta del archivo ni la pauta de sus quiz: la vista `mis_clases` no
 * los selecciona y el rol de la app no tiene permiso sobre esas dos columnas. El
 * deck se abre por `/api/clase?id=…`, que es lo único que sabe dónde está.
 */
export interface Clase {
  id: string;
  codigo: string;
  titulo: string;
  descripcion: string | null;
  orden: number;
  dictada_el: string | null;
  slides: number;
  actividades: number;
  puntos_abrir: number;
  puntos_actividad: number;
  puntos_terminar: number;
  matricula_id: string;
  abierta: boolean;
  abierta_en: string | null;
  slide_max: number | null;
  terminada_en: string | null;
  resueltas: number;

  /**
   * La ventana: hasta `ventana_hasta` los puntos valen completos; después se
   * multiplican por `factor_atrasado`. En null no hay castigo nunca.
   */
  ventana_hasta: string | null;
  factor_atrasado: number;
  en_ventana: boolean;
}

/** La misma clase vista por quien la dicta: trae también las no publicadas. */
export interface ClaseDocente {
  id: string;
  asignatura_id: string;
  periodo_id: string;
  sigla: string;
  asignatura: string;
  periodo: string;
  codigo: string;
  titulo: string;
  descripcion: string | null;
  orden: number;
  dictada_el: string | null;
  slides: number;
  actividades: number;
  puntos_abrir: number;
  puntos_actividad: number;
  puntos_terminar: number;
  publicada_desde: string | null;
  ventana_hasta: string | null;
  factor_atrasado: number;
  publicada: boolean;
  en_ventana: boolean;
  abrieron: number;
  terminaron: number;
  a_tiempo: number;
}

/**
 * La misión del día. `enunciado` es lo único que baja al navegador: la pauta
 * vive en una columna sin permiso para el rol de la aplicación, y la corrección
 * la hace Postgres.
 */
export interface Mision {
  id: string;
  fecha: string;
  tipo: 'diaria' | 'semanal';
  xp: number;
  plantilla: string;
  nombre: string;
  mecanica: string;
  banda: string;
  resuelta_en: string | null;
  acertada: boolean | null;
  intentos: number;
  enunciado: {
    mecanica: string;
    termino: string | null;
    fuente: string | null;
    pregunta: string;
    opciones: string[];
  };
}

export interface EstadoMision {
  dia: string;
  ya_tiene: boolean;
  puede_generar: boolean;
  proxima_en: string;
  faltan_segundos: number;
}

/** El pase de batalla del ramo, con la escalera de recompensas. */
export interface Pase {
  pase_id: string;
  numero: number;
  nombre: string;
  desde: string;
  hasta: string;
  vigente: boolean;
  xp: number;
  nivel: number;
  xp_nivel: number;
  xp_para_subir: number;
  xp_total_pase: number;
  completo: boolean;
  xp_sobrante: number;
  puntos_por_sobrante: number;
  recompensas: Recompensa[];
}

export interface Recompensa {
  nivel: number;
  tiradas: number;
  desbloqueada: boolean;
  obtenida: boolean;
  cosmetico: {
    id: string; tipo: string; nombre: string;
    descripcion: string | null; valor: string; rareza: string;
  } | null;
}

export interface Posicion {
  matricula_id: string;
  nombre: string;
  avatar: string;
  seccion: string;
  xp: number;
  lugar: number;
  orden: number;
  titulo: string | null;
}

export interface AlumnoNomina {
  matricula_id: string;
  perfil_id: string;
  nombre: string;
  avatar: string;
  creado_en: string;
  activa: boolean;
  seccion_id: string;
  seccion: string;
  asignatura: string;
  asignatura_nombre: string;
  periodo: string;
  puntos: number;
}

/** Lo que dicta el docente: una asignatura en un periodo. */
export interface RamoDocente {
  asignatura_id: string;
  periodo_id: string;
  sigla: string;
  asignatura: string;
  periodo: string;
}

/** Una pregunta del diagnóstico tal como la entrega el servidor. */
export interface PreguntaDiagnostico {
  orden: number;
  enunciado: string;
  codigo: string | null;
  opciones: string[];
  puntua: boolean;
  /** Solo llega con valor después de entregar. Antes viaja en null. */
  correcta: number | null;
  explicacion: string | null;
}

export interface SeccionDiagnostico {
  codigo: string;
  titulo: string;
  umbral: number;
  repaso: string | null;
  critica: boolean;
  intro: string | null;
  preguntas: PreguntaDiagnostico[];
}

export interface Cuestionario {
  actividad: { id: string; codigo: string; titulo: string; descripcion: string | null; puntos: number };
  rendido: boolean;
  puntajes: Record<string, number>;
  respuestas: Record<string, number>;
  secciones: SeccionDiagnostico[];
}

export interface FilaResumenDiagnostico {
  codigo: string;
  titulo: string;
  umbral: number;
  maximo: number;
  promedio: number;
  bajo: number;
  rendidos: number;
}

export type Categoria = 'nota' | 'evaluacion' | 'plazo' | 'apoyo' | 'equipo' | 'comodin';
export type EstadoCanje = 'solicitado' | 'aprobado' | 'entregado' | 'rechazado' | 'cancelado';

/** Un artículo tal como se ve desde la vitrina de un ramo. */
export interface Articulo {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  detalle: string | null;
  categoria: Categoria;
  icono: string | null;
  /** null = todavía sin precio: se muestra como «próximamente» y no se puede canjear. */
  precio: number | null;
  requiere_aprobacion: boolean;
  stock: number | null;
  limite_por_alumno: number | null;
  orden: number;
  matricula_id: string;
  saldo: number;
  ya_canjeados: number;
  colocados: number;
}

export interface Canje {
  id: number;
  estado: EstadoCanje;
  precio_pagado: number;
  nota_alumno: string | null;
  comentario_docente: string | null;
  creado_en: string;
  resuelto_en: string | null;
  matricula_id: string;
  articulo_id: string;
  articulo_codigo: string;
  articulo: string;
  icono: string | null;
  categoria: Categoria;
  requiere_aprobacion: boolean;
  perfil_id: string;
  alumno: string;
  avatar: string;
  seccion: string;
  asignatura_id: string;
  sigla: string;
  periodo_id: string;
  periodo: string;
}

/** Todo lo de un alumno en un ramo, tal como lo devuelve `ficha_alumno()`. */
export interface Ficha {
  perfil: { id: string; nombre: string; avatar: string; creado_en: string };
  ramo: {
    matricula_id: string; sigla: string; asignatura: string; seccion: string;
    periodo: string; periodo_nombre: string; activa: boolean; creado_en: string; puntos: number;
  };
  saldo: number;
  ganados: number;
  gastados: number;
  movimientos: Movimiento[];
  actividades: {
    id: string; codigo: string; titulo: string; tipo: string;
    puntos: number; completada_en: string | null;
  }[];
  diagnostico: {
    rendido: boolean;
    secciones: {
      codigo: string; titulo: string; umbral: number; critica: boolean;
      maximo: number; puntaje: number;
    }[];
  } | null;
  canjes: {
    id: number; articulo: string; icono: string | null; categoria: Categoria;
    estado: EstadoCanje; precio_pagado: number; nota_alumno: string | null;
    comentario_docente: string | null; creado_en: string; resuelto_en: string | null;
  }[];
  otros_ramos: {
    matricula_id: string; sigla: string; seccion: string;
    periodo: string; puntos: number; activa: boolean;
  }[];
  soy_docente: boolean;
}

/** Lo que la app necesita saber de la sesión: quién es, nada más. */
export interface Usuario {
  id: string;
}

/**
 * Acceso a datos sobre Neon.
 *
 * El navegador le habla directo a la base a través de la **Data API** de Neon,
 * que es PostgREST — el mismo motor que servía Supabase—, y la autorización la
 * sigue decidiendo el RLS. Lo que cambió es de dónde sale la identidad:
 *
 *   * `/api/auth/*` son cuatro funciones nuestras que validan la contraseña
 *     dentro de Postgres y firman un token de acceso corto.
 *   * `/db/*` se reescribe en Vercel hacia la Data API, así que el navegador
 *     **solo le habla a pulso-rust.vercel.app**. Esa es la razón de toda la
 *     migración: un dominio de terceros es bloqueable, y Duoc ya bloqueó uno.
 *
 * El token vive en memoria y se renueva solo. Sin sesión se pide uno público,
 * porque la Data API exige JWT incluso para el catálogo del registro.
 */
@Injectable({ providedIn: 'root' })
export class DatosService {
  /** Usuario autenticado, o null. */
  readonly usuario = signal<Usuario | null>(null);
  /** false hasta que se resuelve la sesión guardada, para no parpadear al cargar. */
  readonly listo = signal(false);

  private token = '';
  private expiraEn = 0;          // marca de tiempo en milisegundos
  private renovando: Promise<void> | null = null;

  /**
   * PostgREST apuntado al proxy, no al dominio de Neon.
   *
   * `fetchWithToken` es del propio cliente: le pasa el token a cada petición
   * llamando a la función que le damos, así ninguna consulta tiene que acordarse
   * de inyectarlo. Y como esa función es la que renueva, un token vencido se
   * repone solo antes de la llamada.
   */
  private db = new NeonPostgrestClient({
    // Absoluto y del mismo origen: `postgrest-js` hace `new URL(...)` y con una
    // ruta relativa revienta antes de enviar la petición. Sigue siendo nuestro
    // dominio, así que el navegador no le habla a ningún tercero.
    dataApiUrl: `${location.origin}/db`,
    options: {
      global: {
        fetch: fetchWithToken(async () => {
          await this.asegurarToken();
          return this.token;
        }),
      },
    },
  });

  constructor() {
    this.restaurarSesion();
  }

  // ---------- Sesión ----------

  private async restaurarSesion(): Promise<void> {
    try {
      await this.renovarToken();
    } catch {
      /* sin sesión: se sigue con el token público */
    } finally {
      this.listo.set(true);
    }
  }

  /**
   * Pide un token nuevo. Con cookie de refresco válida devuelve el del alumno;
   * si no, uno público que solo abre el catálogo.
   */
  private async renovarToken(): Promise<void> {
    const r = await fetch('/api/auth/sesion', { credentials: 'same-origin' });
    if (r.ok) {
      const d = await r.json();
      this.guardarToken(d.token, d.expira_en, d.usuario_id);
      return;
    }

    const p = await fetch('/api/auth/publico');
    if (!p.ok) throw new Error('No se pudo contactar al servidor.');
    const d = await p.json();
    this.guardarToken(d.token, d.expira_en, null);
  }

  private guardarToken(token: string, expiraEn: number, usuarioId: string | null): void {
    this.token = token;
    // Un minuto de margen: no sirve un token que vence en el viaje.
    this.expiraEn = Date.now() + (expiraEn - 60) * 1000;
    this.usuario.set(usuarioId ? { id: usuarioId } : null);
  }

  /** Renueva si hace falta, y sin lanzar dos renovaciones en paralelo. */
  private async asegurarToken(): Promise<void> {
    if (this.token && Date.now() < this.expiraEn) return;
    if (!this.renovando) {
      this.renovando = this.renovarToken().finally(() => { this.renovando = null; });
    }
    return this.renovando;
  }


  /** Las funciones de `/api/auth/*` devuelven `{error}` con un mensaje legible. */
  private async auth(ruta: string, cuerpo?: unknown): Promise<any> {
    const r = await fetch(`/api/auth/${ruta}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error ?? 'No se pudo completar la operación.');
    return d;
  }

  // ---------- Catálogo (con el token público, antes de iniciar sesión) ----------

  /** Periodos abiertos a matrícula. Hoy es uno; en 2027-1 serán otros. */
  async periodos(): Promise<Periodo[]> {
    const { data, error } = await this.db
      .from('periodos')
      .select('id, codigo, nombre, activo')
      .eq('activo', true)
      .order('codigo', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Periodo[];
  }

  /**
   * Asignaturas con al menos una sección abierta en ese periodo. Se resuelve
   * desde `secciones` para no ofrecer un ramo al que después nadie se puede
   * matricular.
   */
  async asignaturasDe(periodoId: string): Promise<Asignatura[]> {
    const { data, error } = await this.db
      .from('secciones')
      .select('asignaturas(id, sigla, nombre)')
      .eq('periodo_id', periodoId)
      .eq('activa', true);
    if (error) throw error;

    const porId = new Map<string, Asignatura>();
    for (const fila of (data ?? []) as any[]) {
      const a = fila.asignaturas;
      if (a) porId.set(a.id, a);
    }
    return [...porId.values()].sort((x, y) => x.sigla.localeCompare(y.sigla));
  }

  async secciones(asignaturaId: string, periodoId: string): Promise<Seccion[]> {
    const { data, error } = await this.db
      .from('secciones')
      .select('id, codigo, asignatura_id, periodo_id')
      .eq('asignatura_id', asignaturaId)
      .eq('periodo_id', periodoId)
      .eq('activa', true)
      .order('codigo');
    if (error) throw error;
    return (data ?? []) as Seccion[];
  }

  // ---------- Autenticación ----------

  /**
   * Crea la cuenta. `registrar_alumno()` hace usuario, perfil y primera
   * matrícula en una transacción, y deja la sesión abierta: ya no hay que
   * confirmar el correo, que era lo que reventaba con el 429.
   */
  async registrar(datos: {
    correo: string;
    clave: string;
    nombre: string;
    seccionId: string;
  }): Promise<{ conSesion: boolean }> {
    const d = await this.auth('registro', {
      correo: datos.correo,
      clave: datos.clave,
      nombre: datos.nombre,
      seccion_id: datos.seccionId || null,
    });
    this.guardarToken(d.token, d.expira_en, d.usuario_id);
    return { conSesion: true };
  }

  async ingresar(correo: string, clave: string): Promise<void> {
    const d = await this.auth('ingresar', { correo, clave });
    this.guardarToken(d.token, d.expira_en, d.usuario_id);
  }

  async salir(): Promise<void> {
    await this.auth('salir').catch(() => undefined);
    this.token = '';
    this.expiraEn = 0;
    this.usuario.set(null);
  }

  // ---------- Perfil y matrículas ----------

  /** La persona: nombre y avatar. Los ramos van aparte. */
  async miPerfil(): Promise<Perfil | null> {
    const u = this.usuario();
    if (!u) return null;
    const { data, error } = await this.db
      .from('perfiles')
      .select('id, nombre, avatar, creado_en')
      .eq('id', u.id)
      .maybeSingle();
    if (error) throw error;
    return data as Perfil | null;
  }

  /** Todos los ramos del alumno, del más reciente al más antiguo. */
  async misRamos(): Promise<Ramo[]> {
    const u = this.usuario();
    if (!u) return [];
    const { data, error } = await this.db
      .from('mis_ramos')
      .select('*')
      .eq('perfil_id', u.id)
      .order('periodo', { ascending: false })
      .order('sigla');
    if (error) throw error;
    return (data ?? []) as Ramo[];
  }

  /** Agrega un ramo. El RLS solo lo acepta si la sección y el periodo están abiertos. */
  async matricularme(seccionId: string): Promise<void> {
    const u = this.usuario();
    if (!u) throw new Error('Sin sesión');
    const { error } = await this.db
      .from('matriculas')
      .insert({ perfil_id: u.id, seccion_id: seccionId });
    if (error) throw error;
  }

  /**
   * Antes servía para rescatar un registro a medias, cuando el perfil lo creaba
   * un trigger sobre `auth.users` y podía quedar sin crear. Ahora las tres
   * inserciones van en una transacción, así que este caso no puede ocurrir.
   */
  async completarPerfil(): Promise<void> {
    throw new Error('Tu cuenta quedó incompleta. Escríbele al docente para arreglarlo.');
  }

  /** Guarda el avatar elegido, en formato "estilo:semilla". */
  async guardarAvatar(clave: string): Promise<void> {
    const u = this.usuario();
    if (!u) throw new Error('Sin sesión');
    const { error } = await this.db.from('perfiles').update({ avatar: clave }).eq('id', u.id);
    if (error) throw error;
  }

  // ---------- Puntos ----------

  async saldo(matriculaId: string): Promise<number> {
    const { data, error } = await this.db
      .from('saldos_puntos')
      .select('saldo')
      .eq('matricula_id', matriculaId)
      .maybeSingle();
    if (error) throw error;
    return (data as any)?.saldo ?? 0;
  }

  async movimientos(matriculaId: string): Promise<Movimiento[]> {
    const { data, error } = await this.db
      .from('movimientos_puntos')
      .select('id, puntos, motivo, creado_en')
      .eq('matricula_id', matriculaId)
      .order('creado_en', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Movimiento[];
  }

  // ---------- Actividades ----------

  /** Las del ramo, y solo las de ese ramo. El RLS filtra igual, por si acaso. */
  async actividades(ramo: Ramo): Promise<Actividad[]> {
    const { data, error } = await this.db
      .from('actividades')
      .select('id, codigo, titulo, descripcion, tipo, puntos, orden')
      .eq('asignatura_id', ramo.asignatura_id)
      .eq('periodo_id', ramo.periodo_id)
      .eq('activa', true)
      .order('orden');
    if (error) throw error;
    return (data ?? []) as Actividad[];
  }

  async resultados(matriculaId: string): Promise<Resultado[]> {
    const { data, error } = await this.db
      .from('resultados_actividad')
      .select('id, actividad_id, matricula_id, detalle, completada_en')
      .eq('matricula_id', matriculaId)
      .order('completada_en', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Resultado[];
  }

  // ---------- Clases ----------

  /**
   * Las clases publicadas del ramo, con el avance propio.
   *
   * Filtra por `matricula_id` y no por asignatura porque la vista ya trae una
   * fila por matrícula: si un alumno cursa dos ramos, sin este filtro vería las
   * clases del otro mezcladas.
   */
  async clases(ramo: Ramo): Promise<Clase[]> {
    const { data, error } = await this.db
      .from('mis_clases')
      // En una sola línea a propósito: `postgrest-js` infiere el tipo del
      // resultado leyendo este literal, y una cadena concatenada lo deja ciego.
      .select('id, codigo, titulo, descripcion, orden, dictada_el, slides, actividades, puntos_abrir, puntos_actividad, puntos_terminar, matricula_id, abierta, abierta_en, slide_max, terminada_en, resueltas, ventana_hasta, factor_atrasado, en_ventana')
      .eq('matricula_id', ramo.matricula_id)
      .order('orden')
      .order('codigo');
    if (error) throw error;
    return (data ?? []) as Clase[];
  }

  /** Las clases que dicta el docente, incluidas las que todavía no publica. */
  async clasesQueDicto(asignaturaId: string, periodoId: string): Promise<ClaseDocente[]> {
    const { data, error } = await this.db
      .from('clases_que_dicto')
      .select('id, asignatura_id, periodo_id, sigla, asignatura, periodo, codigo, titulo, descripcion, orden, dictada_el, slides, actividades, puntos_abrir, puntos_actividad, puntos_terminar, publicada_desde, ventana_hasta, factor_atrasado, publicada, en_ventana, abrieron, terminaron, a_tiempo')
      .eq('asignatura_id', asignaturaId)
      .eq('periodo_id', periodoId)
      .order('orden')
      .order('codigo');
    if (error) throw error;
    return (data ?? []) as ClaseDocente[];
  }

  /**
   * Programa una clase: cuándo se habilita, hasta cuándo vale completo y cuánto
   * paga cada tramo. Las fechas van en ISO (UTC); el formulario las convierte
   * desde la hora local del navegador.
   */
  async programarClase(datos: {
    claseId: string;
    publicadaDesde: string | null;
    ventanaHasta: string | null;
    factorAtrasado?: number;
    puntosAbrir?: number;
    puntosActividad?: number;
    puntosTerminar?: number;
  }): Promise<void> {
    const { error } = await this.db.rpc('clase_programar', {
      p_clase: datos.claseId,
      p_publicada_desde: datos.publicadaDesde,
      p_ventana_hasta: datos.ventanaHasta,
      p_factor_atrasado: datos.factorAtrasado ?? null,
      p_puntos_abrir: datos.puntosAbrir ?? null,
      p_puntos_actividad: datos.puntosActividad ?? null,
      p_puntos_terminar: datos.puntosTerminar ?? null,
    });
    if (error) throw error;
  }

  // ---------- Pase de batalla y posiciones ----------

  async miPase(matriculaId: string): Promise<Pase | null> {
    const { data, error } = await this.db.rpc('mi_pase', { p_matricula: matriculaId });
    if (error) throw error;
    return data as Pase | null;
  }

  /** Entrega lo que el alumno ya desbloqueó. Idempotente: devuelve solo lo nuevo. */
  async sincronizarPase(matriculaId: string): Promise<{ nuevos: any[]; tiradas: number } | null> {
    const { data, error } = await this.db.rpc('sincronizar_pase', { p_matricula: matriculaId });
    if (error) throw error;
    return data as any;
  }

  async equipar(matriculaId: string, cosmeticoId: string | null): Promise<void> {
    const { error } = await this.db.rpc('equipar_cosmetico', {
      p_matricula: matriculaId, p_cosmetico: cosmeticoId,
    });
    if (error) throw error;
  }

  /**
   * La tabla del ramo. Se piden 40 filas y no 10: los empatados comparten lugar,
   * así que «los diez primeros lugares» pueden ser muchas más filas, y el propio
   * alumno puede venir más abajo. Recortar acá dejaría fuera su posición.
   */
  async posiciones(asignaturaId: string, periodoId: string): Promise<Posicion[]> {
    const { data, error } = await this.db
      .from('posiciones')
      .select('matricula_id, nombre, avatar, seccion, xp, lugar, orden, titulo')
      .eq('asignatura_id', asignaturaId)
      .eq('periodo_id', periodoId)
      .order('orden')
      .limit(40);
    if (error) throw error;
    return (data ?? []) as Posicion[];
  }

  // ---------- Misiones ----------
  // Van por `/api/*` y no por la Data API: la generación necesita la key del
  // modelo y el rol que registra misiones, y ninguna de las dos cosas puede
  // vivir en el navegador.

  async misionDelDia(matriculaId: string): Promise<{ estado: EstadoMision; mision: Mision | null }> {
    return this.pedir(`/api/mision?matricula=${encodeURIComponent(matriculaId)}`);
  }

  /** Arma la misión de hoy. Tarda unos segundos: la escribe un modelo. */
  async generarMision(matriculaId: string): Promise<{ estado: EstadoMision; mision: Mision | null }> {
    return this.pedir('/api/mision', { matricula: matriculaId });
  }

  async responderMision(misionId: string, respuesta: Record<string, string>): Promise<any> {
    return this.pedir('/api/mision-responder', { mision: misionId, respuesta });
  }

  /** Igual que `auth()`, pero para las rutas que no cuelgan de `/api/auth`. */
  private async pedir(ruta: string, cuerpo?: unknown): Promise<any> {
    const r = await fetch(ruta, {
      method: cuerpo ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error ?? 'No se pudo completar la operación.');
    return d;
  }

  // ---------- Diagnóstico ----------
  // Las preguntas no se leen de la tabla: el alumno no tiene política de lectura
  // sobre ella. Entra por estas funciones, que devuelven el cuestionario sin la
  // pauta y corrigen en el servidor.

  async cuestionario(matriculaId: string): Promise<Cuestionario | null> {
    const { data, error } = await this.db.rpc('diagnostico_cuestionario', {
      p_matricula: matriculaId,
    });
    if (error) throw error;
    return data as Cuestionario | null;
  }

  /** Entrega el diagnóstico. Devuelve el mismo cuestionario, ya corregido. */
  async rendirDiagnostico(
    matriculaId: string,
    respuestas: Record<string, number>,
  ): Promise<Cuestionario> {
    const { data, error } = await this.db.rpc('rendir_diagnostico', {
      p_matricula: matriculaId,
      p_respuestas: respuestas,
    });
    if (error) throw error;
    return data as Cuestionario;
  }

  async resumenDiagnostico(actividadId: string): Promise<FilaResumenDiagnostico[]> {
    const { data, error } = await this.db.rpc('diagnostico_resumen', {
      p_actividad: actividadId,
    });
    if (error) throw error;
    return (data ?? []) as FilaResumenDiagnostico[];
  }

  // ---------- Tienda ----------

  /** La vitrina del ramo, con el saldo y lo ya canjeado calculados por la base. */
  async vitrina(matriculaId: string): Promise<Articulo[]> {
    const { data, error } = await this.db
      .from('vitrina')
      .select('*')
      .eq('matricula_id', matriculaId)
      .order('orden');
    if (error) throw error;
    return (data ?? []) as Articulo[];
  }

  async misCanjes(matriculaId: string): Promise<Canje[]> {
    const { data, error } = await this.db
      .from('canjes_detalle')
      .select('*')
      .eq('matricula_id', matriculaId)
      .order('creado_en', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Canje[];
  }

  /**
   * Canjea. Los puntos se descuentan acá mismo; si el artículo necesita visto
   * bueno queda «solicitado» y se devuelven solos si lo rechazan.
   */
  async solicitarCanje(matriculaId: string, articuloId: string, nota?: string): Promise<number> {
    const { data, error } = await this.db.rpc('solicitar_canje', {
      p_matricula: matriculaId,
      p_articulo: articuloId,
      p_nota: nota?.trim() || null,
    });
    if (error) throw error;
    return data as number;
  }

  /** Solo mientras nadie lo ha revisado. Devuelve los puntos. */
  async cancelarCanje(canjeId: number): Promise<void> {
    const { error } = await this.db.rpc('cancelar_canje', { p_canje: canjeId });
    if (error) throw error;
  }

  /** La bandeja del docente: lo que está esperando respuesta. */
  async canjesDelRamo(asignaturaId: string, periodoId: string): Promise<Canje[]> {
    const { data, error } = await this.db
      .from('canjes_detalle')
      .select('*')
      .eq('asignatura_id', asignaturaId)
      .eq('periodo_id', periodoId)
      .order('creado_en', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Canje[];
  }

  async resolverCanje(
    canjeId: number,
    estado: 'aprobado' | 'entregado' | 'rechazado',
    comentario?: string,
  ): Promise<void> {
    const { error } = await this.db.rpc('resolver_canje', {
      p_canje: canjeId,
      p_estado: estado,
      p_comentario: comentario?.trim() || null,
    });
    if (error) throw error;
  }

  // ---------- Ficha ----------

  /**
   * Todo lo de un alumno en un ramo. La misma función para el alumno y para el
   * docente: quién puede verla lo decide la base, no el cliente.
   */
  async ficha(matriculaId: string): Promise<Ficha | null> {
    const { data, error } = await this.db.rpc('ficha_alumno', { p_matricula: matriculaId });
    if (error) throw error;
    return data as Ficha | null;
  }

  // ---------- Docente ----------

  /** Solo devuelve fila si el usuario está en la tabla de docentes. */
  async esDocente(): Promise<boolean> {
    const u = this.usuario();
    if (!u) return false;
    const { data, error } = await this.db.from('docentes').select('id').maybeSingle();
    if (error) return false;
    return !!data;
  }

  /** Lo que dicta: una fila por asignatura y periodo. */
  async ramosQueDicto(): Promise<RamoDocente[]> {
    const { data, error } = await this.db
      .from('docente_asignaturas')
      .select('asignatura_id, periodo_id, asignaturas(sigla, nombre), periodos(codigo)');
    if (error) throw error;
    return ((data ?? []) as any[])
      .map(f => ({
        asignatura_id: f.asignatura_id,
        periodo_id: f.periodo_id,
        sigla: f.asignaturas?.sigla ?? '—',
        asignatura: f.asignaturas?.nombre ?? '—',
        periodo: f.periodos?.codigo ?? '—',
      }))
      .sort((x, y) => (y.periodo + x.sigla).localeCompare(x.periodo + y.sigla));
  }

  /** La nómina de una asignatura en un periodo. El RLS ya la acota a lo que dicta. */
  async nomina(asignaturaSigla: string, periodo: string): Promise<AlumnoNomina[]> {
    const { data, error } = await this.db
      .from('resumen_alumnos')
      .select('*')
      .eq('asignatura', asignaturaSigla)
      .eq('periodo', periodo)
      .order('seccion')
      .order('nombre');
    if (error) throw error;
    return (data ?? []) as AlumnoNomina[];
  }

  /** Las actividades de un ramo que dicta el docente. */
  async actividadesDe(asignaturaId: string, periodoId: string): Promise<Actividad[]> {
    const { data, error } = await this.db
      .from('actividades')
      .select('id, codigo, titulo, descripcion, tipo, puntos, orden')
      .eq('asignatura_id', asignaturaId)
      .eq('periodo_id', periodoId)
      .order('orden');
    if (error) throw error;
    return (data ?? []) as Actividad[];
  }

  /** Otorga o descuenta puntos sobre una matrícula. Solo pasa el RLS si dicta esa sección. */
  async otorgarPuntos(matriculaId: string, puntos: number, motivo: string): Promise<void> {
    const { error } = await this.db
      .from('movimientos_puntos')
      .insert({ matricula_id: matriculaId, puntos, motivo });
    if (error) throw error;
  }
}
