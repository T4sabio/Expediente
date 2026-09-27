# Fase 1 — Hardening de producción

## Alcance

Esta entrega aplica el hardening prioritario identificado en la auditoría del proyecto. El ZIP original no se sobrescribe; esta es una copia de trabajo preparada para revisión/despliegue.

## Correcciones incluidas

### Seguridad y privacidad
- Eliminado el sink XSS de la cabecera de impresión: datos del paciente pasan por nodos DOM/textContent en lugar de interpolarse directamente.
- Añadido escaping y regresiones XSS para datos dinámicos renderizados desde la base.
- Sentry queda configurado con `sendDefaultPii: false`, sin breadcrumbs/request/user, con `beforeSend` y allowlist de contexto técnico.
- Los errores de backend ya no se convierten en mensajes de producto que puedan filtrar HC/PHI hacia telemetría.
- La lectura de `audit_log` queda restringida a `medico`.
- Los eventos nuevos de auditoría guardan solo los campos modificados, no snapshots completos. Los registros históricos ya existentes no se destruyen automáticamente y deben revisarse conforme a la política de retención.

### Integridad y RLS
- Creada `supabase/006_hardening_produccion.sql`, para ejecutarse después de `005`.
- `HC` queda inmutable en pacientes y tablas clínicas hijas mediante trigger.
- Las tablas hijas solo permiten lectura/escritura cuando el expediente sigue activo.
- Pacientes eliminados lógicamente quedan fuera de las lecturas rutinarias.
- Mientras un paciente permanece eliminado, no se permiten ediciones ordinarias; el flujo permitido es su restauración por un médico.
- Se restringen funciones privilegiadas y se endurece `search_path` de funciones `SECURITY DEFINER`.
- Añadidas constraints de dominio para longitudes, rangos, fechas y periodicidad (inicialmente `NOT VALID` para no bloquear datos históricos).
- Realtime queda idempotente tabla por tabla.

### Autenticación y sesión
- El arranque de la aplicación ahora espera (`await`) la inicialización del controlador.
- Los errores reales al leer el perfil no se interpretan como “pendiente de aprobación”.
- Cuentas marcadas explícitamente como inactivas no entran al dashboard.
- El cierre de sesión usa alcance local.
- Añadido bloqueo automático por 15 minutos de inactividad, con acción manual “Bloquear sesión”.
- Volver desde una pestaña en segundo plano no reinicia el contador si el tiempo de inactividad ya venció.
- El estado visual de rol se limpia correctamente al cerrar sesión.

### Configuración y despliegue
- Validación de `VITE_SUPABASE_URL` y rechazo de claves JWT privilegiadas en el navegador.
- Añadidos headers de seguridad para Vercel (`CSP`, `HSTS`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors`).
- Añadido `.nvmrc` con Node 22.16.0.
- CI de GitHub Actions con tests, build y auditoría de dependencias.
- `package.json` actualizado con versiones directas fijadas y scripts de verificación.
- Documentación actualizada para aplicar las migraciones `000` → `006` en orden.

## Verificación realizada

- Tests unitarios/regresión: **57/57 pasando**.
- `node --check`: **OK** para todo el código JS de `src` y `tests`.
- Validación JSON de `package.json` y `vercel.json`: **OK**.
- Comprobación estática de identificadores SQL frente al esquema existente: **OK**.
- Comprobación de ausencia de archivos de secretos locales en el paquete: solo permanece `.env.example`.

## Verificación pendiente / limitaciones del entorno

El build de producción no pudo ejecutarse en este entorno porque no existe `node_modules` y el registro npm no fue resoluble por DNS. La generación offline del lockfile también falló porque los metadatos de las dependencias no estaban en caché.

Por ello, esta entrega **no afirma que el bundle final haya sido compilado en este entorno**. Antes de activar datos clínicos reales se debe ejecutar, desde un entorno con acceso al registro npm:

```bash
npm install
npm test
npm run build
npm audit --audit-level=high
```

y generar/confirmar `package-lock.json`, tras lo cual CI debe usar `npm ci`.

También debe ejecutarse la migración `006` sobre una base de staging Supabase y validar RLS/Realtime mediante pruebas de integración/E2E antes de producción.

## Orden de despliegue recomendado

1. Aplicar `supabase/000_*.sql` a `supabase/006_hardening_produccion.sql` en orden.
2. Corregir cualquier dato histórico que impida validar posteriormente las constraints `NOT VALID`.
3. En staging, ejecutar pruebas de autenticación, RLS, eliminación/restauración, auditoría y Realtime.
4. Generar y comprometer `package-lock.json`.
5. Ejecutar CI completo (`test`, `build`, `audit`).
6. Promover a producción solo después de verificar el entorno Supabase real y las políticas de sesión.
