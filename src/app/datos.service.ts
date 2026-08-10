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
  creado_en: string;
}

export interface Movimiento {
  id: number;
  puntos: number;
  motivo: string;
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
      .select('id, nombre, seccion_id, creado_en, secciones(codigo, asignaturas(sigla, nombre))')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const seccion: any = (data as any).secciones;
    return {
      id: data.id,
      nombre: data.nombre,
      seccion_id: data.seccion_id,
      creado_en: data.creado_en,
      seccion: seccion?.codigo ?? '—',
      asignatura: seccion?.asignaturas
        ? `${seccion.asignaturas.sigla} · ${seccion.asignaturas.nombre}`
        : '—',
    };
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

  async misMovimientos(): Promise<Movimiento[]> {
    const { data, error } = await this.sb
      .from('movimientos_puntos')
      .select('id, puntos, motivo, creado_en')
      .order('creado_en', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
}
