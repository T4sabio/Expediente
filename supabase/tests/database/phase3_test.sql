begin;
select plan(8);

select has_function('public', 'ronda_hoy', ARRAY['text','integer'], 'RPC de ronda diaria existe');
select has_function('public', 'timeline_paciente', ARRAY['text','integer'], 'RPC de timeline existe');
select has_function('public', 'ultima_actividad_paciente', ARRAY['text'], 'RPC de última actividad existe');
select has_function('public', 'registrar_impresion_expediente', ARRAY['text','jsonb'], 'RPC de auditoría de impresión existe');
select has_index('public', 'idx_pacientes_ronda_servicio_cama', 'índice de ronda por servicio/cama existe');
select has_index('public', 'idx_vitals_hc_modificado_desc', 'índice de actividad de signos existe');
select has_index('public', 'idx_meds_hc_activo_modificado', 'índice de actividad de medicamentos existe');
select has_index('public', 'idx_cult_hc_modificado_desc', 'índice de actividad de cultivos existe');
select has_index('public', 'idx_tasks_hc_modificado_desc', 'índice de actividad de pendientes existe');

select * from finish();
rollback;
