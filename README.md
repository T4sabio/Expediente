# Ronda Clínica – Dashboard

## Puesta en marcha
```bash
npm install
cp .env.example .env.local     # completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
# Supabase → SQL Editor: ejecutar EN ORDEN
#   1) supabase/001_search_and_indexes.sql
#   2) supabase/002_auth_rls_audit.sql   ← autenticación, RLS, auditoría y borrado lógico
npm run dev
npm test                       # pruebas unitarias (sin dependencias, usa node:test)
npm run build                  # salida en dist/
```

## ⚠️ Antes de tener pacientes reales (checklist de seguridad)

1. **Corre `002_auth_rls_audit.sql`.** Sin esto la anon key sigue dando acceso
   completo a cualquiera con la URL. Después de correrlo, la app exige login
   y las políticas RLS deciden en el servidor quién puede leer/escribir —
   nunca confíes solo en lo que oculta la interfaz.
2. **Da de alta al personal.** Cada persona crea su cuenta desde la pantalla
   de login (queda en rol `lectura`). Un administrador entra a Supabase →
   Table Editor → `personal` y le cambia el rol a `medico` o `enfermeria`
   según corresponda. No hay forma de auto-promoverse desde el cliente.
3. **Usa un proyecto Supabase separado para Vercel Preview.** Si conectaste
   las mismas variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` a
   Production y a Preview en Vercel, cada Pull Request que abras leerá y
   escribirá sobre datos reales de pacientes. En Vercel → Project Settings →
   Environment Variables, crea un segundo proyecto Supabase "de desarrollo"
   (mismas migraciones, datos de prueba) y asígnalo solo al ambiente
   `Preview`; deja el proyecto de producción únicamente en `Production`.
4. **Revisa la bitácora.** La tabla `public.audit_log` (creada por
   `002_auth_rls_audit.sql`) registra automáticamente cada alta/edición en
   las 7 tablas clínicas, con usuario y fecha. El "borrado" de un paciente
   es lógico (columna `Eliminado_En`/`Eliminado_Por` en `DB_Pacientes`); para
   restaurarlo, un médico puede correr en el SQL Editor:
   `update "DB_Pacientes" set "Eliminado_En" = null where "HC" = '...';`
   o usar `ApiService.restorePatient(hc)` desde la consola del navegador.

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
