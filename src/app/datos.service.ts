import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { ENTORNO } from '../entorno';

export interface Asignatura {
  id: string;
  sigla: string;
  nombre: string;
}

export interface Seccion {
  id: string;
  codigo: string;
  asignatura_id: string;
}

export interface Perfil {
  id: string;
  nombre: string;
  seccion_id: string;
  avatar: string;
  creado_en: string;
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
  perfil_id: string;
  detalle: any;
  completada_en: string;
}

export interface ResumenAlumno {
  id: string;
  nombre: string;
  avatar: string;
  seccion: string;
  asignatura: string;
  puntos: number;
  creado_en: string;
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

  async asignaturas(): Promise<Asignatura[]> {
    const { data, error } = await this.sb
      .from('asignaturas')
      .select('id, sigla, nombre')
      .order('sigla');
    if (error) throw error;
    return data ?? [];
  }

  async secciones(asignaturaId: string): Promise<Seccion[]> {
    const { data, error } = await this.sb
      .from('secciones')
      .select('id, codigo, asignatura_id')
      .eq('asignatura_id', asignaturaId)
      .order('codigo');
    if (error) throw error;
    return data ?? [];
  }

  // ---------- Autenticación ----------

  /**
   * Registra al alumno. El nombre y la sección viajan como metadata: un trigger
   * en la base crea el perfil con esos datos y otorga los puntos de bienvenida.
   * Devuelve si quedó con sesión abierta (depende de si el proyecto exige
   * confirmar el correo).
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

  // ---------- Perfil y puntos ----------

  /** El perfil propio, con su sección y asignatura. null si aún no existe. */
  async miPerfil(): Promise<(Perfil & { seccion: string; asignatura: string }) | null> {
    const { data, error } = await this.sb
      .from('perfiles')
      .select('id, nombre, seccion_id, avatar, creado_en, secciones(codigo, asignaturas(sigla, nombre))')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const seccion: any = (data as any).secciones;
    return {
      id: data.id,
      nombre: data.nombre,
      seccion_id: data.seccion_id,
      avatar: data.avatar,
      creado_en: data.creado_en,
      seccion: seccion?.codigo ?? '—',
      asignatura: seccion?.asignaturas
        ? `${seccion.asignaturas.sigla} · ${seccion.asignaturas.nombre}`
        : '—',
    };
  }

  /** Guarda el avatar elegido, en formato "estilo:semilla". */
  async guardarAvatar(clave: string): Promise<void> {
    const u = this.usuario();
    if (!u) throw new Error('Sin sesión');
    const { error } = await this.sb.from('perfiles').update({ avatar: clave }).eq('id', u.id);
    if (error) throw error;
  }

  /**
   * Crea el perfil desde la metadata del usuario. Solo se necesita si el
   * trigger no alcanzó a crearlo por venir datos incompletos.
   */
  async completarPerfil(): Promise<void> {
    const u = this.usuario();
    if (!u) throw new Error('Sin sesión');
    const meta: any = u.user_metadata ?? {};
    if (!meta.nombre || !meta.seccion_id) {
      throw new Error('Faltan datos del registro. Escríbele al docente.');
    }
    const { error } = await this.sb
      .from('perfiles')
      .insert({ id: u.id, nombre: meta.nombre, seccion_id: meta.seccion_id });
    if (error) throw error;
  }

  async miSaldo(): Promise<number> {
    const { data, error } = await this.sb.from('saldos_puntos').select('saldo').maybeSingle();
    if (error) throw error;
    return data?.saldo ?? 0;
  }

  // ---------- Actividades ----------

  async actividades(): Promise<Actividad[]> {
    const { data, error } = await this.sb
      .from('actividades')
      .select('id, codigo, titulo, descripcion, tipo, puntos, orden')
      .order('orden');
    if (error) throw error;
    return data ?? [];
  }

  async actividad(codigo: string): Promise<Actividad | null> {
    const { data, error } = await this.sb
      .from('actividades')
      .select('id, codigo, titulo, descripcion, tipo, puntos, orden')
      .eq('codigo', codigo)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Los resultados propios; para un docente, los de todo el curso. */
  async resultados(): Promise<Resultado[]> {
    const { data, error } = await this.sb
      .from('resultados_actividad')
      .select('id, actividad_id, perfil_id, detalle, completada_en')
      .order('completada_en', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Registra el resultado. Los puntos los agrega un trigger, no el cliente.
   * La restricción única impide rehacer la actividad para volver a cobrarlos.
   */
  async registrarResultado(actividadId: string, detalle: unknown): Promise<void> {
    const u = this.usuario();
    if (!u) throw new Error('Sin sesión');
    const { error } = await this.sb
      .from('resultados_actividad')
      .insert({ actividad_id: actividadId, perfil_id: u.id, detalle: detalle as any });
    if (error) throw error;
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

  /** El curso completo. Un alumno solo se vería a sí mismo: lo filtra el RLS. */
  async resumenAlumnos(): Promise<ResumenAlumno[]> {
    const { data, error } = await this.sb
      .from('resumen_alumnos')
      .select('id, nombre, avatar, seccion, asignatura, puntos, creado_en')
      .order('seccion')
      .order('nombre');
    if (error) throw error;
    return data ?? [];
  }

  /** Otorga o descuenta puntos. Solo pasa el RLS si quien llama es docente. */
  async otorgarPuntos(perfilId: string, puntos: number, motivo: string): Promise<void> {
    const { error } = await this.sb
      .from('movimientos_puntos')
      .insert({ perfil_id: perfilId, puntos, motivo });
    if (error) throw error;
  }

  async misMovimientos(): Promise<Movimiento[]> {
    const { data, error } = await this.sb
      .from('movimientos_puntos')
      .select('id, puntos, motivo, creado_en')
      .order('creado_en', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
}
