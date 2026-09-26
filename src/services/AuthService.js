import { ApiError } from '../utils/errors.js';

/**
 * Única capa que conoce Supabase Auth. Expone sesión, rol del personal
 * (tabla public.personal) y los métodos de inicio/cierre de sesión.
 * El control de acceso REAL vive en las políticas RLS del servidor;
 * esto solo adapta la interfaz (ocultar botones, mostrar quién soy).
 */
export class AuthService {
  #db;

  constructor(client) {
    this.#db = client;
  }

  /** Sesión actual (o null) sin llamar a la red — Supabase la mantiene en memoria/localStorage. */
  async getSession() {
    const { data, error } = await this.#db.auth.getSession();
    if (error) throw new ApiError(error.message, error);
    return data.session;
  }

  /** Se ejecuta al iniciar y cada vez que cambia el estado de sesión (login, logout, refresh de token). */
  onAuthStateChange(callback) {
    const { data } = this.#db.auth.onAuthStateChange((_event, session) => callback(session));
    return () => data.subscription.unsubscribe();
  }

  async signInWithPassword(email, password) {
    const { data, error } = await this.#db.auth.signInWithPassword({ email, password });
    if (error) throw new ApiError(this.#friendlyMessage(error), error);
    return data.session;
  }

  async signUp(email, password, nombre) {
    const { data, error } = await this.#db.auth.signUp({
      email, password, options: { data: { nombre } }
    });
    if (error) throw new ApiError(this.#friendlyMessage(error), error);
    return data.session;
  }

  async signOut() {
    const { error } = await this.#db.auth.signOut();
    if (error) throw new ApiError(error.message, error);
  }

  /**
   * Rol y nombre del usuario autenticado, leídos de public.personal.
   * Si el usuario acaba de registrarse, el trigger del servidor aún puede no
   * haber corrido: en ese caso se asume 'lectura' (el mínimo privilegio) y no
   * se rompe la UI — las políticas RLS son las que de verdad deciden qué puede hacer.
   */
  async getMyProfile() {
    const { data, error } = await this.#db.from('personal').select('nombre, rol, activo').single();
    if (error) return { nombre: null, rol: 'lectura', activo: true, pendiente: true };
    return { ...data, pendiente: false };
  }

  #friendlyMessage(error) {
    if (error.message?.includes('Invalid login credentials')) return 'Correo o contraseña incorrectos.';
    if (error.message?.includes('User already registered')) return 'Ya existe una cuenta con ese correo.';
    if (error.message?.includes('Password should be')) return 'La contraseña debe tener al menos 6 caracteres.';
    return error.message;
  }
}
