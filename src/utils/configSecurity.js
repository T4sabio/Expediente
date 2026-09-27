export function validateSupabaseUrl(rawUrl, mode = 'production') {
  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { throw new Error('VITE_SUPABASE_URL no es una URL válida.'); }

  const localHttp = parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1');
  if (mode !== 'development' && parsed.protocol !== 'https:' && !localHttp) {
    throw new Error('VITE_SUPABASE_URL debe usar HTTPS fuera del desarrollo local.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function rejectPrivilegedJwt(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3 || typeof globalThis.atob !== 'function') return;
  try {
    const payload = JSON.parse(globalThis.atob(
      parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - parts[1].length % 4) % 4)
    ));
    if (payload?.role && !['anon', 'authenticated'].includes(payload.role)) {
      throw new Error('VITE_SUPABASE_ANON_KEY parece ser una clave privilegiada y no puede usarse en el navegador.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('clave privilegiada')) throw err;
  }
}
