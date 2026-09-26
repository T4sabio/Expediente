-- ============================================================================
-- 003_realtime.sql
-- Ejecutar UNA VEZ en Supabase → SQL Editor, después de 001 y 002.
--
-- Habilita Supabase Realtime (postgres_changes) en las 7 tablas clínicas.
-- Sin esto, ApiService.subscribeToPatient() se conecta pero nunca recibe
-- eventos: Realtime solo transmite cambios de tablas que están en la
-- publicación `supabase_realtime`.
--
-- Nota: como las tablas ya tienen RLS activo (002_auth_rls_audit.sql), cada
-- persona solo recibe eventos de las filas que sus políticas le permiten leer.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['DB_Pacientes','DB_SignosVitales','DB_Medicamentos',
                            'DB_Laboratorios','DB_Consultas','DB_Cultivos','DB_Pendientes']
  loop
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
exception when duplicate_object then
  -- Ya estaban agregadas (ej. si este script se corre dos veces): no pasa nada.
  null;
end $$;
