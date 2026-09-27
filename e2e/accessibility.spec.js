import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { cleanupE2E, e2eEnabled, login, provisionE2EUser } from './helpers.js';

let fixtures;
test.beforeAll(async () => { fixtures = await provisionE2EUser(); });
test.afterAll(async () => { await cleanupE2E(fixtures); });

test('página de autenticación no presenta violaciones WCAG automáticas', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('dashboard autenticado no presenta violaciones WCAG automáticas', async ({ page }) => {
  test.skip(!e2eEnabled, 'El E2E autenticado necesita un Supabase de prueba local/CI.');
  await page.goto('/');
  await login(page, fixtures);
  await page.getByRole('button', { name: new RegExp(fixtures.hc) }).click();
  await page.getByRole('button', { name: /novedades/i }).click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
