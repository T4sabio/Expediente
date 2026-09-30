import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/services/AuthService.js';
import { ApiError } from '../src/utils/errors.js';

function makeAuthClient({ signInError, session = null, profile, signOutError = null } = {}) {
  const signOutCalls = [];
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithPassword: async () => signInError
        ? { data: null, error: signInError }
        : { data: { session: { user: { id: 'u1' } } }, error: null },
      signOut: async (options) => {
        signOutCalls.push(options);
        return { error: signOutError };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    _test: { signOutCalls },
    from: () => ({
      select: () => ({ maybeSingle: async () => profile ?? { data: null, error: null } })
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

test('getMyProfile: una fila personal ausente queda inactiva y pendiente de aprobación', async () => {
  const auth = new AuthService(makeAuthClient());
  const profile = await auth.getMyProfile();
  assert.equal(profile.rol, 'lectura');
  assert.equal(profile.activo, false);
  assert.equal(profile.pendiente, true);
});

test('getMyProfile: un error de base no se transforma en acceso pendiente', async () => {
  const auth = new AuthService(makeAuthClient({ profile: { data: null, error: { code: 'PGRST500', message: 'database down' } } }));
  await assert.rejects(() => auth.getMyProfile(), err => err instanceof ApiError && err.code === 'PGRST500');
});

test('getMyProfile: con fila existente, devuelve el rol real', async () => {
  const auth = new AuthService(makeAuthClient({ profile: { data: { nombre: 'Dra. Ruiz', rol: 'medico', activo: true }, error: null } }));
  const profile = await auth.getMyProfile();
  assert.equal(profile.rol, 'medico');
  assert.equal(profile.pendiente, false);
});


test('signOut: solo bloquea la sesión actual, sin revocar todas las sesiones del usuario', async () => {
  const client = makeAuthClient();
  const auth = new AuthService(client);
  await auth.signOut();
  assert.deepEqual(client._test.signOutCalls, [{ scope: 'local' }]);
});
