-- Datos sintéticos para desarrollo local. Nunca incluir PHI real en el seed del repositorio.
insert into public."DB_Pacientes" ("HC", "Nombre_Completo", "Servicio", "Cama", "Edad", "Fecha_Ingreso", "Motivo_Consulta")
values
  ('DEV-001', 'Paciente Demo Uno', 'UCI-TEST', 'A-01', '40 años', '2026-09-27', 'Datos sintéticos para desarrollo local'),
  ('DEV-002', 'Paciente Demo Dos', 'Medicina-TEST', 'B-02', '62 años', '2026-09-26', 'Datos sintéticos para desarrollo local')
on conflict ("HC") do nothing;

insert into public."DB_SignosVitales" ("HC", "Fecha_Hora", "PA_Sistolica", "PA_Diastolica", "Frecuencia_Cardiaca", "SpO2", "Temperatura", "Frecuencia_Respiratoria")
values
  ('DEV-001', '2026-09-27T07:30:00-06:00', 120, 80, 72, 98, 36.7, 16),
  ('DEV-001', '2026-09-27T11:30:00-06:00', 122, 81, 74, 97, 36.8, 17)
;

insert into public."DB_Pendientes" ("HC", "Descripcion_Tarea", "Fecha_Solicitud", "Fecha_Programada", "Estado")
values ('DEV-001', 'Pendiente de demostración', '2026-09-27', '2026-09-27', 'Pendiente');
