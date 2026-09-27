import { createClient } from '@supabase/supabase-js';

export const e2eEnabled = Boolean(
  process.env.SUPABASE_TEST_URL &&
  process.env.SUPABASE_TEST_ANON_KEY &&
  process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
);

export async function provisionE2EUser() {
  if (!e2eEnabled) return null;
  const admin = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const anon = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const token = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `${token}@example.test`;
  const password = `E2E-${token}!Aa9`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre: 'Usuario E2E Fase 2' } });
  if (user.error) throw user.error;
  const profile = await admin.from('personal').update({ rol: 'medico', activo: true }).eq('id', user.data.user.id);
  if (profile.error) throw profile.error;
  const hc = `E2E-${token}`;
  const patient = await admin.from('DB_Pacientes').insert({ HC: hc, Nombre_Completo: 'Paciente E2E Fase 2', Servicio: 'UCI-TEST', Cama: 'E2E-01', Edad: '40 años', Fecha_Ingreso: '2026-09-27' }).select('HC').single();
  if (patient.error) throw patient.error;
  return { admin, anon, userId: user.data.user.id, email, password, hc };
}

export async function cleanupE2E(fixtures) {
  if (!fixtures) return;
  await fixtures.admin.from('DB_Pacientes').delete().eq('HC', fixtures.hc);
  await fixtures.admin.auth.admin.deleteUser(fixtures.userId);
}

export async function login(page, fixtures) {
  await page.getByLabel('Correo institucional').fill(fixtures.email);
  await page.getByLabel('Contraseña').fill(fixtures.password);
  await page.getByRole('button', { name: /iniciar sesión/i }).click();
  await page.getByRole('heading', { name: /empieza por la ronda de hoy/i }).waitFor({ state: 'visible', timeout: 15000 });
}
