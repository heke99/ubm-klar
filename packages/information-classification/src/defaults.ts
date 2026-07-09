import { ClassificationRegistry, type ClassificationRecord } from '@ubm-klar/data-classification';

/**
 * Default information classification for the UBM Klar data plane.
 * Municipalities can adjust via admin UI; these are the shipped defaults and
 * they are deliberately conservative.
 */
export const DEFAULT_CLASSIFICATIONS: ClassificationRecord[] = [
  {
    targetKind: 'field',
    targetKey: 'persons.personal_identity_number',
    cia: { confidentiality: 3, integrity: 3, availability: 2 },
    dataClass: 'personal_data',
    maskedByDefault: true,
    revealRequiresReason: true,
    exportRequiresApproval: true,
    motivation: 'Direct identifier',
  },
  {
    targetKind: 'field',
    targetKey: 'persons.protected_identity',
    cia: { confidentiality: 3, integrity: 3, availability: 2 },
    dataClass: 'protected_identity',
    maskedByDefault: true,
    revealRequiresReason: true,
    exportRequiresApproval: true,
    motivation: 'Protected identity marker (skyddad identitet)',
  },
  {
    targetKind: 'field',
    targetKey: 'ea_declared_income.amount',
    cia: { confidentiality: 3, integrity: 3, availability: 2 },
    dataClass: 'income_data',
    maskedByDefault: true,
    revealRequiresReason: true,
    exportRequiresApproval: true,
    motivation: 'Income data',
  },
  {
    targetKind: 'field',
    targetKey: 'payment_recipient_registry.account_reference',
    cia: { confidentiality: 3, integrity: 3, availability: 2 },
    dataClass: 'bank_account_payment_recipient',
    maskedByDefault: true,
    revealRequiresReason: true,
    exportRequiresApproval: true,
    motivation: 'Payment account reference',
  },
  {
    targetKind: 'document_type',
    targetKey: 'medical_certificate',
    cia: { confidentiality: 3, integrity: 3, availability: 2 },
    dataClass: 'health_medical',
    maskedByDefault: true,
    revealRequiresReason: true,
    exportRequiresApproval: true,
    motivation: 'Medical documents require elevated access',
  },
  {
    targetKind: 'document_type',
    targetKey: 'lss_need_assessment',
    cia: { confidentiality: 3, integrity: 3, availability: 2 },
    dataClass: 'health_medical',
    maskedByDefault: true,
    revealRequiresReason: true,
    exportRequiresApproval: true,
    motivation: 'Need assessments contain health data',
  },
  {
    targetKind: 'export',
    targetKey: 'ubm-export',
    cia: { confidentiality: 3, integrity: 3, availability: 2 },
    dataClass: 'personal_data',
    maskedByDefault: false,
    revealRequiresReason: false,
    exportRequiresApproval: true,
    motivation: 'UBM exports always require maker-checker approval',
  },
  {
    targetKind: 'integration',
    targetKey: 'siem-export',
    cia: { confidentiality: 1, integrity: 3, availability: 2 },
    dataClass: 'internal',
    maskedByDefault: false,
    revealRequiresReason: false,
    exportRequiresApproval: false,
    motivation: 'No-PII technical events only',
  },
];

export function createDefaultClassificationRegistry(): ClassificationRegistry {
  const registry = new ClassificationRegistry();
  for (const record of DEFAULT_CLASSIFICATIONS) {
    registry.register(record);
  }
  return registry;
}
