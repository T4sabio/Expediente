# Modelo clínico longitudinal — Fase 2

## Objetivo

La fase 2 introduce un modelo canónico longitudinal sin retirar todavía las tablas legacy consumidas por la interfaz actual.

La dirección del modelo es:

```text
Patient
  └── Encounter
       ├── Condition
       ├── Observation
       ├── MedicationOrder
       ├── Consultation
       ├── Task
       └── Specimen
             └── MicrobiologyResult
```

## Identidad

`clinical.patient.patient_id` es la identidad técnica canónica (UUID). `legacy_hc` conserva la historia clínica existente como identificador de compatibilidad; ya no es la clave primaria del paciente canónico. `clinical.patient_identifier` separa los identificadores clínicos de la identidad técnica y deja preparada la incorporación de identificadores adicionales en fases posteriores.

## Tiempo

Los datos de episodio usan `timestamptz`. Cuando el origen legacy solo contiene una fecha, se conserva `admission_precision = 'date'` o `discharge_precision = 'date'` y se convierte la fecha a medianoche de `America/Guatemala` únicamente para permitir ordenamiento temporal sin fingir precisión horaria.

## Edad

La edad no se usa como identidad demográfica permanente. Cuando el origen legacy solo aporta texto como `40 años` o `6 meses`, se conserva como `legacy_age_text` y, para el encuentro migrado, se intenta extraer un snapshot estructurado `age_at_encounter_value` + `age_at_encounter_unit`.

No se infiere fecha de nacimiento a partir de una edad histórica.

## Diagnósticos

El texto actual de `DB_Pacientes.Diagnosticos` se migra como narrativa no codificada (`code_system = legacy-free-text`). No se inventan códigos ICD, SNOMED u otros. La codificación terminológica queda para una fase posterior.

## Observaciones

Signos vitales y laboratorios convergen en `clinical.observation`. Cada resultado tiene:

- categoría;
- código/sistema cuando existe;
- texto descriptivo;
- valor numérico, textual o booleano;
- unidad;
- fecha/hora;
- trazabilidad al registro legacy.

Los signos vitales del sistema actual utilizan códigos internos `ronda-clinica` estables. Los mappings a LOINC/otras terminologías se harán posteriormente.

## Medicación

`clinical.medication_order` representa una orden/estado terapéutico. No debe interpretarse como evidencia de administración real. La administración efectiva se incorporará posteriormente si el caso de uso clínico lo requiere.

## Microbiología

La fase 2 separa `specimen` de `microbiology_result`. Todavía no se modelan microorganismos ni susceptibilidad antimicrobiana estructurada; eso requiere un diseño específico posterior.

## Compatibilidad

Mientras la interfaz use las tablas `DB_*`, triggers privados mantienen sincronizado el modelo canónico. El modelo `clinical` permanece fuera de los schemas expuestos por PostgREST y sin privilegios para `anon`/`authenticated`.
