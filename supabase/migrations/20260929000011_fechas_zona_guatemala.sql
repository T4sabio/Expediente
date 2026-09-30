-- Las fechas clínicas derivadas de acciones se calculan en el servidor y usan
-- el calendario local de Guatemala, independientemente del timezone de sesión.

alter table public."DB_Pendientes"
  alter column "Fecha_Solicitud"
  set default ((pg_catalog.now() at time zone 'America/Guatemala')::date);

create or replace function public.f_set_fechas_clinicas_guatemala()
returns trigger
language plpgsql
set search_path = '' as $$
declare
  fecha_guatemala date := (pg_catalog.now() at time zone 'America/Guatemala')::date;
begin
  if tg_table_name = 'DB_Medicamentos' then
    if tg_op = 'UPDATE'
      and old."Activo" is distinct from new."Activo"
      and new."Activo" = 'No' then
      new."Fecha_Omision" := fecha_guatemala;
    end if;
  elsif tg_table_name = 'DB_Consultas' then
    if tg_op = 'UPDATE'
      and old."Respuesta_Departamento" is null
      and nullif(pg_catalog.btrim(new."Respuesta_Departamento"), '') is not null then
      new."Fecha_Respuesta" := fecha_guatemala;
    end if;
  elsif tg_table_name = 'DB_Cultivos' then
    if tg_op = 'UPDATE'
      and (old."Resultado" is null or old."Resultado" = 'Pendiente')
      and new."Resultado" is not null
      and new."Resultado" <> 'Pendiente' then
      new."Fecha_Resultado" := fecha_guatemala;
    end if;
  elsif tg_table_name = 'DB_Pendientes' then
    if tg_op = 'UPDATE' and old."Estado" is distinct from new."Estado" then
      if new."Estado" = 'Realizado' then
        new."Fecha_Completado" := pg_catalog.now();
      elsif new."Estado" = 'Pendiente' then
        new."Fecha_Completado" := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fechas_guatemala on public."DB_Medicamentos";
create trigger trg_fechas_guatemala
  before update on public."DB_Medicamentos"
  for each row execute function public.f_set_fechas_clinicas_guatemala();

drop trigger if exists trg_fechas_guatemala on public."DB_Consultas";
create trigger trg_fechas_guatemala
  before update on public."DB_Consultas"
  for each row execute function public.f_set_fechas_clinicas_guatemala();

drop trigger if exists trg_fechas_guatemala on public."DB_Cultivos";
create trigger trg_fechas_guatemala
  before update on public."DB_Cultivos"
  for each row execute function public.f_set_fechas_clinicas_guatemala();

drop trigger if exists trg_fechas_guatemala on public."DB_Pendientes";
create trigger trg_fechas_guatemala
  before update on public."DB_Pendientes"
  for each row execute function public.f_set_fechas_clinicas_guatemala();