import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('fase 2: API usa selects explícitos y paginación', () => {
  const src = read('src/services/ApiService.js');
  assert.match(src, /DEFAULT_PAGE_SIZE/);
  assert.match(src, /count:\s*'exact'/);
  assert.match(src, /select\(SELECTS\[listKey\]/);
  assert.doesNotMatch(src, /\.select\(\s*'\*'\s*\)/);
});

test('fase 2: Realtime soporta reconexión y estado de canal', () => {
  const src = read('src/services/ApiService.js');
  assert.match(src, /CHANNEL_ERROR/);
  assert.match(src, /TIMED_OUT/);
  assert.match(src, /scheduleReconnect/);
  assert.match(src, /stableChannelKey/);
});

test('fase 2: pruebas de integración, E2E y axe están configuradas', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:integration'], 'node --test tests/integration/*.test.js');
  assert.equal(pkg.scripts['test:e2e'], 'playwright test e2e/smoke.spec.js');
  assert.equal(pkg.scripts['test:browser'], 'playwright test');
  assert.equal(pkg.scripts['test:a11y'], 'playwright test e2e/accessibility.spec.js');
  assert.equal(pkg.devDependencies['@playwright/test'], '1.63.0');
  assert.equal(pkg.devDependencies['@axe-core/playwright'], '4.13.0');
  assert.match(pkg.scripts['test:all'], /test:browser/);
});

test('fase 2: Supabase local está versionado y el CI ejecuta DB/E2E', () => {
  assert.match(read('supabase/config.toml'), /\[realtime\]/);
  assert.match(read('README.md'), /supabase db reset/);
  assert.match(read('README.md'), /npm run test:a11y/);
  assert.match(read('README.md'), /npm run test:perf/);
  assert.match(read('.github/workflows/ci.yml'), /supabase test db/);
  assert.match(read('.github/workflows/ci.yml'), /npm run test:integration/);
  assert.match(read('.github/workflows/ci.yml'), /npm run test:browser/);
  assert.match(read('.github/workflows/ci.yml'), /VITE_SUPABASE_URL=/);
});
