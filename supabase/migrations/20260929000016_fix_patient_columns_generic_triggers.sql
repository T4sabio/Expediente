-- Los triggers son compartidos por tablas con esquemas distintos. No leer
-- columnas exclusivas de DB_Pacientes en una condición booleana compuesta:
-- PL/pgSQL puede evaluar el acceso al campo aun cuando la tabla no coincida.

create or replace function public.f_set_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new."Creado_Por" := auth.uid();
    new."Modificado_Por" := auth.uid();
    new."Modificado_En" := now();
  elsif tg_op = 'UPDATE' then
    new."Creado_Por" := old."Creado_Por";
    new."Modificado_Por" := auth.uid();
    new."Modificado_En" := now();

    if tg_table_name = 'DB_Pacientes' then
      if new."Eliminado_En" is distinct from old."Eliminado_En" then
        if public.f_mi_rol() <> 'medico' then
          raise exception 'Solo el rol médico puede eliminar o restaurar pacientes.';
        end if;
        new."Eliminado_Por" := case
          when new."Eliminado_En" is null then null
          else auth.uid()
        end;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.f_bloquear_identidad_expediente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'DB_Pacientes' then
    if old."Eliminado_En" is not null and new."Eliminado_En" is not null then
      raise exception 'El expediente está eliminado; solo puede restaurarse.' using errcode = '55000';
    end if;
  end if;

  if tg_op = 'UPDATE' and new."HC" is distinct from old."HC" then
    raise exception 'La historia clínica (HC) es inmutable.' using errcode = '22023';
  end if;

  if tg_table_name <> 'DB_Pacientes'
     and public.f_mi_rol() is not null
     and not exists (
       select 1 from public."DB_Pacientes" p
       where p."HC" = new."HC" and p."Eliminado_En" is null
     ) then
    raise exception 'No se puede operar sobre un expediente inactivo.' using errcode = '42501';
  end if;

  return new;
end;
$$;