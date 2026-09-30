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

  async signOut({ scope = 'local' } = {}) {
    const { error } = await this.#db.auth.signOut({ scope });
    if (error) throw new ApiError(error.message, error);
  }

  /**
   * Rol y nombre del usuario autenticado, leídos de public.personal.
   * Un perfil ausente se considera inactivo: tanto la interfaz como RLS deniegan acceso.
   */
  async getMyProfile() {
    const { data, error } = await this.#db.from('personal').select('nombre, rol, activo').maybeSingle();
    if (error) throw new ApiError('No se pudo verificar el perfil de acceso.', error);
    if (!data) return { nombre: null, rol: 'lectura', activo: false, pendiente: true };
    return { ...data, pendiente: false };
  }

  #friendlyMessage(error) {
    if (error.message?.includes('Invalid login credentials')) return 'Correo o contraseña incorrectos.';
    if (error.message?.includes('User already registered')) return 'Ya existe una cuenta con ese correo.';
    return error.message;
  }
}
