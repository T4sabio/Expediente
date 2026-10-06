begin;
select plan(8);

select has_column('public', 'DB_SignosVitales', 'Idempotency_Key', 'signos admite clave idempotente');
select has_column('public', 'DB_Medicamentos', 'Idempotency_Key', 'medicamentos admite clave idempotente');
select has_column('public', 'DB_Medicamentos', 'Motivo_Suspension', 'la suspensión conserva el motivo');
select has_index('public', 'DB_SignosVitales', 'uq_db_signosvitales_idempotency', 'signos deduplica reintentos');
select has_index('public', 'DB_Medicamentos', 'uq_db_medicamentos_idempotency', 'medicamentos deduplica reintentos');
select has_function('public', 'registrar_lectura_expediente', ARRAY['text'], 'RPC de lectura auditada existe');
select has_function('public', 'registrar_exporte_expediente', ARRAY['text','jsonb'], 'RPC de exportación auditada existe');
select is(
  private.f_diff_fields(
    '{"Dosis_Frecuencia":"1 g IV"}'::jsonb,
    '{"Dosis_Frecuencia":"2 g IV","Nombre_Completo":"Nombre protegido"}'::jsonb
  ),
  '{"Dosis_Frecuencia":true}'::jsonb,
  'la auditoría conserva solo nombres de campos modificados y omite valores/identidad directa'
);

select * from finish();
rollback;