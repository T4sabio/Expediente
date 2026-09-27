# Ronda Clínica – Dashboard

## Puesta en marcha
```bash
npm install
cp .env.example .env.local     # completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
# Supabase → SQL Editor: ejecutar EN ORDEN
#   0) supabase/000_schema.sql            ← crea las 7 tablas (solo en un proyecto NUEVO/vacío)
#   1) supabase/001_search_and_indexes.sql
#   2) supabase/002_auth_rls_audit.sql   ← autenticación, RLS, auditoría y borrado lógico
#   3) supabase/003_realtime.sql          ← tiempo real (Supabase Realtime)
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
- **Imprimir/Exportar**: botón en la barra superior que arma una vista con todas las
  secciones y abre el diálogo de impresión del navegador (puede guardarse como PDF).
- **Conflictos de edición**: al editar un paciente se guarda el sello de la última
  modificación conocida; si alguien más ya guardó cambios, el guardado se rechaza con
  un aviso claro en vez de sobrescribir en silencio.
