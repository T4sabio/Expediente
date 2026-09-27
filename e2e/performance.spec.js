import { test, expect } from '@playwright/test';

test('presupuesto de rendimiento del shell inicial', async ({ page }) => {
  await page.goto('/');
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const sameOrigin = resources.filter(r => r.name.startsWith(location.origin));
    return {
      domContentLoaded: nav?.domContentLoadedEventEnd ?? 0,
      loadEvent: nav?.loadEventEnd ?? 0,
      sameOriginTransfer: sameOrigin.reduce((sum, r) => sum + (r.transferSize || 0), 0),
      jsRequests: sameOrigin.filter(r => r.initiatorType === 'script').length,
      cssRequests: sameOrigin.filter(r => r.initiatorType === 'link' || r.name.endsWith('.css')).length
    };
  });
  expect(metrics.domContentLoaded).toBeLessThan(4000);
  expect(metrics.sameOriginTransfer).toBeLessThan(1_500_000);
  expect(metrics.jsRequests).toBeLessThan(15);
  test.info().annotations.push({ type: 'performance', description: JSON.stringify(metrics) });
});
