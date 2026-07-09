/**
 * Pilot import type catalog: target fields per import kind, used by the mapping
 * wizard, validation and the committers in the API.
 */

export type FieldKind = 'personnummer' | 'date' | 'amount_sek' | 'number' | 'text' | 'enum';

export interface TargetFieldDefinition {
  field: string;
  labelSv: string;
  required: boolean;
  kind: FieldKind;
  enumValues?: readonly string[];
}

export interface ImportTypeDefinition {
  key: string;
  labelSv: string;
  /** import_batches.import_kind bucket. */
  batchKind:
    'persons' | 'lss' | 'economic_assistance' | 'payments' | 'payment_file' | 'documents' | 'other';
  domain: 'lss' | 'economic_assistance' | 'payment_control' | 'common';
  fields: readonly TargetFieldDefinition[];
}

const pn = (required = true): TargetFieldDefinition => ({
  field: 'personnummer',
  labelSv: 'Personnummer',
  required,
  kind: 'personnummer',
});

export const IMPORT_TYPES: readonly ImportTypeDefinition[] = [
  {
    key: 'lss_persons',
    labelSv: 'LSS — personer',
    batchKind: 'persons',
    domain: 'lss',
    fields: [
      pn(),
      { field: 'given_name', labelSv: 'Förnamn', required: false, kind: 'text' },
      { field: 'family_name', labelSv: 'Efternamn', required: false, kind: 'text' },
      {
        field: 'protected_identity',
        labelSv: 'Skyddad identitet (true/false)',
        required: false,
        kind: 'text',
      },
    ],
  },
  {
    key: 'lss_decisions',
    labelSv: 'LSS — beslut',
    batchKind: 'lss',
    domain: 'lss',
    fields: [
      pn(),
      { field: 'decision_number', labelSv: 'Beslutsnummer', required: true, kind: 'text' },
      { field: 'insats_kind', labelSv: 'Insats', required: true, kind: 'text' },
      {
        field: 'decision_kind',
        labelSv: 'Beslutstyp',
        required: true,
        kind: 'enum',
        enumValues: ['approval', 'partial_approval', 'rejection', 'termination'],
      },
      { field: 'decided_at', labelSv: 'Beslutsdatum', required: true, kind: 'date' },
      { field: 'period_start', labelSv: 'Periodstart', required: false, kind: 'date' },
      { field: 'period_end', labelSv: 'Periodslut', required: false, kind: 'date' },
    ],
  },
  {
    key: 'lss_time_reports',
    labelSv: 'LSS — tidrapporter',
    batchKind: 'lss',
    domain: 'lss',
    fields: [
      pn(),
      { field: 'provider_org_number', labelSv: 'Anordnarens org.nr', required: true, kind: 'text' },
      { field: 'period_start', labelSv: 'Periodstart', required: true, kind: 'date' },
      { field: 'period_end', labelSv: 'Periodslut', required: true, kind: 'date' },
      { field: 'total_hours', labelSv: 'Timmar', required: true, kind: 'number' },
    ],
  },
  {
    key: 'lss_invoices',
    labelSv: 'LSS — fakturor',
    batchKind: 'lss',
    domain: 'lss',
    fields: [
      { field: 'provider_org_number', labelSv: 'Anordnarens org.nr', required: true, kind: 'text' },
      { field: 'invoice_number', labelSv: 'Fakturanummer', required: true, kind: 'text' },
      pn(false),
      { field: 'period_start', labelSv: 'Periodstart', required: true, kind: 'date' },
      { field: 'period_end', labelSv: 'Periodslut', required: true, kind: 'date' },
      { field: 'total_amount_sek', labelSv: 'Belopp (SEK)', required: true, kind: 'amount_sek' },
      { field: 'total_hours', labelSv: 'Timmar', required: false, kind: 'number' },
    ],
  },
  {
    key: 'lss_payments',
    labelSv: 'LSS — utbetalningar',
    batchKind: 'payments',
    domain: 'lss',
    fields: [
      pn(false),
      { field: 'decision_number', labelSv: 'Beslutsnummer', required: false, kind: 'text' },
      {
        field: 'provider_org_number',
        labelSv: 'Anordnarens org.nr',
        required: false,
        kind: 'text',
      },
      { field: 'amount_sek', labelSv: 'Belopp (SEK)', required: true, kind: 'amount_sek' },
      { field: 'payment_date', labelSv: 'Utbetalningsdatum', required: true, kind: 'date' },
      {
        field: 'status',
        labelSv: 'Status',
        required: false,
        kind: 'enum',
        enumValues: ['created', 'approved', 'sent', 'paid', 'stopped'],
      },
    ],
  },
  {
    key: 'lss_providers',
    labelSv: 'LSS — anordnare',
    batchKind: 'lss',
    domain: 'lss',
    fields: [
      {
        field: 'organization_number',
        labelSv: 'Organisationsnummer',
        required: true,
        kind: 'text',
      },
      { field: 'name', labelSv: 'Namn', required: true, kind: 'text' },
      {
        field: 'provider_status',
        labelSv: 'Status',
        required: false,
        kind: 'enum',
        enumValues: ['active', 'suspended', 'under_review', 'terminated'],
      },
    ],
  },
  {
    key: 'ea_households',
    labelSv: 'Ekonomiskt bistånd — hushåll',
    batchKind: 'economic_assistance',
    domain: 'economic_assistance',
    fields: [
      { field: 'household_number', labelSv: 'Hushållsnummer', required: true, kind: 'text' },
      {
        field: 'household_kind',
        labelSv: 'Hushållstyp',
        required: true,
        kind: 'enum',
        enumValues: ['single', 'single_with_children', 'couple', 'couple_with_children', 'other'],
      },
      pn(),
      {
        field: 'member_role',
        labelSv: 'Roll i hushållet',
        required: true,
        kind: 'enum',
        enumValues: ['applicant', 'co_applicant', 'child', 'other_adult'],
      },
      { field: 'valid_from', labelSv: 'Giltig från', required: true, kind: 'date' },
    ],
  },
  {
    key: 'ea_applications',
    labelSv: 'Ekonomiskt bistånd — ansökningar',
    batchKind: 'economic_assistance',
    domain: 'economic_assistance',
    fields: [
      { field: 'household_number', labelSv: 'Hushållsnummer', required: true, kind: 'text' },
      { field: 'application_number', labelSv: 'Ansökningsnummer', required: true, kind: 'text' },
      { field: 'received_at', labelSv: 'Mottagen', required: true, kind: 'date' },
      {
        field: 'application_kind',
        labelSv: 'Ansökningstyp',
        required: false,
        kind: 'enum',
        enumValues: ['initial', 'monthly', 'emergency', 'supplement'],
      },
    ],
  },
  {
    key: 'ea_decisions',
    labelSv: 'Ekonomiskt bistånd — beslut',
    batchKind: 'economic_assistance',
    domain: 'economic_assistance',
    fields: [
      { field: 'household_number', labelSv: 'Hushållsnummer', required: true, kind: 'text' },
      { field: 'application_number', labelSv: 'Ansökningsnummer', required: true, kind: 'text' },
      { field: 'decision_number', labelSv: 'Beslutsnummer', required: true, kind: 'text' },
      {
        field: 'decision_kind',
        labelSv: 'Beslutstyp',
        required: true,
        kind: 'enum',
        enumValues: ['approval', 'partial_approval', 'rejection', 'reconsideration', 'termination'],
      },
      { field: 'decided_at', labelSv: 'Beslutsdatum', required: true, kind: 'date' },
    ],
  },
  {
    key: 'ea_income_records',
    labelSv: 'Ekonomiskt bistånd — inkomstuppgifter',
    batchKind: 'economic_assistance',
    domain: 'economic_assistance',
    fields: [
      { field: 'application_number', labelSv: 'Ansökningsnummer', required: true, kind: 'text' },
      pn(),
      { field: 'amount_sek', labelSv: 'Belopp (SEK)', required: true, kind: 'amount_sek' },
      {
        field: 'verification_source',
        labelSv: 'Verifieringskälla',
        required: true,
        kind: 'enum',
        enumValues: [
          'ssbtek',
          'gif',
          'skatteverket',
          'forsakringskassan',
          'af',
          'csn',
          'pensionsmyndigheten',
          'a_kassa',
          'bank_statement',
          'employer',
          'manual',
        ],
      },
      { field: 'period_start', labelSv: 'Periodstart', required: false, kind: 'date' },
      { field: 'period_end', labelSv: 'Periodslut', required: false, kind: 'date' },
    ],
  },
  {
    key: 'ea_housing_records',
    labelSv: 'Ekonomiskt bistånd — boendeuppgifter',
    batchKind: 'economic_assistance',
    domain: 'economic_assistance',
    fields: [
      { field: 'household_number', labelSv: 'Hushållsnummer', required: true, kind: 'text' },
      {
        field: 'housing_kind',
        labelSv: 'Boendetyp',
        required: true,
        kind: 'enum',
        enumValues: ['rental', 'condominium', 'house', 'sublet', 'lodger', 'homeless', 'other'],
      },
      {
        field: 'monthly_cost_sek',
        labelSv: 'Månadskostnad (SEK)',
        required: false,
        kind: 'amount_sek',
      },
      { field: 'valid_from', labelSv: 'Giltig från', required: true, kind: 'date' },
    ],
  },
  {
    key: 'ea_payments',
    labelSv: 'Ekonomiskt bistånd — utbetalningar',
    batchKind: 'payments',
    domain: 'economic_assistance',
    fields: [
      { field: 'household_number', labelSv: 'Hushållsnummer', required: false, kind: 'text' },
      { field: 'decision_number', labelSv: 'Beslutsnummer', required: false, kind: 'text' },
      pn(false),
      { field: 'amount_sek', labelSv: 'Belopp (SEK)', required: true, kind: 'amount_sek' },
      { field: 'payment_date', labelSv: 'Utbetalningsdatum', required: true, kind: 'date' },
      {
        field: 'status',
        labelSv: 'Status',
        required: false,
        kind: 'enum',
        enumValues: ['created', 'approved', 'sent', 'paid', 'stopped'],
      },
    ],
  },
  {
    key: 'payment_files',
    labelSv: 'Betalfil (CSV-konverterad; BGMAX/ISO20022 via abstraktion)',
    batchKind: 'payment_file',
    domain: 'payment_control',
    fields: [
      {
        field: 'external_payment_reference',
        labelSv: 'Betalningsreferens',
        required: false,
        kind: 'text',
      },
      pn(false),
      {
        field: 'recipient_org_number',
        labelSv: 'Mottagarens org.nr',
        required: false,
        kind: 'text',
      },
      {
        field: 'recipient_account_reference',
        labelSv: 'Mottagarkonto',
        required: false,
        kind: 'text',
      },
      { field: 'amount_sek', labelSv: 'Belopp (SEK)', required: true, kind: 'amount_sek' },
      { field: 'payment_date', labelSv: 'Betaldatum', required: true, kind: 'date' },
      {
        field: 'domain_hint',
        labelSv: 'Verksamhetsområde',
        required: false,
        kind: 'enum',
        enumValues: ['lss', 'economic_assistance', 'other'],
      },
    ],
  },
  {
    key: 'recipient_register',
    labelSv: 'Mottagarregister',
    batchKind: 'payments',
    domain: 'payment_control',
    fields: [
      {
        field: 'recipient_kind',
        labelSv: 'Mottagartyp',
        required: true,
        kind: 'enum',
        enumValues: ['person', 'organization'],
      },
      pn(false),
      {
        field: 'organization_number',
        labelSv: 'Organisationsnummer',
        required: false,
        kind: 'text',
      },
      {
        field: 'account_kind',
        labelSv: 'Kontotyp',
        required: true,
        kind: 'enum',
        enumValues: ['bankgiro', 'plusgiro', 'bank_account', 'other'],
      },
      { field: 'account_reference', labelSv: 'Kontoreferens', required: true, kind: 'text' },
      { field: 'valid_from', labelSv: 'Giltig från', required: false, kind: 'date' },
    ],
  },
  {
    key: 'recovery_claims',
    labelSv: 'Återkrav',
    batchKind: 'payments',
    domain: 'payment_control',
    fields: [
      {
        field: 'domain',
        labelSv: 'Område',
        required: true,
        kind: 'enum',
        enumValues: ['lss', 'economic_assistance'],
      },
      { field: 'claim_number', labelSv: 'Återkravsnummer', required: true, kind: 'text' },
      pn(false),
      { field: 'amount_sek', labelSv: 'Belopp (SEK)', required: true, kind: 'amount_sek' },
      { field: 'reason', labelSv: 'Skäl', required: true, kind: 'text' },
    ],
  },
] as const;

export function getImportType(key: string): ImportTypeDefinition | undefined {
  return IMPORT_TYPES.find((t) => t.key === key);
}
