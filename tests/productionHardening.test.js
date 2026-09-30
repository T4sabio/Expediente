import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

test('impresión: los campos de paciente no se interpolan directamente en innerHTML', () => {
  const src = fs.readFileSync(path.join(root, 'src/controllers/DashboardController.js'), 'utf8');
  assert.doesNotMatch(src, /innerHTML\s*=\s*`[\s\S]*\$\{g\.Nombre_Completo\}/);
});

test('telemetría: Sentry se inicializa sin PII y con beforeSend', () => {
  const src = fs.readFileSync(path.join(root, 'src/utils/errorReporter.js'), 'utf8');
  assert.match(src, /sendDefaultPii:\s*false/);
  assert.match(src, /beforeSend\(event\)/);
  assert.match(src, /delete event\.request/);
});

test('migración 006 existe y contiene controles críticos de RLS/inmutabilidad', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/006_hardening_produccion.sql'), 'utf8');
  assert.match(sql, /es inmutable/);
  assert.match(sql, /f_paciente_activo/);
  assert.match(sql, /solo medico puede leer bitacora/);
});

test('triggers genéricos no leen Eliminado_En fuera de DB_Pacientes', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/016_fix_patient_columns_generic_triggers.sql'), 'utf8');
  assert.match(sql, /if tg_table_name = 'DB_Pacientes' then\s+if new\."Eliminado_En"/);
  assert.match(sql, /tg_op = 'UPDATE' and tg_table_name = 'DB_Pacientes' then\s+if old\."Eliminado_En"/);
  assert.doesNotMatch(sql, /tg_table_name = 'DB_Pacientes' and (?:new|old)\."Eliminado_En"/);
});

test('fechas clínicas derivadas usan el servidor y el calendario de Guatemala', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/011_fechas_zona_guatemala.sql'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'src/services/ApiService.js'), 'utf8');
  assert.match(sql, /Fecha_Solicitud[\s\S]*America\/Guatemala/);
  assert.match(sql, /f_set_fechas_clinicas_guatemala/);
  assert.match(sql, /Fecha_Omision/);
  assert.match(sql, /Fecha_Respuesta/);
  assert.match(sql, /Fecha_Resultado/);
  assert.match(sql, /Fecha_Completado[\s\S]*pg_catalog\.now\(\)/);
  assert.doesNotMatch(api, /todayISODate|new Date\(\)/);
});


test('migración 006 usa columnas reales del esquema clínico', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/006_hardening_produccion.sql'), 'utf8');
  assert.match(sql, /Nombre_Medicamento/);
  assert.match(sql, /Tipo_Lab/);
  assert.match(sql, /Departamento_Consultado/);
  assert.match(sql, /Descripcion_Tarea/);
  assert.doesNotMatch(sql, /\"Pregunta\"/);
});

test('auth: altas públicas deshabilitadas y perfiles de lectura requieren aprobación', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/009_auth_approval_required.sql'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  const login = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(config, /enable_signup\s*=\s*false/);
  assert.match(config, /enable_confirmations\s*=\s*true/);
  assert.match(sql, /activo set default false/);
  assert.match(sql, /'lectura',[\s\S]*false/);
  assert.match(sql, /where rol = 'lectura' and activo/);
  assert.doesNotMatch(login, /Crear una cuenta|toggle-signup/);
});

test('realtime 003 es idempotente tabla por tabla', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/003_realtime.sql'), 'utf8');
  assert.match(sql, /pg_publication_tables/);
  assert.doesNotMatch(sql, /exception when duplicate_object/);
});


test('sesión: el cambio de visibilidad no reinicia por sí solo el temporizador de inactividad', () => {
  const src = fs.readFileSync(path.join(root, 'src/controllers/DashboardController.js'), 'utf8');
  assert.match(src, /#handleVisibilityChange\(\)/);
  assert.match(src, /elapsed >= DashboardController\.IDLE_TIMEOUT_MS/);
  assert.match(src, /document\.addEventListener\('visibilitychange', this\.#visibilityHandler/);
});

test('configuración: se bloquean URL inseguras y claves JWT privilegiadas', () => {
  const src = fs.readFileSync(path.join(root, 'src/utils/configSecurity.js'), 'utf8');
  assert.match(src, /debe usar HTTPS/);
  assert.match(src, /clave privilegiada/);
});

test('despliegue: publica headers de seguridad', () => {
  const config = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /X-Content-Type-Options/);
  assert.match(config, /frame-ancestors 'none'/);
});


test('dependencias: las versiones directas están fijadas', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const value of Object.values(pkg.dependencies ?? {})) assert.doesNotMatch(value, /^[\^~]/);
  for (const value of Object.values(pkg.devDependencies ?? {})) assert.doesNotMatch(value, /^[\^~]/);
});
