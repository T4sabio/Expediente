import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubContext, __testing } from '../src/utils/errorReporter.js';

test('scrubContext aplica allowlist y elimina identificadores', () => {
  const clean = scrubContext({
    origin: 'form',
    formId: 'form-med',
    hc: '2026-37294',
    name: 'Ana Pérez',
    email: 'ana@example.com',
    operation: 'update'
  });
  assert.deepEqual(clean, { origin: 'form', formId: 'form-med', operation: 'update' });
});

test('safeError nunca conserva el mensaje original', () => {
  const err = new Error('No se encontró ningún paciente con HC = 2026-37294');
  err.code = 'DB_LOOKUP';
  const safe = __testing.safeError(err);
  assert.equal(safe.message, 'Client exception [DB_LOOKUP]');
  assert.doesNotMatch(safe.message, /2026-37294/);
});
