/**
 * Contratos de dominio para el modelo clínico canónico introducido en fase 2.
 * Estas clases no conocen Supabase ni el DOM. La capa de infraestructura será
 * responsable de convertirlas en payloads cuando el frontend migre al modelo
 * canónico en fases posteriores.
 */

const TEXT = value => {
  const text = String(value ?? '').trim();
  return text || null;
};

const DATE = value => {
  const text = TEXT(value);
  return text;
};

const DATE_TIME = value => {
  const text = TEXT(value);
  return text;
};

export class ClinicalPatientIdentifier {
  constructor(row = {}) {
    this.patientIdentifierId = row.patientIdentifierId ?? row.patient_identifier_id ?? null;
    this.patientId = row.patientId ?? row.patient_id ?? null;
    this.identifierSystem = TEXT(row.identifierSystem ?? row.identifier_system);
    this.identifierType = TEXT(row.identifierType ?? row.identifier_type);
    this.identifierValue = TEXT(row.identifierValue ?? row.identifier_value);
    this.identifierUse = TEXT(row.identifierUse ?? row.identifier_use) ?? 'usual';
  }

  toJSON() {
    return { ...this };
  }
}

export class ClinicalPatient {
  constructor(row = {}) {
    this.patientId = row.patientId ?? row.patient_id ?? null;
    this.legacyHc = TEXT(row.legacyHc ?? row.legacy_hc ?? row.HC);
    this.fullName = TEXT(row.fullName ?? row.full_name ?? row.Nombre_Completo);
    this.dateOfBirth = DATE(row.dateOfBirth ?? row.date_of_birth);
    this.sexCode = TEXT(row.sexCode ?? row.sex_code);
    this.sexDisplay = TEXT(row.sexDisplay ?? row.sex_display);
    this.residenceCountryCode = TEXT(row.residenceCountryCode ?? row.residence_country_code);
    this.residenceDepartmentCode = TEXT(row.residenceDepartmentCode ?? row.residence_department_code);
    this.residenceMunicipalityCode = TEXT(row.residenceMunicipalityCode ?? row.residence_municipality_code);
    this.residenceLocalityCode = TEXT(row.residenceLocalityCode ?? row.residence_locality_code);
    this.urbanRural = TEXT(row.urbanRural ?? row.urban_rural);
    this.legacyAgeText = TEXT(row.legacyAgeText ?? row.legacy_age_text ?? row.Edad);
  }

  toJSON() {
    return { ...this };
  }
}

export class ClinicalEncounter {
  constructor(row = {}) {
    this.encounterId = row.encounterId ?? row.encounter_id ?? null;
    this.patientId = row.patientId ?? row.patient_id ?? null;
    this.encounterType = TEXT(row.encounterType ?? row.encounter_type) ?? 'inpatient';
    this.status = TEXT(row.status) ?? 'unknown';
    this.admittedAt = DATE_TIME(row.admittedAt ?? row.admitted_at);
    this.dischargedAt = DATE_TIME(row.dischargedAt ?? row.discharged_at);
    this.admissionPrecision = TEXT(row.admissionPrecision ?? row.admission_precision) ?? 'unknown';
    this.dischargePrecision = TEXT(row.dischargePrecision ?? row.discharge_precision) ?? 'unknown';
    this.ageAtEncounterValue = row.ageAtEncounterValue ?? row.age_at_encounter_value ?? null;
    this.ageAtEncounterUnit = TEXT(row.ageAtEncounterUnit ?? row.age_at_encounter_unit);
    this.reasonText = TEXT(row.reasonText ?? row.reason_text);
    this.serviceText = TEXT(row.serviceText ?? row.service_text);
    this.bedText = TEXT(row.bedText ?? row.bed_text);
    this.dispositionText = TEXT(row.dispositionText ?? row.disposition_text);
  }

  toJSON() {
    return { ...this };
  }
}

export class ClinicalCondition {
  constructor(row = {}) {
    this.conditionId = row.conditionId ?? row.condition_id ?? null;
    this.patientId = row.patientId ?? row.patient_id ?? null;
    this.encounterId = row.encounterId ?? row.encounter_id ?? null;
    this.code = TEXT(row.code);
    this.codeSystem = TEXT(row.codeSystem ?? row.code_system);
    this.displayText = TEXT(row.displayText ?? row.display_text);
    this.clinicalStatus = TEXT(row.clinicalStatus ?? row.clinical_status) ?? 'unknown';
    this.verificationStatus = TEXT(row.verificationStatus ?? row.verification_status) ?? 'unknown';
    this.onsetAt = DATE_TIME(row.onsetAt ?? row.onset_at);
    this.recordedAt = DATE_TIME(row.recordedAt ?? row.recorded_at);
  }

  toJSON() {
    return { ...this };
  }
}

export class ClinicalObservation {
  constructor(row = {}) {
    this.observationId = row.observationId ?? row.observation_id ?? null;
    this.patientId = row.patientId ?? row.patient_id ?? null;
    this.encounterId = row.encounterId ?? row.encounter_id ?? null;
    this.observedAt = DATE_TIME(row.observedAt ?? row.observed_at);
    this.category = TEXT(row.category) ?? 'other';
    this.code = TEXT(row.code);
    this.codeSystem = TEXT(row.codeSystem ?? row.code_system);
    this.displayText = TEXT(row.displayText ?? row.display_text);
    this.valueNumeric = row.valueNumeric ?? row.value_numeric ?? null;
    this.valueText = TEXT(row.valueText ?? row.value_text);
    this.valueBoolean = row.valueBoolean ?? row.value_boolean ?? null;
    this.unitCode = TEXT(row.unitCode ?? row.unit_code);
    this.referenceLow = row.referenceLow ?? row.reference_low ?? null;
    this.referenceHigh = row.referenceHigh ?? row.reference_high ?? null;
    this.abnormalFlag = TEXT(row.abnormalFlag ?? row.abnormal_flag);
  }

  hasValue() {
    return this.valueNumeric !== null && this.valueNumeric !== undefined
      || this.valueText !== null
      || this.valueBoolean !== null && this.valueBoolean !== undefined;
  }

  toJSON() {
    return { ...this };
  }
}

export class ClinicalMedicationOrder {
  constructor(row = {}) {
    this.medicationOrderId = row.medicationOrderId ?? row.medication_order_id ?? null;
    this.patientId = row.patientId ?? row.patient_id ?? null;
    this.encounterId = row.encounterId ?? row.encounter_id ?? null;
    this.medicationDisplay = TEXT(row.medicationDisplay ?? row.medication_display);
    this.medicationCode = TEXT(row.medicationCode ?? row.medication_code);
    this.medicationCodeSystem = TEXT(row.medicationCodeSystem ?? row.medication_code_system);
    this.doseFrequencyText = TEXT(row.doseFrequencyText ?? row.dose_frequency_text);
    this.doseValue = row.doseValue ?? row.dose_value ?? null;
    this.doseUnit = TEXT(row.doseUnit ?? row.dose_unit);
    this.routeText = TEXT(row.routeText ?? row.route_text);
    this.frequencyHours = row.frequencyHours ?? row.frequency_hours ?? null;
    this.startOn = DATE(row.startOn ?? row.start_on);
    this.stopOn = DATE(row.stopOn ?? row.stop_on);
    this.status = TEXT(row.status) ?? 'unknown';
    this.plannedDurationDays = row.plannedDurationDays ?? row.planned_duration_days ?? null;
    this.requiresFollowupDays = Boolean(row.requiresFollowupDays ?? row.requires_followup_days);
    this.suspensionReason = TEXT(row.suspensionReason ?? row.suspension_reason);
  }

  toJSON() {
    return { ...this };
  }
}

export class ClinicalConsultation {
  constructor(row = {}) {
    this.consultationId = row.consultationId ?? row.consultation_id ?? null;
    this.patientId = row.patientId ?? row.patient_id ?? null;
    this.encounterId = row.encounterId ?? row.encounter_id ?? null;
    this.departmentText = TEXT(row.departmentText ?? row.department_text);
    this.sentAt = DATE_TIME(row.sentAt ?? row.sent_at);
    this.responseAt = DATE_TIME(row.responseAt ?? row.response_at);
    this.responseText = TEXT(row.responseText ?? row.response_text);
    this.status = TEXT(row.status) ?? 'unknown';
  }

  toJSON() {
    return { ...this };
  }
}

export class ClinicalTask {
  constructor(row = {}) {
    this.taskId = row.taskId ?? row.task_id ?? null;
    this.patientId = row.patientId ?? row.patient_id ?? null;
    this.encounterId = row.encounterId ?? row.encounter_id ?? null;
    this.description = TEXT(row.description);
    this.requestedOn = DATE(row.requestedOn ?? row.requested_on);
    this.scheduledOn = DATE(row.scheduledOn ?? row.scheduled_on);
    this.completedAt = DATE_TIME(row.completedAt ?? row.completed_at);
    this.status = TEXT(row.status) ?? 'unknown';
    this.notes = TEXT(row.notes);
  }

  toJSON() {
    return { ...this };
  }
}

export class ClinicalSpecimen {
  constructor(row = {}) {
    this.specimenId = row.specimenId ?? row.specimen_id ?? null;
    this.patientId = row.patientId ?? row.patient_id ?? null;
    this.encounterId = row.encounterId ?? row.encounter_id ?? null;
    this.typeDisplay = TEXT(row.typeDisplay ?? row.type_display);
    this.collectedAt = DATE_TIME(row.collectedAt ?? row.collected_at);
  }

  toJSON() {
    return { ...this };
  }
}

export class ClinicalMicrobiologyResult {
  constructor(row = {}) {
    this.microbiologyResultId = row.microbiologyResultId ?? row.microbiology_result_id ?? null;
    this.specimenId = row.specimenId ?? row.specimen_id ?? null;
    this.sentAt = DATE_TIME(row.sentAt ?? row.sent_at);
    this.resultedAt = DATE_TIME(row.resultedAt ?? row.resulted_at);
    this.resultText = TEXT(row.resultText ?? row.result_text);
    this.comments = TEXT(row.comments);
    this.status = TEXT(row.status) ?? 'unknown';
    this.recurring = Boolean(row.recurring);
    this.intervalHours = row.intervalHours ?? row.interval_hours ?? null;
  }

  toJSON() {
    return { ...this };
  }
}
