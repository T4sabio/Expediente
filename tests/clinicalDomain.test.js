import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ClinicalPatient,
  ClinicalPatientIdentifier,
  ClinicalEncounter,
  ClinicalCondition,
  ClinicalObservation,
  ClinicalMedicationOrder,
  ClinicalConsultation,
  ClinicalTask,
  ClinicalSpecimen,
  ClinicalMicrobiologyResult
} from '../src/models/ClinicalDomain.js';

test('ClinicalPatientIdentifier: separa el identificador clínico de la identidad técnica', () => {
  const identifier = new ClinicalPatientIdentifier({
    patient_identifier_id: 'id-1',
    patient_id: 'patient-1',
    identifier_system: 'legacy:ronda-clinica',
    identifier_type: 'medical-record-number',
    identifier_value: 'HC-001'
  });
  assert.equal(identifier.patientId, 'patient-1');
  assert.equal(identifier.identifierType, 'medical-record-number');
  assert.equal(identifier.identifierValue, 'HC-001');
});

test('ClinicalPatient: separa identidad interna de HC legacy y conserva demografía nullable', () => {
  const patient = new ClinicalPatient({
    patient_id: 'uuid-1',
    legacy_hc: 'HC-001',
    full_name: 'Paciente Demo',
    date_of_birth: null,
    sex_code: null,
    residence_department_code: null,
    legacy_age_text: '40 años'
  });
  assert.equal(patient.patientId, 'uuid-1');
  assert.equal(patient.legacyHc, 'HC-001');
  assert.equal(patient.dateOfBirth, null);
  assert.equal(patient.legacyAgeText, '40 años');
});

test('ClinicalEncounter: mantiene precisión de fecha y snapshot de edad', () => {
  const encounter = new ClinicalEncounter({
    encounter_id: 'enc-1',
    patient_id: 'pat-1',
    admitted_at: '2026-09-27T06:00:00-06:00',
    admission_precision: 'date',
    age_at_encounter_value: 40,
    age_at_encounter_unit: 'years'
  });
  assert.equal(encounter.encounterId, 'enc-1');
  assert.equal(encounter.admissionPrecision, 'date');
  assert.equal(encounter.ageAtEncounterValue, 40);
  assert.equal(encounter.ageAtEncounterUnit, 'years');
});

test('ClinicalCondition: no inventa codificación para diagnóstico legacy', () => {
  const condition = new ClinicalCondition({
    display_text: 'Hipertensión arterial + diabetes mellitus',
    code: null,
    code_system: 'legacy-free-text'
  });
  assert.equal(condition.displayText, 'Hipertensión arterial + diabetes mellitus');
  assert.equal(condition.code, null);
  assert.equal(condition.codeSystem, 'legacy-free-text');
});

test('ClinicalObservation: soporta valores numéricos, textuales y booleanos', () => {
  const numeric = new ClinicalObservation({ value_numeric: 120, unit_code: 'mm[Hg]' });
  const text = new ClinicalObservation({ value_text: 'Positivo' });
  const boolean = new ClinicalObservation({ value_boolean: true });
  assert.equal(numeric.hasValue(), true);
  assert.equal(text.hasValue(), true);
  assert.equal(boolean.hasValue(), true);
});

test('ClinicalMedicationOrder: diferencia orden de medicamento de administración', () => {
  const order = new ClinicalMedicationOrder({
    medication_display: 'Cefepime',
    dose_frequency_text: '2 g IV cada 8 h',
    status: 'active'
  });
  assert.equal(order.medicationDisplay, 'Cefepime');
  assert.equal(order.status, 'active');
  assert.equal('administrationAt' in order, false);
});

test('Clinical records secundarios conservan contratos específicos', () => {
  const consultation = new ClinicalConsultation({ department_text: 'Cardiología', status: 'open' });
  const task = new ClinicalTask({ description: 'Revisar laboratorio', status: 'pending' });
  const specimen = new ClinicalSpecimen({ type_display: 'Hemocultivo' });
  const micro = new ClinicalMicrobiologyResult({ specimen_id: specimen.specimenId, status: 'pending' });
  assert.equal(consultation.departmentText, 'Cardiología');
  assert.equal(task.status, 'pending');
  assert.equal(specimen.typeDisplay, 'Hemocultivo');
  assert.equal(micro.status, 'pending');
});
