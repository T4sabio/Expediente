-- ============================================================================
-- 009_auth_approval_required.sql
-- Aplicar en proyectos existentes después de las migraciones 002–008.
-- Las cuentas de solo lectura requieren aprobación explícita antes de acceder.
-- ============================================================================

alter table public.personal alter column activo set default false;

-- No es posible distinguir las altas públicas previas de lectores aprobados.
-- Se bloquean para revisión; reactivar únicamente al personal validado.
update public.personal
set activo = false
where rol = 'lectura' and activo;

create or replace function public.f_nuevo_usuario_personal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.personal (id, nombre, rol, activo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', new.email),
    'lectura',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;