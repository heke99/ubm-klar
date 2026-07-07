/** Confidentiality / Integrity / Availability levels (KLASSA-style 0-3 scale). */
export type CiaLevel = 0 | 1 | 2 | 3;

export interface CiaClassification {
  confidentiality: CiaLevel;
  integrity: CiaLevel;
  availability: CiaLevel;
}

/** Data classes used by ABAC decisions, masking, export gating and retention. */
export type DataClass =
  | 'public'
  | 'internal'
  | 'personal_data'
  | 'protected_identity'
  | 'children_data'
  | 'health_medical'
  | 'income_data'
  | 'housing_social_circumstance'
  | 'bank_account_payment_recipient'
  | 'security_classified';

export const SENSITIVE_DATA_CLASSES: readonly DataClass[] = [
  'personal_data',
  'protected_identity',
  'children_data',
  'health_medical',
  'income_data',
  'housing_social_circumstance',
  'bank_account_payment_recipient',
  'security_classified',
] as const;

/** Data classes that always require a recorded reason before reveal. */
export const REASON_REQUIRED_DATA_CLASSES: readonly DataClass[] = [
  'protected_identity',
  'children_data',
  'health_medical',
  'income_data',
  'bank_account_payment_recipient',
  'security_classified',
] as const;

export function isSensitiveDataClass(dataClass: DataClass): boolean {
  return SENSITIVE_DATA_CLASSES.includes(dataClass);
}

export function requiresRevealReason(dataClass: DataClass): boolean {
  return REASON_REQUIRED_DATA_CLASSES.includes(dataClass);
}

export type DocumentSensitivity = 'standard' | 'sensitive' | 'medical' | 'protected_identity';
