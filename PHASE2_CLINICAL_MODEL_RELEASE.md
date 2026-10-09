# Fase 2 — Modelo clínico longitudinal

## Estado

Implementación de Fase 2 terminada en código y validación estática. La migración SQL **aún debe ejecutarse contra PostgreSQL/Supabase real** antes de considerarla validada en base de datos.

## Implementado

- Nuevo schema canónico `clinical`, fuera de los schemas expuestos por PostgREST.
- Identidad técnica UUID para `clinical.patient`.
- `legacy_hc` conservado como identificador legacy único.
- `clinical.patient_identifier` para separar identificadores clínicos de la identidad técnica.
- Modelo longitudinal de `encounter`.
- Entidades separadas: `condition`, `observation`, `medication_order`, `consultation`, `task`, `specimen`, `microbiology_result`.
- Catálogo interno mínimo de conceptos para signos vitales; **no sustituye LOINC/SNOMED/ICD/ATC/UCUM**.
- Backfill de datos existentes desde las tablas `DB_*`.
- Triggers de compatibilidad `legacy -> canonical` para mantener sincronizada la nueva capa mientras la UI siga escribiendo en `DB_*`.
- Trazabilidad mediante `source_system` y `source_key`.
- RLS habilitado en la nueva capa y privilegios directos retirados de `anon`/`authenticated`.
- Privilegios por defecto de funciones endurecidos en `private` y `clinical` para evitar EXECUTE implícito sobre funciones nuevas.
- Diagnósticos legacy preservados como `legacy-free-text`; no se inventan códigos clínicos.
- Edad legacy preservada como texto y snapshot estructurado en el encuentro cuando el formato es reconocible; no se infiere fecha de nacimiento.
- Signos vitales y laboratorios convergen en `clinical.observation`.
- Medicamentos modelados como órdenes, no como administración real.
- Microbiología separada en `specimen` + `microbiology_result`.
- Modelos de dominio JS independientes de Supabase/DOM.
- Tests unitarios y de contrato para el nuevo dominio y la migración.

## Deliberadamente no implementado

- LOINC/SNOMED/ICD/ATC/UCUM y mappings oficiales.
- OMOP.
- FHIR.
- Analytics/pseudonimización.
- Multi-hospital completo.
- Migración de la UI desde `DB_*` a `clinical.*`.
- Administración farmacológica real.
- Microorganismos y susceptibilidad estructurada.
- Eliminación de las tablas legacy.

## Migración

Archivo principal:

`supabase/migrations/20260929000018_clinical_longitudinal_model.sql`

Copia de referencia:

`supabase/018_clinical_longitudinal_model.sql`

**No se deben ejecutar ambos.**

## Validación realizada

```text
34/34 tests Node seleccionados — PASS
node --check src/models/ClinicalDomain.js — PASS
Los dos archivos SQL de la migración son idénticos — PASS
```

## Validación pendiente

No se pudo ejecutar la migración contra un PostgreSQL/Supabase real en el entorno de desarrollo de esta entrega porque no están disponibles `psql`, la CLI de Supabase ni un servidor PostgreSQL y no hubo acceso de red para instalar un parser SQL.

Por ello, antes de aplicar en producción, ejecutar la migración en un entorno local/staging y correr `supabase test db` con PostgreSQL real.
