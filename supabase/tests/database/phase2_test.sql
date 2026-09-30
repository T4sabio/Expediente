begin;
select plan(11);

select has_table('public', 'DB_Pacientes', 'tabla de pacientes existe');
select has_table('public', 'audit_log', 'audit log existe');
select has_index('public', 'idx_signos_hc_fecha_desc', 'índice de signos por HC/fecha existe');
select has_index('public', 'idx_meds_hc_activos', 'índice parcial de medicamentos activos existe');
select has_index('public', 'idx_cons_hc_sin_respuesta', 'índice parcial de interconsultas sin respuesta existe');
select has_index('public', 'idx_pend_hc_abiertos', 'índice parcial de pendientes abiertos existe');
select has_function('public', 'resumen_paciente', ARRAY['text'], 'RPC de resumen existe');
select has_function('public', 'buscar_pacientes_min', ARRAY['text','text','integer'], 'RPC de búsqueda mínima existe');
select ok((select relrowsecurity from pg_class where oid = 'public."DB_Pacientes"'::regclass), 'RLS de pacientes habilitado');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass), 'RLS de audit log habilitado');
select lives_ok(
	$test$
	do $body$
	begin
		insert into public."DB_Pacientes" ("HC", "Nombre_Completo", "Servicio")
		values ('TRIGGER-CHECK-016', 'Paciente de prueba de trigger', 'Pruebas');
		insert into public."DB_Pendientes" ("HC", "Descripcion_Tarea")
		values ('TRIGGER-CHECK-016', 'Comprobar UPDATE del trigger genérico');
		update public."DB_Pendientes"
		set "Estado" = 'Realizado'
		where "HC" = 'TRIGGER-CHECK-016';
	end;
	$body$
	$test$,
	'actualizar un pendiente no intenta leer columnas exclusivas del paciente'
);

select * from finish();
rollback;
