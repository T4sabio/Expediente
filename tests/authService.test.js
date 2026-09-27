import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/services/AuthService.js';
import { ApiError } from '../src/utils/errors.js';

function makeAuthClient({ signInError, session = null, profile } = {}) {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithPassword: async () => signInError
        ? { data: null, error: signInError }
        : { data: { session: { user: { id: 'u1' } } }, error: null },
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    from: () => ({
      select: () => ({ single: async () => profile ?? { data: null, error: { code: '42501', message: 'no row' } } })
    })
  };
}

test('signInWithPassword: credenciales inválidas dan un mensaje en español, no el mensaje crudo de Supabase', async () => {
  const auth = new AuthService(makeAuthClient({ signInError: { message: 'Invalid login credentials' } }));
  await assert.rejects(
    () => auth.signInWithPassword('a@b.com', 'x'),
    err => err instanceof ApiError && err.message === 'Correo o contraseña incorrectos.'
  );
});

test('signInWithPassword: éxito devuelve la sesión', async () => {
  const auth = new AuthService(makeAuthClient());
  const session = await auth.signInWithPassword('a@b.com', 'x');
  assert.equal(session.user.id, 'u1');
});

test('getMyProfile: si la fila de "personal" todavía no existe (RLS/trigger no ha corrido), asume rol "lectura" sin romper la UI', async () => {
  const auth = new AuthService(makeAuthClient());
  const profile = await auth.getMyProfile();
  assert.equal(profile.rol, 'lectura');
  assert.equal(profile.pendiente, true);
});

test('getMyProfile: con fila existente, devuelve el rol real', async () => {
  const auth = new AuthService(makeAuthClient({ profile: { data: { nombre: 'Dra. Ruiz', rol: 'medico', activo: true }, error: null } }));
  const profile = await auth.getMyProfile();
  assert.equal(profile.rol, 'medico');
  assert.equal(profile.pendiente, false);
});
