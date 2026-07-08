import { USABLE_REGISTRY_STATUSES, type RegistryStatus } from '@ubm-klar/shared-types';

export type UbmFieldType =
  | 'string'
  | 'integer'
  | 'decimal'
  | 'date'
  | 'boolean'
  | 'code'
  | 'personal_identity_number'
  | 'org_number'
  | 'amount_sek';

export interface UbmSchemaField {
  fieldKey: string;
  title: string;
  dataType: UbmFieldType;
  required: boolean;
  codeListKey?: string;
  maxLength?: number;
  dataClass?: string;
}

export interface UbmSchemaVersion {
  schemaKey: string;
  version: string;
  domain: 'lss' | 'economic_assistance' | 'common';
  obligationKind: 'request_based' | 'recurring_reporting';
  status: RegistryStatus;
  effectiveFrom?: string;
  effectiveTo?: string;
  legalSourceKey?: string;
  legalSourceVersion?: string;
  transportProfile?: 'manual_download' | 'sftp' | 'api' | 'ubm_official_transport_pending';
  transportApproved: boolean;
  fields: UbmSchemaField[];
  codeLists: Record<string, string[]>;
}

export class UbmSchemaRegistry {
  private versions = new Map<string, UbmSchemaVersion>();

  register(schema: UbmSchemaVersion): void {
    const key = `${schema.schemaKey}@${schema.version}`;
    if (this.versions.has(key)) throw new Error(`Schema version already registered: ${key}`);
    this.versions.set(key, schema);
  }

  get(schemaKey: string, version: string): UbmSchemaVersion | undefined {
    return this.versions.get(`${schemaKey}@${version}`);
  }

  /** Resolves the usable (pilot/active) version effective at a date. */
  resolveUsable(schemaKey: string, atDate: string): UbmSchemaVersion | undefined {
    const candidates = [...this.versions.values()].filter(
      (v) =>
        v.schemaKey === schemaKey &&
        USABLE_REGISTRY_STATUSES.includes(v.status) &&
        (!v.effectiveFrom || v.effectiveFrom <= atDate) &&
        (!v.effectiveTo || v.effectiveTo >= atDate),
    );
    return candidates.sort((a, b) =>
      (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''),
    )[0];
  }

  list(): UbmSchemaVersion[] {
    return [...this.versions.values()];
  }
}

export interface SchemaValidationError {
  fieldKey: string;
  code: 'missing_required' | 'invalid_type' | 'invalid_code' | 'too_long' | 'unknown_field';
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
  schemaKey: string;
  schemaVersion: string;
}

const TYPE_VALIDATORS: Record<UbmFieldType, (value: string) => boolean> = {
  string: () => true,
  integer: (v) => /^-?\d+$/.test(v),
  decimal: (v) => /^-?\d+([.,]\d+)?$/.test(v),
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
  boolean: (v) => ['true', 'false', 'ja', 'nej'].includes(v.toLowerCase()),
  code: () => true,
  personal_identity_number: (v) => /^\d{6,8}[-+]?\d{4}$/.test(v),
  org_number: (v) => /^\d{6}-\d{4}$/.test(v),
  amount_sek: (v) => /^-?\d+([.,]\d{1,2})?$/.test(v),
};

/** Validates a record against a schema version. Unknown fields are rejected. */
export function validateAgainstSchema(
  schema: UbmSchemaVersion,
  record: Record<string, string>,
): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];
  const knownFields = new Map(schema.fields.map((f) => [f.fieldKey, f]));

  for (const field of schema.fields) {
    const value = record[field.fieldKey];
    if (value === undefined || value === '') {
      if (field.required) {
        errors.push({
          fieldKey: field.fieldKey,
          code: 'missing_required',
          message: `Fältet ${field.title} är obligatoriskt.`,
        });
      }
      continue;
    }
    if (!TYPE_VALIDATORS[field.dataType](value)) {
      errors.push({
        fieldKey: field.fieldKey,
        code: 'invalid_type',
        message: `Fältet ${field.title} har ogiltigt format för typen ${field.dataType}.`,
      });
      continue;
    }
    if (field.maxLength && value.length > field.maxLength) {
      errors.push({
        fieldKey: field.fieldKey,
        code: 'too_long',
        message: `Fältet ${field.title} överskrider maxlängden ${field.maxLength}.`,
      });
    }
    if (field.dataType === 'code' && field.codeListKey) {
      const codes = schema.codeLists[field.codeListKey] ?? [];
      if (!codes.includes(value)) {
        errors.push({
          fieldKey: field.fieldKey,
          code: 'invalid_code',
          message: `Värdet "${value}" finns inte i kodlistan ${field.codeListKey}.`,
        });
      }
    }
  }

  for (const key of Object.keys(record)) {
    if (!knownFields.has(key)) {
      errors.push({
        fieldKey: key,
        code: 'unknown_field',
        message: `Fältet ${key} ingår inte i schemat och får inte skickas.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    schemaKey: schema.schemaKey,
    schemaVersion: schema.version,
  };
}

/** The shipped internal working schema for LSS request responses (not an official format). */
export function createInternalLssRequestSchema(): UbmSchemaVersion {
  return {
    schemaKey: 'ubm_request_response_lss',
    version: '1.0.0',
    domain: 'lss',
    obligationKind: 'request_based',
    status: 'active',
    effectiveFrom: '2026-07-01',
    legalSourceKey: 'lag_2023_456_uppgiftsskyldighet',
    legalSourceVersion: '2026-07-01',
    transportProfile: 'manual_download',
    transportApproved: true,
    fields: [
      { fieldKey: 'personal_identity_number', title: 'Personnummer', dataType: 'personal_identity_number', required: true, dataClass: 'personal_data' },
      { fieldKey: 'decision_number', title: 'Beslutsnummer', dataType: 'string', required: true, maxLength: 64 },
      { fieldKey: 'insats_kind', title: 'Insats', dataType: 'code', required: true, codeListKey: 'lss_insats' },
      { fieldKey: 'decision_period_start', title: 'Beslutsperiod start', dataType: 'date', required: true },
      { fieldKey: 'decision_period_end', title: 'Beslutsperiod slut', dataType: 'date', required: false },
      { fieldKey: 'hours_per_week', title: 'Timmar per vecka', dataType: 'decimal', required: false },
      { fieldKey: 'paid_amount_sek', title: 'Utbetalt belopp (SEK)', dataType: 'amount_sek', required: false, dataClass: 'income_data' },
      { fieldKey: 'provider_org_number', title: 'Utförarens organisationsnummer', dataType: 'org_number', required: false },
      { fieldKey: 'document_reference', title: 'Dokumentreferens', dataType: 'string', required: false, maxLength: 128 },
    ],
    codeLists: {
      lss_insats: [
        'personlig_assistans',
        'ledsagarservice',
        'kontaktperson',
        'avlosarservice',
        'korttidsvistelse',
        'korttidstillsyn',
        'boende_barn',
        'boende_vuxna',
        'daglig_verksamhet',
      ],
    },
  };
}
