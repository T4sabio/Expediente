import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtDate, fmtDateTime, calendarDateOf, todayISODate, daysBetween,
  wallTimeToOffsetISO, formatEdad, parseEdad, escapeHtml
} from '../src/utils/formatters.js';

test('fecha calendario no se corre un día en Guatemala', () => {
  assert.equal(fmtDate('2026-09-24'), '24/09/2026');
});

test('un instante UTC se muestra en hora de Guatemala', () => {
  // 03:00 UTC del 25 = 21:00 del 24 en Guatemala (UTC-6)
  assert.equal(calendarDateOf('2026-09-25T03:00:00Z'), '2026-09-24');
  assert.match(fmtDateTime('2026-09-25T03:00:00Z'), /^24\/0?9 /);
});

test('"hoy" usa Guatemala y no UTC', () => {
  assert.equal(todayISODate(new Date('2026-09-25T03:00:00Z')), '2026-09-24');
  assert.equal(todayISODate(new Date('2026-09-25T07:00:00Z')), '2026-09-25');
});

test('datetime-local se convierte con offset -06:00 explícito', () => {
  assert.equal(wallTimeToOffsetISO('2026-09-24T14:30'), '2026-09-24T14:30:00-06:00');
  assert.equal(new Date(wallTimeToOffsetISO('2026-09-24T14:30')).toISOString(), '2026-09-24T20:30:00.000Z');
  assert.equal(wallTimeToOffsetISO('basura'), null);
});

test('daysBetween cuenta días calendario', () => {
  assert.equal(daysBetween('2026-09-01', '2026-09-24'), 23);
  assert.equal(daysBetween('2026-09-24', '2026-09-01'), 0);
  assert.equal(daysBetween('x', '2026-09-01'), null);
});

test('edad: formato y lectura', () => {
  assert.equal(formatEdad(1, 'años'), '1 año');
  assert.equal(formatEdad(3, 'meses'), '3 meses');
  assert.deepEqual(parseEdad('2 semanas'), { valor: '2', unidad: 'semanas' });
  assert.deepEqual(parseEdad('', 'meses'), { valor: '', unidad: 'meses' });
});

test('escapeHtml neutraliza etiquetas', () => {
  assert.equal(escapeHtml('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
});
