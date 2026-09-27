# Ronda Clínica — Fase 2

## Alcance

Se completan los incisos 14–21 de la auditoría de producción:

- Integración real contra Supabase/Postgres y Realtime.
- Suite E2E con Playwright.
- Auditoría automática de accesibilidad con Axe.
- Realtime con reconexión, estado visible y resincronización puntual.
- Actualizaciones optimistas con reconciliación de la fila devuelta por el servidor.
- Paginación server-side de historiales.
- SELECTs explícitos y RPCs de búsqueda/resumen de respuesta mínima.
- Índices, caché, carga diferida de Chart.js, presupuestos de rendimiento y medición de boot/expediente.

## Nuevos artefactos

`supabase/007_phase2_performance.sql` añade índices, `resumen_paciente()` y `buscar_pacientes_min()`.

`supabase/config.toml` y `supabase/seed.sql` permiten levantar un entorno local reproducible.

`supabase/tests/database/phase2_test.sql` valida la presencia de tablas, índices, funciones y RLS con pgTAP.

`tests/integration/supabase.integration.test.js` ejecuta pruebas contra una instancia Supabase real: RLS por rol, inmutabilidad de HC, expedientes eliminados, auditoría, paginación y Realtime.

`e2e/` contiene flujos de navegador, accesibilidad y rendimiento. `npm run test:browser` los ejecuta en una sola corrida de Playwright; los scripts `test:e2e`, `test:a11y` y `test:perf` permiten ejecutar cada subconjunto por separado.

## Verificación realizada en este entorno

- 63/63 pruebas unitarias y de regresión locales pasan.
- Todos los módulos JS modificados pasan `node --check`.
- Las pruebas de integración están configuradas correctamente y se omiten de forma explícita cuando no hay credenciales Supabase de prueba.
- No se pudo ejecutar aquí el build/Vite ni las pruebas de navegador porque este entorno no dispone de dependencias instaladas y el registro npm no pudo resolverse durante la instalación.

## Verificación requerida en CI/staging

El workflow de GitHub Actions arranca Supabase local, ejecuta pgTAP + integración, construye el bundle, ejecuta los tres tipos de pruebas de Playwright y termina con `npm audit`.

Antes de datos clínicos reales debe ejecutarse también una validación de staging con Supabase y revisar específicamente RLS, Realtime, tiempos de respuesta y presupuestos de rendimiento.
