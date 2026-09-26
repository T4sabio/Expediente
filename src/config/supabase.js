import { createClient } from '@supabase/supabase-js';

/**
 * Crea el cliente de Supabase a partir de variables de entorno de Vite (.env.local).
 * IMPORTANTE: todo lo que empieza con VITE_ termina dentro del bundle del navegador.
 * La anon key es pública por diseño; la protección real de los datos son las políticas RLS
 * (ver supabase/001_search_and_indexes.sql). Nunca pongas aquí la service_role key.
 */
export function createSupabaseClient(env = import.meta.env) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. Copia .env.example a .env.local y complétalo.');
  }
  return createClient(url, key);
}
