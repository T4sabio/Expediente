import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSupabaseUrl, rejectPrivilegedJwt } from '../src/utils/configSecurity.js';

test('Supabase: producción exige HTTPS salvo localhost', () => {
  assert.equal(validateSupabaseUrl('https://example.supabase.co', 'production'), 'https://example.supabase.co');
  assert.throws(() => validateSupabaseUrl('http://example.supabase.co', 'production'), /HTTPS/);
  assert.equal(validateSupabaseUrl('http://localhost:54321/', 'production'), 'http://localhost:54321');
});

test('Supabase: rechaza JWT con rol privilegiado en el navegador', () => {
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  const syntheticHeader = Buffer.from('synthetic-test-header').toString('base64url');
  const token = `${syntheticHeader}.${payload}.synthetic-signature`;
  assert.throws(() => rejectPrivilegedJwt(token), /privilegiada/);
});
