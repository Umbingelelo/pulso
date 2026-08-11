import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { ENTORNO } from '../entorno';

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

@Injectable({ providedIn: 'root' })
export class DatosService {
  private sb: SupabaseClient = createClient(ENTORNO.supabaseUrl, ENTORNO.supabaseKey);

  /** Usuario autenticado, o null. Se mantiene al día con los eventos de auth. */
  readonly usuario = signal<User | null>(null);
  /** false hasta que se resuelve la sesión guardada, para no parpadear al cargar. */
  readonly listo = signal(false);

  constructor() {
    this.sb.auth.getSession().then(({ data }) => {
      this.usuario.set(data.session?.user ?? null);
      this.listo.set(true);
    });

    this.sb.auth.onAuthStateChange((_evento, sesion) => {
      this.usuario.set(sesion?.user ?? null);
    });
  }

  // ---------- Catálogo (lectura pública, sirve para los desplegables) ----------

  /** Periodos abiertos a matrícula. Hoy es uno; en 2027-1 serán otros. */
  async periodos(): Promise<Periodo[]> {
    const { data, error } = await this.sb
      .from('periodos')
      .select('id, codigo, nombre, activo')
      .eq('activo', true)
      .order('codigo', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Asignaturas con al menos una sección abierta en ese periodo. Se resuelve
   * desde `secciones` para no ofrecer un ramo al que después nadie se puede
   * matricular.
   */
  async asignaturasDe(periodoId: string): Promise<Asignatura[]> {
    const { data, error } = await this.sb
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
    const { data, error } = await this.sb
      .from('secciones')
      .select('id, codigo, asignatura_id, periodo_id')
      .eq('asignatura_id', asignaturaId)
      .eq('periodo_id', periodoId)
      .eq('activa', true)
      .order('codigo');
    if (error) throw error;
    return data ?? [];
  }

  // ---------- Autenticación ----------

  /**
   * Registra al alumno. El nombre y la sección viajan como metadata: un trigger
   * en la base crea el perfil y su primera matrícula con esos datos, y otorga los
   * puntos de bienvenida. Devuelve si quedó con sesión abierta (depende de si el
   * proyecto exige confirmar el correo).
   */
  async registrar(datos: {
    correo: string;
    clave: string;
    nombre: string;
    seccionId: string;
  }): Promise<{ conSesion: boolean }> {
    const { data, error } = await this.sb.auth.signUp({
      email: datos.correo,
      password: datos.clave,
      options: { data: { nombre: datos.nombre, seccion_id: datos.seccionId } },
    });
    if (error) throw error;
    return { conSesion: !!data.session };
  }

  async ingresar(correo: string, clave: string): Promise<void> {
    const { error } = await this.sb.auth.signInWithPassword({ email: correo, password: clave });
    if (error) throw error;
  }

  async salir(): Promise<void> {
    await this.sb.auth.signOut();
  }

  // ---------- Perfil y matrículas ----------

  /** La persona: nombre y avatar. Los ramos van aparte. */
  async miPerfil(): Promise<Perfil | null> {
    const u = this.usuario();
    if (!u) return null;
    const { data, error } = await this.sb
      .from('perfiles')
      .select('id, nombre, avatar, creado_en')
      .eq('id', u.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Todos los ramos del alumno, del más reciente al más antiguo. */
  async misRamos(): Promise<Ramo[]> {
    const u = this.usuario();
    if (!u) return [];
    const { data, error } = await this.sb
      .from('mis_ramos')
      .select('*')
      .eq('perfil_id', u.id)
      .order('periodo', { ascending: false })
      .order('sigla');
    if (error) throw error;
    return data ?? [];
  }

  /** Agrega un ramo. El RLS solo lo acepta si la sección y el periodo están abiertos. */
  async matricularme(seccionId: string): Promise<void> {
    const u = this.usuario();
    if (!u) throw new Error('Sin sesión');
    const { error } = await this.sb
      .from('matriculas')
      .insert({ perfil_id: u.id, seccion_id: seccionId });
    if (error) throw error;
  }

  /**
   * Crea el perfil desde la metadata del usuario. Solo se necesita si el trigger
   * no alcanzó a crearlo por venir datos incompletos.
   */
  async completarPerfil(): Promise<void> {
    const u = this.usuario();
    if (!u) throw new Error('Sin sesión');
    const meta: any = u.user_metadata ?? {};
    if (!meta.nombre) {
      throw new Error('Faltan datos del registro. Escríbele al docente.');
    }
    const { error } = await this.sb
      .from('perfiles')
      .insert({ id: u.id, nombre: meta.nombre });
    if (error) throw error;
    if (meta.seccion_id) await this.matricularme(meta.seccion_id);
  }

  /** Guarda el avatar elegido, en formato "estilo:semilla". */
  async guardarAvatar(clave: string): Promise<void> {
    const u = this.usuario();
    if (!u) throw new Error('Sin sesión');
    const { error } = await this.sb.from('perfiles').update({ avatar: clave }).eq('id', u.id);
    if (error) throw error;
  }

  // ---------- Puntos ----------

  async saldo(matriculaId: string): Promise<number> {
    const { data, error } = await this.sb
      .from('saldos_puntos')
      .select('saldo')
      .eq('matricula_id', matriculaId)
      .maybeSingle();
    if (error) throw error;
    return data?.saldo ?? 0;
  }

  async movimientos(matriculaId: string): Promise<Movimiento[]> {
    const { data, error } = await this.sb
      .from('movimientos_puntos')
      .select('id, puntos, motivo, creado_en')
      .eq('matricula_id', matriculaId)
      .order('creado_en', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  // ---------- Actividades ----------

  /** Las del ramo, y solo las de ese ramo. El RLS filtra igual, por si acaso. */
  async actividades(ramo: Ramo): Promise<Actividad[]> {
    const { data, error } = await this.sb
      .from('actividades')
      .select('id, codigo, titulo, descripcion, tipo, puntos, orden')
      .eq('asignatura_id', ramo.asignatura_id)
      .eq('periodo_id', ramo.periodo_id)
      .eq('activa', true)
      .order('orden');
    if (error) throw error;
    return data ?? [];
  }

  async resultados(matriculaId: string): Promise<Resultado[]> {
    const { data, error } = await this.sb
      .from('resultados_actividad')
      .select('id, actividad_id, matricula_id, detalle, completada_en')
      .eq('matricula_id', matriculaId)
      .order('completada_en', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  // ---------- Diagnóstico ----------
  // Las preguntas no se leen de la tabla: el alumno no tiene política de lectura
  // sobre ella. Entra por estas funciones, que devuelven el cuestionario sin la
  // pauta y corrigen en el servidor.

  async cuestionario(matriculaId: string): Promise<Cuestionario | null> {
    const { data, error } = await this.sb.rpc('diagnostico_cuestionario', {
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
    const { data, error } = await this.sb.rpc('rendir_diagnostico', {
      p_matricula: matriculaId,
      p_respuestas: respuestas,
    });
    if (error) throw error;
    return data as Cuestionario;
  }

  async resumenDiagnostico(actividadId: string): Promise<FilaResumenDiagnostico[]> {
    const { data, error } = await this.sb.rpc('diagnostico_resumen', {
      p_actividad: actividadId,
    });
    if (error) throw error;
    return (data ?? []) as FilaResumenDiagnostico[];
  }

  // ---------- Tienda ----------

  /** La vitrina del ramo, con el saldo y lo ya canjeado calculados por la base. */
  async vitrina(matriculaId: string): Promise<Articulo[]> {
    const { data, error } = await this.sb
      .from('vitrina')
      .select('*')
      .eq('matricula_id', matriculaId)
      .order('orden');
    if (error) throw error;
    return data ?? [];
  }

  async misCanjes(matriculaId: string): Promise<Canje[]> {
    const { data, error } = await this.sb
      .from('canjes_detalle')
      .select('*')
      .eq('matricula_id', matriculaId)
      .order('creado_en', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Canjea. Los puntos se descuentan acá mismo; si el artículo necesita visto
   * bueno queda «solicitado» y se devuelven solos si lo rechazan.
   */
  async solicitarCanje(matriculaId: string, articuloId: string, nota?: string): Promise<number> {
    const { data, error } = await this.sb.rpc('solicitar_canje', {
      p_matricula: matriculaId,
      p_articulo: articuloId,
      p_nota: nota?.trim() || null,
    });
    if (error) throw error;
    return data as number;
  }

  /** Solo mientras nadie lo ha revisado. Devuelve los puntos. */
  async cancelarCanje(canjeId: number): Promise<void> {
    const { error } = await this.sb.rpc('cancelar_canje', { p_canje: canjeId });
    if (error) throw error;
  }

  /** La bandeja del docente: lo que está esperando respuesta. */
  async canjesDelRamo(asignaturaId: string, periodoId: string): Promise<Canje[]> {
    const { data, error } = await this.sb
      .from('canjes_detalle')
      .select('*')
      .eq('asignatura_id', asignaturaId)
      .eq('periodo_id', periodoId)
      .order('creado_en', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async resolverCanje(
    canjeId: number,
    estado: 'aprobado' | 'entregado' | 'rechazado',
    comentario?: string,
  ): Promise<void> {
    const { error } = await this.sb.rpc('resolver_canje', {
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
    const { data, error } = await this.sb.rpc('ficha_alumno', { p_matricula: matriculaId });
    if (error) throw error;
    return data as Ficha | null;
  }

  // ---------- Docente ----------

  /** Solo devuelve fila si el usuario está en la tabla de docentes. */
  async esDocente(): Promise<boolean> {
    const u = this.usuario();
    if (!u) return false;
    const { data, error } = await this.sb.from('docentes').select('id').maybeSingle();
    if (error) return false;
    return !!data;
  }

  /** Lo que dicta: una fila por asignatura y periodo. */
  async ramosQueDicto(): Promise<RamoDocente[]> {
    const { data, error } = await this.sb
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
    const { data, error } = await this.sb
      .from('resumen_alumnos')
      .select('*')
      .eq('asignatura', asignaturaSigla)
      .eq('periodo', periodo)
      .order('seccion')
      .order('nombre');
    if (error) throw error;
    return data ?? [];
  }

  /** Las actividades de un ramo que dicta el docente. */
  async actividadesDe(asignaturaId: string, periodoId: string): Promise<Actividad[]> {
    const { data, error } = await this.sb
      .from('actividades')
      .select('id, codigo, titulo, descripcion, tipo, puntos, orden')
      .eq('asignatura_id', asignaturaId)
      .eq('periodo_id', periodoId)
      .order('orden');
    if (error) throw error;
    return data ?? [];
  }

  /** Otorga o descuenta puntos sobre una matrícula. Solo pasa el RLS si dicta esa sección. */
  async otorgarPuntos(matriculaId: string, puntos: number, motivo: string): Promise<void> {
    const { error } = await this.sb
      .from('movimientos_puntos')
      .insert({ matricula_id: matriculaId, puntos, motivo });
    if (error) throw error;
  }
}
