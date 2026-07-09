import type { DataQualityStatus } from '@ubm-klar/shared-types';

/** Entity snapshot fed into data quality checks. Values are already loaded. */
export interface DataQualitySubject {
  entityKind: string;
  entityId: string;
  fields: Record<string, unknown>;
  /** Cross-entity context flags computed by callers/DB queries. */
  context: {
    hasDecision?: boolean;
    decisionPeriodValid?: boolean;
    paymentInsideDecisionPeriod?: boolean;
    hasRecipient?: boolean;
    hasDepartmentOrCommittee?: boolean;
    hasSupportingDocument?: boolean;
    hasSourceSystem?: boolean;
    hasSystemOfRecord?: boolean;
    hasSourceRecordLink?: boolean;
    hasLegalBasis?: boolean;
    hasPurpose?: boolean;
    isDuplicate?: boolean;
    classificationValid?: boolean;
    hasDecisionLink?: boolean;
    lineageComplete?: boolean;
    hasArchiveClassification?: boolean;
    hasRetentionPolicy?: boolean;
    hasUbmMapping?: boolean;
    hasUbmExportEligibility?: boolean;
    recipientVerified?: boolean;
    hasSsoRoleMapping?: boolean;
    dpoLegalApprovalPresent?: boolean;
    dpoLegalApprovalRequired?: boolean;
  };
}

export interface DataQualityFinding {
  checkKey: string;
  status: DataQualityStatus;
  message: string;
  fieldKey?: string;
}

export interface DataQualityCheck {
  key: string;
  description: string;
  appliesTo: (subject: DataQualitySubject) => boolean;
  run: (subject: DataQualitySubject) => DataQualityFinding | undefined;
}

function finding(
  checkKey: string,
  status: DataQualityStatus,
  message: string,
  fieldKey?: string,
): DataQualityFinding {
  return fieldKey === undefined
    ? { checkKey, status, message }
    : { checkKey, status, message, fieldKey };
}

const isPersonEntity = (s: DataQualitySubject) =>
  ['person', 'lss_person', 'ea_person'].includes(s.entityKind) ||
  'personal_identity_number' in s.fields;

const isPaymentEntity = (s: DataQualitySubject) =>
  ['payment', 'lss_payment', 'ea_payment'].includes(s.entityKind);

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function isValidPersonnummerFormat(value: string): boolean {
  const normalized = value.replace(/[-+]/g, '');
  if (!/^\d{10}$|^\d{12}$/.test(normalized)) return false;
  const ten = normalized.length === 12 ? normalized.slice(2) : normalized;
  const month = Number(ten.slice(2, 4));
  let day = Number(ten.slice(4, 6));
  if (day > 60) day -= 60;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return luhnValid(ten);
}

/** The shared data quality check catalogue. */
export const SHARED_DATA_QUALITY_CHECKS: DataQualityCheck[] = [
  {
    key: 'missing_personal_identity_number',
    description: 'Personnummer saknas',
    appliesTo: isPersonEntity,
    run: (s) => {
      const value = s.fields.personal_identity_number;
      if (value === undefined || value === null || value === '') {
        return finding(
          'missing_personal_identity_number',
          'blocked',
          'Personnummer saknas.',
          'personal_identity_number',
        );
      }
      return undefined;
    },
  },
  {
    key: 'invalid_personal_identity_number_format',
    description: 'Ogiltigt personnummerformat',
    appliesTo: (s) => isPersonEntity(s) && Boolean(s.fields.personal_identity_number),
    run: (s) => {
      const value = String(s.fields.personal_identity_number);
      const isSynthetic = s.fields.is_synthetic === true;
      if (!isValidPersonnummerFormat(value) && !isSynthetic) {
        return finding(
          'invalid_personal_identity_number_format',
          'requires_manual_review',
          'Personnumret har ogiltigt format eller felaktig kontrollsiffra.',
          'personal_identity_number',
        );
      }
      return undefined;
    },
  },
  {
    key: 'missing_decision',
    description: 'Beslut saknas',
    appliesTo: (s) => s.context.hasDecision !== undefined,
    run: (s) =>
      s.context.hasDecision === false
        ? finding('missing_decision', 'blocked', 'Koppling till beslut saknas.')
        : undefined,
  },
  {
    key: 'missing_decision_period',
    description: 'Beslutsperiod saknas eller ogiltig',
    appliesTo: (s) => s.context.decisionPeriodValid !== undefined,
    run: (s) =>
      s.context.decisionPeriodValid === false
        ? finding('missing_decision_period', 'blocked', 'Beslutsperiod saknas eller är ogiltig.')
        : undefined,
  },
  {
    key: 'payment_without_decision',
    description: 'Utbetalning utan beslut',
    appliesTo: (s) => isPaymentEntity(s),
    run: (s) =>
      s.context.hasDecision === false
        ? finding('payment_without_decision', 'blocked', 'Utbetalning saknar koppling till beslut.')
        : undefined,
  },
  {
    key: 'payment_outside_decision_period',
    description: 'Utbetalning utanför beslutsperiod',
    appliesTo: (s) => isPaymentEntity(s) && s.context.paymentInsideDecisionPeriod !== undefined,
    run: (s) =>
      s.context.paymentInsideDecisionPeriod === false
        ? finding(
            'payment_outside_decision_period',
            'requires_manual_review',
            'Utbetalningen ligger utanför beslutsperioden.',
          )
        : undefined,
  },
  {
    key: 'missing_recipient',
    description: 'Mottagare saknas',
    appliesTo: (s) => isPaymentEntity(s),
    run: (s) =>
      s.context.hasRecipient === false
        ? finding('missing_recipient', 'blocked', 'Betalningsmottagare saknas.')
        : undefined,
  },
  {
    key: 'missing_department_or_committee',
    description: 'Förvaltning/nämnd saknas',
    appliesTo: (s) => s.context.hasDepartmentOrCommittee !== undefined,
    run: (s) =>
      s.context.hasDepartmentOrCommittee === false
        ? finding(
            'missing_department_or_committee',
            'valid_with_warning',
            'Koppling till förvaltning eller nämnd saknas.',
          )
        : undefined,
  },
  {
    key: 'missing_supporting_document',
    description: 'Underlag saknas',
    appliesTo: (s) => s.context.hasSupportingDocument !== undefined,
    run: (s) =>
      s.context.hasSupportingDocument === false
        ? finding(
            'missing_supporting_document',
            'requires_manual_review',
            'Underlag/dokument saknas.',
          )
        : undefined,
  },
  {
    key: 'missing_source',
    description: 'Källsystem saknas',
    appliesTo: (s) => s.context.hasSourceSystem !== undefined,
    run: (s) =>
      s.context.hasSourceSystem === false
        ? finding('missing_source', 'requires_source_system_fix', 'Källsystem saknas för posten.')
        : undefined,
  },
  {
    key: 'missing_system_of_record',
    description: 'System of record saknas',
    appliesTo: (s) => s.context.hasSystemOfRecord !== undefined,
    run: (s) =>
      s.context.hasSystemOfRecord === false
        ? finding(
            'missing_system_of_record',
            'requires_source_system_fix',
            'System of record är inte definierat för entiteten.',
          )
        : undefined,
  },
  {
    key: 'missing_source_record_link',
    description: 'Källpostlänk saknas',
    appliesTo: (s) => s.context.hasSourceRecordLink !== undefined,
    run: (s) =>
      s.context.hasSourceRecordLink === false
        ? finding(
            'missing_source_record_link',
            'requires_lineage_fix',
            'Länk till källpost saknas.',
          )
        : undefined,
  },
  {
    key: 'missing_legal_basis',
    description: 'Rättslig grund saknas',
    appliesTo: (s) => s.context.hasLegalBasis !== undefined,
    run: (s) =>
      s.context.hasLegalBasis === false
        ? finding(
            'missing_legal_basis',
            'requires_legal_review',
            'Rättslig grund är inte dokumenterad.',
          )
        : undefined,
  },
  {
    key: 'missing_purpose',
    description: 'Ändamål saknas',
    appliesTo: (s) => s.context.hasPurpose !== undefined,
    run: (s) =>
      s.context.hasPurpose === false
        ? finding('missing_purpose', 'requires_dpo_review', 'Ändamål för behandlingen saknas.')
        : undefined,
  },
  {
    key: 'invalid_period',
    description: 'Ogiltig period',
    appliesTo: (s) => 'period_start' in s.fields && 'period_end' in s.fields,
    run: (s) => {
      const start = String(s.fields.period_start ?? '');
      const end = String(s.fields.period_end ?? '');
      if (start && end && start > end) {
        return finding('invalid_period', 'blocked', 'Periodens start ligger efter dess slut.');
      }
      return undefined;
    },
  },
  {
    key: 'duplicate',
    description: 'Dubblett',
    appliesTo: (s) => s.context.isDuplicate !== undefined,
    run: (s) =>
      s.context.isDuplicate === true
        ? finding('duplicate', 'requires_manual_review', 'Posten är en möjlig dubblett.')
        : undefined,
  },
  {
    key: 'wrong_data_classification',
    description: 'Felaktig informationsklassning',
    appliesTo: (s) => s.context.classificationValid !== undefined,
    run: (s) =>
      s.context.classificationValid === false
        ? finding(
            'wrong_data_classification',
            'requires_classification_review',
            'Informationsklassningen är ofullständig eller felaktig.',
          )
        : undefined,
  },
  {
    key: 'missing_decision_link',
    description: 'Beslutslänk saknas',
    appliesTo: (s) => s.context.hasDecisionLink !== undefined,
    run: (s) =>
      s.context.hasDecisionLink === false
        ? finding('missing_decision_link', 'blocked', 'Koppling till beslut saknas för posten.')
        : undefined,
  },
  {
    key: 'incomplete_data_lineage',
    description: 'Ofullständig datalinje',
    appliesTo: (s) => s.context.lineageComplete !== undefined,
    run: (s) =>
      s.context.lineageComplete === false
        ? finding(
            'incomplete_data_lineage',
            'requires_lineage_fix',
            'Datalinjen (lineage) är ofullständig för ett eller flera fält.',
          )
        : undefined,
  },
  {
    key: 'missing_archive_classification',
    description: 'Arkivklassning saknas',
    appliesTo: (s) => s.context.hasArchiveClassification !== undefined,
    run: (s) =>
      s.context.hasArchiveClassification === false
        ? finding(
            'missing_archive_classification',
            'valid_with_warning',
            'Arkivklassificering saknas.',
          )
        : undefined,
  },
  {
    key: 'missing_retention_policy',
    description: 'Gallringsregel saknas',
    appliesTo: (s) => s.context.hasRetentionPolicy !== undefined,
    run: (s) =>
      s.context.hasRetentionPolicy === false
        ? finding('missing_retention_policy', 'valid_with_warning', 'Gallringsregel saknas.')
        : undefined,
  },
  {
    key: 'missing_ubm_mapping',
    description: 'UBM-mappning saknas',
    appliesTo: (s) => s.context.hasUbmMapping !== undefined,
    run: (s) =>
      s.context.hasUbmMapping === false
        ? finding('missing_ubm_mapping', 'requires_mapping_fix', 'UBM-fältmappning saknas.')
        : undefined,
  },
  {
    key: 'missing_ubm_export_eligibility',
    description: 'UBM-exportbehörighet ej bedömd',
    appliesTo: (s) => s.context.hasUbmExportEligibility !== undefined,
    run: (s) =>
      s.context.hasUbmExportEligibility === false
        ? finding(
            'missing_ubm_export_eligibility',
            'requires_manual_review',
            'Exportbehörighet för UBM är inte bedömd.',
          )
        : undefined,
  },
  {
    key: 'missing_payment_recipient_verification',
    description: 'Mottagarverifiering saknas',
    appliesTo: (s) => isPaymentEntity(s) && s.context.recipientVerified !== undefined,
    run: (s) =>
      s.context.recipientVerified === false
        ? finding(
            'missing_payment_recipient_verification',
            'requires_manual_review',
            'Betalningsmottagaren är inte verifierad mot mottagarregistret.',
          )
        : undefined,
  },
  {
    key: 'missing_sso_role_mapping',
    description: 'SSO-rollmappning saknas',
    appliesTo: (s) => s.entityKind === 'user' && s.context.hasSsoRoleMapping !== undefined,
    run: (s) =>
      s.context.hasSsoRoleMapping === false
        ? finding(
            'missing_sso_role_mapping',
            'requires_manual_review',
            'Användaren saknar rollmappning från SSO-grupper.',
          )
        : undefined,
  },
  {
    key: 'missing_dpo_legal_approval',
    description: 'DPO/juridiskt godkännande saknas',
    appliesTo: (s) => s.context.dpoLegalApprovalRequired === true,
    run: (s) =>
      s.context.dpoLegalApprovalPresent !== true
        ? finding(
            'missing_dpo_legal_approval',
            'requires_dpo_review',
            'DPO- eller juridiskt godkännande krävs men saknas.',
          )
        : undefined,
  },
];
