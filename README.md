# Ronda Clínica – Dashboard

## Puesta en marcha
```bash
npm ci
cp .env.example .env.local     # completa VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY
# Supabase → SQL Editor: ejecutar EN ORDEN
#   0) supabase/000_schema.sql            ← crea las 7 tablas (solo en un proyecto NUEVO/vacío)
#   1) supabase/001_search_and_indexes.sql
#   2) supabase/002_auth_rls_audit.sql   ← autenticación, RLS, auditoría y borrado lógico
#   3) supabase/003_realtime.sql          ← tiempo real (Supabase Realtime)
#   4) supabase/004_correcciones_produccion.sql ← columna faltante y límites de texto
#   5) supabase/005_pam_antibioticos_cultivos_periodicos.sql ← PAM/seguimiento/cultivos periódicos
#   6) supabase/006_hardening_produccion.sql ← hardening final de producción
#   7) supabase/007_phase2_performance.sql
#   8) supabase/008_phase3_product.sql
#   9) supabase/009_auth_approval_required.sql ← bloquea altas y exige aprobación
#  10) supabase/010_patient_lifecycle_rpc.sql ← borrado/restauración con motivo auditado
#  11) supabase/011_fechas_zona_guatemala.sql ← fechas clínicas en calendario local
#  12) supabase/012_round_print_audit.sql ← ronda completa y auditoría de impresión
#  13) supabase/013_permissions_idempotency_audit.sql ← permisos finos, idempotencia y auditoría minimizada
# La CLI aplica las copias versionadas de supabase/migrations/; aplica 014, 015 y 016 después de 013 en proyectos alojados.
npm run dev
npm test                       # pruebas unitarias (sin dependencias, usa node:test)
npm run build                  # salida en dist/
```

## ⚠️ Antes de tener pacientes reales (checklist de seguridad)

1. **Corre todas las migraciones, incluida `013_permissions_idempotency_audit.sql`.** Sin
   `002_auth_rls_audit.sql` la anon key sigue dando acceso
   completo a cualquiera con la URL. Después de correrlo, la app exige login
   y las políticas RLS deciden en el servidor quién puede leer/escribir.
2. **Desactiva el registro público en el proyecto Supabase desplegado.**
   `supabase/config.toml` lo aplica al entorno local; en proyectos alojados,
   desactiva los registros en Authentication → Settings y exige confirmación
   de correo. Crea usuarios mediante invitación administrativa.
3. **Aprueba al personal explícitamente.** La migración deja inactivas las cuentas
   existentes con rol `lectura`; revísalas en Table Editor → `personal` y activa
   solo las verificadas. Las nuevas altas se crean inactivas y no leen expedientes
   hasta que un administrador establezca `activo = true` y asigne el rol adecuado.
4. **Usa un proyecto Supabase separado para Vercel Preview.** Si conectaste
   las mismas variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` a
   Production y a Preview en Vercel, cada Pull Request que abras leerá y
   escribirá sobre datos reales de pacientes. En Vercel → Project Settings →
   Environment Variables, crea un segundo proyecto Supabase "de desarrollo"
   (mismas migraciones, datos de prueba) y asígnalo solo al ambiente
   `Preview`; deja el proyecto de producción únicamente en `Production`.
5. **Revisa la bitácora.** La tabla `public.audit_log` (creada por
  `002_auth_rls_audit.sql`) registra altas/ediciones, lecturas y solicitudes
  de impresión/exportación. Desde `013`, las ediciones guardan solo campos
  modificados con valores anterior/nuevo, y se eliminan los snapshots históricos
  completos. El "borrado" de un paciente
  es lógico (columna `Eliminado_En`/`Eliminado_Por` en `DB_Pacientes`); un médico puede usar el botón **Restaurar** de la aplicación e indicar HC y motivo. El borrado y la restauración se realizan mediante RPC y registran el motivo en la bitácora.
   No se recomienda editar `DB_Pacientes` directamente en el SQL Editor, porque la
   integridad del expediente y la auditoría se aplican mediante triggers/RLS.

## Arquitectura
```
src/
├── main.js                     # composición: crea dependencias y arranca
├── config/supabase.js          # cliente Supabase desde variables de entorno
├── models/                     # entidades con reglas de negocio (sin DOM, sin red)
│   ├── Patient.js  VitalSigns.js  Medication.js  ClinicalRecords.js  PatientRecord.js
├── services/ApiService.js      # ÚNICA capa que habla con Supabase
├── state/AppState.js           # store inmutable con suscripciones
├── controllers/DashboardController.js   # eventos → servicio → estado → vistas
├── views/                      # HTML/DOM: DashboardView, ModalManager, Toast, ChartManager, sections/*
└── utils/                      # constants.js, formatters.js (fechas/edad/escape), errors.js
```
Flujo: `evento DOM → Controller → ApiService → AppState.set() → Controller reacciona → Views dibujan`.

Nueva pestaña: crear `views/sections/<nombre>.js`, registrarla en `sections/index.js` y en `SECTIONS` (constants.js).

## Accesibilidad y UX (segunda pasada)

- **Teclado**: los paneles de resumen (`summaryPanel`) ahora son `<button>` reales; los
  modales tienen *focus trap* (Tab no se escapa), foco inicial en el primer campo y el
  foco regresa a quien abrió el modal al cerrarlo (`ModalManager.js`).
- **Cierre de modal**: clic en el fondo oscuro cierra el modal (además de Escape/Cancelar).
- **Toasts**: se apilan (ya no se pisan) y usan `aria-live`/`role="alert"` (`Toast.js`).
- **Gráficos accesibles**: cada gráfico de signos vitales tiene una tabla `sr-only`
  equivalente con la tendencia en texto ("en aumento/descenso/estable").
- **No depender solo del color**: los valores anormales llevan además un ícono ▲/▼
  con `aria-label` ("alto"/"bajo").
- **Buscador**: tiene `<label>` accesible (oculto visualmente) y anuncia el número de
  resultados en una región `aria-live`; muestra un spinner mientras busca.
- **Validación de formularios**: el campo inválido se marca en rojo con el mensaje
  justo debajo (`views/formValidation.js`), en vez de solo un toast al final.
- **Tiempo real (Supabase Realtime)**: si otra persona registra algo del mismo
  paciente, el expediente se refresca solo (`ApiService.subscribeToPatient`).
  Requiere correr `supabase/003_realtime.sql`.
- **UI optimista**: suspender medicamento / marcar pendiente actualizan la pantalla
  al instante y revierten solo si el servidor rechaza el cambio.
- **Tiempo relativo**: "Última toma: hace 12 min" en el resumen (`fmtRelative`).
- **Imprimir/Exportar**: confirma el paciente y registra la solicitud en auditoría;
  incluye todas las páginas de los historiales, la línea temporal y el gráfico de signos.
- **Conflictos de edición**: al editar un paciente se guarda el sello de la última
  modificación conocida; si alguien más ya guardó cambios, el guardado se rechaza con
  un aviso claro en vez de sobrescribir en silencio.


## Fase 1 — hardening de producción

Antes de exponer la aplicación a datos clínicos reales, ejecuta `supabase/006_hardening_produccion.sql` después de `005`. Esta migración endurece RLS, hace inmutable la HC, protege expedientes eliminados, restringe la bitácora al rol médico, añade restricciones de dominio y vuelve idempotente la activación de Realtime.

La sesión de navegador se bloquea automáticamente después de 15 minutos sin actividad y requiere iniciar sesión de nuevo. El botón de sesión también bloquea la sesión actual. El cierre utiliza alcance local para no revocar sesiones del mismo usuario en otros dispositivos.

El proyecto requiere Node.js 22.12+ y fija las versiones directas del toolchain. `package-lock.json` fija también las dependencias transitivas; CI instala con `npm ci`.

## Fase 2 — confiabilidad, integración y rendimiento

La Fase 2 añade una ruta reproducible de verificación y optimiza la carga de expedientes largos.

### Supabase local

Requiere Docker y Supabase CLI. El proyecto ya incluye `supabase/config.toml` y datos sintéticos en `supabase/seed.sql`.

```bash
supabase start
supabase db reset
supabase test db
```

`supabase/migrations/` contiene las migraciones versionadas que descubre la CLI. `db reset` las aplica en orden (`000` → `015`) y carga únicamente datos sintéticos de desarrollo. Los SQL numerados en la raíz de `supabase/` se conservan como fuentes para el SQL Editor en proyectos alojados.

### Pruebas contra Supabase real

```bash
SUPABASE_TEST_URL=http://127.0.0.1:54321 \
SUPABASE_TEST_PUBLISHABLE_KEY=... \
SUPABASE_TEST_SERVICE_ROLE_KEY=... \
npm run test:integration
```

Las pruebas cubren RLS por rol, inmutabilidad de HC, expedientes eliminados, auditoría, paginación y Realtime con Postgres real.

### E2E, accesibilidad y rendimiento

```bash
npm run test:e2e
npm run test:a11y
npm run test:perf
# o todo el conjunto de navegador en una sola ejecución:
npm run test:browser
```

Playwright ejecuta el bundle construido mediante Vite Preview; Axe valida automáticamente la interfaz contra reglas WCAG y el test de performance mantiene presupuestos para carga, transferencia y número de requests del shell inicial.

### Paginación y carga mínima

El expediente inicial carga solo la primera página de cada historial (25 filas por defecto), un resumen agregado server-side y las columnas necesarias para cada sección. Las páginas siguientes se solicitan bajo demanda. Realtime parchea la página visible y resincroniza únicamente la sección activa después de una reconexión, en lugar de descargar de nuevo las siete tablas.

### CI

GitHub Actions arranca Supabase local, ejecuta las pruebas pgTAP, las pruebas de integración contra Postgres/Realtime, construye el bundle, ejecuta E2E/a11y/performance y termina con `npm audit`.

## Fase 3 — producto clínico premium

Después de aplicar `006_hardening_produccion.sql` y `007_phase2_performance.sql`, despliega `008_phase3_product.sql` y continúa con las migraciones `009` a `012` en orden.

La versión de Fase 3 añade:

- Ronda de hoy sobre pacientes activos, ordenada por servicio/cama.
- Línea temporal clínica consolidada y última actividad.
- Centro de novedades por expediente; la marca de "revisado" guarda únicamente timestamps y claves hash en el navegador, nunca contenido clínico.
- Indicador visible de sincronización (`En vivo`, `Sincronizando`, `Sin conexión`) y última sincronización.
- Densidad de interfaz compacta/normal/cómoda y alto contraste persistentes.
- Command palette con `Ctrl/Cmd + K`.
- Impresión de expediente con cabecera de confidencialidad y pie profesional.

### Orden de migraciones

`000_schema.sql` → `001_search_and_indexes.sql` → `002_auth_rls_audit.sql` → `003_realtime.sql` → `004_correcciones_produccion.sql` → `005_pam_antibioticos_cultivos_periodicos.sql` → `006_hardening_produccion.sql` → `007_phase2_performance.sql` → `008_phase3_product.sql` → `009_auth_approval_required.sql` → `010_patient_lifecycle_rpc.sql` → `011_fechas_zona_guatemala.sql` → `012_round_print_audit.sql` → `013_permissions_idempotency_audit.sql` → `014_resumen_clinico_y_contexto.sql` → `015_estado_episodio_y_umbral.sql` → `016_fix_patient_columns_generic_triggers.sql`.

Después de 013, ejecutar `014_resumen_clinico_y_contexto.sql`, `015_estado_episodio_y_umbral.sql` y `016_fix_patient_columns_generic_triggers.sql`, en ese orden.

## Fase 4 — confiabilidad clínica y permisos

Aplica `013_permissions_idempotency_audit.sql` después de `012`. Esta migración
restringe altas/ediciones demográficas y cambios de estado de medicamentos al
rol médico, añade claves únicas para reintentos seguros, captura el motivo de
suspensión, registra lecturas y solicitudes de salida, y depura los snapshots
completos históricos de auditoría. Enfermería conserva las operaciones clínicas
permitidas por las políticas existentes, pero no puede editar pacientes ni
suspender medicamentos.

El diálogo nativo del navegador no informa a la aplicación si la persona eligió
impresora o "Guardar como PDF"; ambos se registran como solicitud de impresión y
exportación iniciada, no como confirmación de que el archivo se haya guardado.

Las pruebas de base de datos están en `supabase/tests/database/phase2_test.sql`, `phase3_test.sql` y `phase4_test.sql`; se ejecutan mediante `supabase test db` en CI.

## Fase 5 — contexto clínico y egresos

La migración 014 agrega el antecedente explícito de EPOC, el oxígeno por toma y la hora de envío de cultivos periódicos. La RPC de resumen prioriza los tratamientos de mayor duración, conserva periodicidad tras un resultado y expone atrasos aunque no estén en la página visible. La migración 015 permite registrar traslado, alta o defunción y sacar esos episodios de la ronda; el umbral de signos se configura por paciente (1–720 h) y la duración prevista por medicamento.

- **Build Vite 8/Rolldown:** la segmentación manual usa `build.rolldownOptions.output.codeSplitting`; no se utiliza la forma objeto obsoleta de `manualChunks`.
