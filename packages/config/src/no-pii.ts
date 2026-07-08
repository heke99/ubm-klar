/**
 * No-PII guard used by the control plane, vendor telemetry, support bundles
 * and AI prompt policies. Fails closed: anything that looks like Swedish
 * personal data is rejected.
 */
import { findPersonnummer } from './personnummer';

const FORBIDDEN_KEY_FRAGMENTS = [
  'personal_identity_number',
  'personnummer',
  'person_name',
  'first_name',
  'last_name',
  'household',
  'income',
  'bank_account',
  'bankgiro',
  'plusgiro',
  'medical',
  'diagnosis',
  'case_note',
  'social_circumstance',
  'protected_identity_details',
];

export interface PiiScanResult {
  clean: boolean;
  violations: string[];
}

export function scanForPii(value: unknown, path = '$'): PiiScanResult {
  const violations: string[] = [];
  visit(value, path, violations);
  return { clean: violations.length === 0, violations };
}

function visit(value: unknown, path: string, violations: string[]): void {
  if (typeof value === 'string') {
    if (findPersonnummer(value).length > 0) {
      violations.push(`${path}: value matches personal identity number pattern`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => visit(v, `${path}[${i}]`, violations));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase();
      const hit = FORBIDDEN_KEY_FRAGMENTS.find((f) => lowered.includes(f));
      if (hit) {
        violations.push(`${path}.${key}: forbidden field name (matches "${hit}")`);
      }
      visit(v, `${path}.${key}`, violations);
    }
  }
}

export class PiiLeakError extends Error {
  constructor(public readonly violations: string[]) {
    super(`Refusing to process payload containing potential PII: ${violations.join('; ')}`);
    this.name = 'PiiLeakError';
  }
}

/** Throws when the payload contains anything PII-like. Use at every control-plane boundary. */
export function assertNoPii<T>(value: T, context: string): T {
  const result = scanForPii(value, context);
  if (!result.clean) {
    throw new PiiLeakError(result.violations);
  }
  return value;
}
