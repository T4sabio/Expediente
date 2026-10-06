# Fase 1 — Security Hardening

## Implementado

- Helpers privilegiados movidos a `private` y con `search_path = ''`.
- RLS usa `private.f_mi_rol()`.
- Funciones públicas que solo necesitaban RLS pasan a `SECURITY INVOKER`.
- Auditoría de INSERT/UPDATE registra nombres de campos, no valores clínicos.
- READ/PRINT/EXPORT ya no confían ni persisten payload JSON del cliente; se conservan wrappers compatibles que ignoran metadata histórica.
- `buscar_pacientes` deja de devolver filas completas.
- `graphql_public` se retiró de los schemas expuestos porque la aplicación no lo utiliza.
- El cliente prefiere `VITE_SUPABASE_PUBLISHABLE_KEY`, con fallback temporal a `VITE_SUPABASE_ANON_KEY`.
- `@supabase/supabase-js` se actualizó en manifest/lock a 2.117.2; la instalación completa no pudo regenerarse en este entorno por timeout de red.
- CI usa `supabase/setup-cli@v3` en lugar de `@v1`; la CLI concreta sigue sin fijarse aquí porque el workflow original usa `version: latest`.

## Pendiente para fases posteriores

MFA operativo, rate limiting específico de aplicación, separación multi-hospital, modelo clínico longitudinal, capa analítica/pseudonimizada, OMOP, FHIR, R y disaster recovery todavía no están implementados en esta fase.

## Validación en este entorno

- `npm run test:security`: 6/6 pruebas pasan.
- `npm run test:unit`: 122/122 pruebas pasan.
- `npm run build`: no pudo ejecutarse porque la instalación local de dependencias quedó incompleta tras un timeout de red; `vite` no estaba disponible.
- `npm audit --audit-level=high`: no pudo consultar el registro de npm por error DNS/red (`EAI_AGAIN registry.npmjs.org`).
- Las migraciones SQL nuevas no se ejecutaron contra un PostgreSQL/Supabase real en este entorno porque no está disponible una instancia/CLI operativa para aplicarlas. Deben validarse contra la base local/CI antes del despliegue.

Por estas limitaciones, esta fase **no debe considerarse una certificación de seguridad ni un pentest**.
