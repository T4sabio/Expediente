import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const phase1 = read('supabase/migrations/20260929000017_phase1_security_hardening.sql');

function functionBlocks(sql) {
  const matches = [...sql.matchAll(/create(?: or replace)? function\s+/gi)];
  return matches.map(match => {
    const tail = sql.slice(match.index);
    const end = tail.search(/\n\$\$;/);
    return tail.slice(0, end === -1 ? undefined : end + 4);
  });
}


test('fase 1: no se crea SECURITY DEFINER en funciones públicas', () => {
  const publicDefiners = functionBlocks(phase1).filter(block => /^create(?: or replace)? function\s+public\./i.test(block) && /security definer/i.test(block));
  assert.equal(publicDefiners.length, 0, `No deben existir SECURITY DEFINER en public: ${publicDefiners.map(x => x.match(/^create[^\n]+/i)?.[0]).join('; ')}`);
  assert.match(phase1, /create or replace function private\.f_mi_rol/);
  assert.match(phase1, /create or replace function private\.f_registrar_auditoria/);
  assert.match(phase1, /set search_path = ''/);
  assert.match(phase1, /drop function if exists public\.f_set_auditoria\(\)/);
  assert.match(phase1, /drop function if exists public\.f_registrar_auditoria\(\)/);
});

test('fase 1: la auditoría nueva no persiste payloads ni valores clínicos', () => {
  assert.match(phase1, /private\.f_diff_fields/);
  assert.match(phase1, /solo nombres de campos, nunca valores clínicos/i);
  assert.match(phase1, /create function public\.registrar_impresion_expediente\(p_hc text, _client_metadata jsonb\)/);
  assert.match(phase1, /create function public\.registrar_exporte_expediente\(p_hc text, _client_metadata jsonb\)/);
  assert.match(phase1, /ignora deliberadamente/);
  assert.match(phase1, /perform private\.f_registrar_evento_auditoria\(p_hc, 'PRINT'\)/);
  assert.match(phase1, /perform private\.f_registrar_evento_auditoria\(p_hc, 'EXPORT'\)/);
});

test('fase 1: buscar_pacientes ya no expone la fila completa', () => {
  assert.match(phase1, /returns table \(\s*"HC" text,\s*"Nombre_Completo" text,\s*"Servicio" text,\s*"Cama" text,\s*"Edad" text\s*\)/s);
  assert.doesNotMatch(phase1, /returns setof public\."DB_Pacientes"/i);
});

test('fase 1: GraphQL público no es necesario para la aplicación', () => {
  const config = read('supabase/config.toml');
  assert.doesNotMatch(config, /graphql_public/);
});

test('fase 1: la configuración prefiere publishable key y bloquea privilegios', () => {
  const config = read('src/config/supabase.js');
  const security = read('src/utils/configSecurity.js');
  assert.match(config, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(config, /env\.VITE_SUPABASE_PUBLISHABLE_KEY \?\? env\.VITE_SUPABASE_ANON_KEY/);
  assert.match(security, /clave privilegiada/);
});

test('fase 1: los RPC de ciclo de vida dejan la autorización en RLS', () => {
  assert.match(phase1, /alter function public\.eliminar_paciente\(text, text\)\s+security invoker\s+set search_path = ''/s);
  assert.match(phase1, /alter function public\.restaurar_paciente\(text, text\)\s+security invoker\s+set search_path = ''/s);
});
