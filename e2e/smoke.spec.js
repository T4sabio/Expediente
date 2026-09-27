import { test, expect } from '@playwright/test';
import { cleanupE2E, e2eEnabled, login, provisionE2EUser } from './helpers.js';

let fixtures;

test.beforeAll(async () => { fixtures = await provisionE2EUser(); });
test.afterAll(async () => { await cleanupE2E(fixtures); });

test('shell de autenticación funciona', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Ronda Clínica')).toBeVisible();
  await expect(page.getByLabel('Correo institucional')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
});

test('shell de producto expone ronda de hoy y command palette', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /abrir comandos/i }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /empieza por la ronda de hoy/i })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+KeyK');
  await expect(page.getByRole('dialog', { name: /comandos de ronda clínica/i })).toBeVisible();
});

test('flujo E2E autenticado: login, búsqueda y apertura de expediente', async ({ page }) => {
  test.skip(!e2eEnabled, 'El E2E autenticado necesita un Supabase de prueba local/CI.');
  await page.goto('/');
  await login(page, fixtures);
  const search = page.getByRole('combobox', { name: /buscar paciente/i });
  await search.fill(fixtures.hc);
  const option = page.getByRole('option').filter({ hasText: fixtures.hc }).first();
  await expect(option).toBeVisible({ timeout: 10000 });
  await option.click();
  await expect(page.getByRole('heading', { name: 'Resumen clínico' })).toBeVisible();
  await expect(page.getByText(fixtures.hc, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /novedades/i }).click();
  await expect(page.getByRole('heading', { name: 'Línea temporal' })).toBeVisible();
});
