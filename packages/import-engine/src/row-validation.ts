import type { ImportTypeDefinition } from './import-types';
import type { MappedRow } from './mapping';

/**
 * Row-level validation for the pilot import flow. Errors block the row from
 * being committed; warnings are shown but do not block.
 */

export interface RowIssue {
  rowNumber: number;
  field: string | undefined;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface RowValidationOptions {
  /** Synthetic personnummer (month 90+) allowed only in demo/test/local tenants. */
  allowSyntheticPersonnummer: boolean;
  /** Personnummer validator (real numbers): injected from @ubm-klar/config. */
  isLikelyPersonnummer: (candidate: string) => boolean;
}

export function isSyntheticPersonnummer(value: string): boolean {
  const normalized = value.replace(/[-+\s]/g, '');
  const birthPart =
    normalized.length === 12
      ? normalized.slice(2, 8)
      : normalized.length === 10
        ? normalized.slice(0, 6)
        : '';
  if (birthPart.length !== 6) return false;
  const month = Number(birthPart.slice(2, 4));
  return month >= 90;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateRows(
  rows: MappedRow[],
  type: ImportTypeDefinition,
  options: RowValidationOptions,
): RowIssue[] {
  const issues: RowIssue[] = [];
  const seenKeys = new Map<string, number>();

  for (const row of rows) {
    for (const mappingError of row.errors) {
      issues.push({
        rowNumber: row.rowNumber,
        field: undefined,
        code: 'MISSING_REQUIRED_FIELD',
        message: mappingError,
        severity: 'error',
      });
    }

    for (const field of type.fields) {
      const value = row.values[field.field];
      if (value === undefined || value === '') {
        if (field.required && !row.errors.some((e) => e.includes(`"${field.field}"`))) {
          issues.push({
            rowNumber: row.rowNumber,
            field: field.field,
            code: 'MISSING_REQUIRED_FIELD',
            message: `Fältet "${field.labelSv}" saknas`,
            severity: 'error',
          });
        }
        continue;
      }
      switch (field.kind) {
        case 'personnummer': {
          if (isSyntheticPersonnummer(value)) {
            if (!options.allowSyntheticPersonnummer) {
              issues.push({
                rowNumber: row.rowNumber,
                field: field.field,
                code: 'SYNTHETIC_PERSONNUMMER_FORBIDDEN',
                message:
                  'Syntetiskt personnummer (månad 90+) är endast tillåtet i demo-/testmiljöer',
                severity: 'error',
              });
            }
          } else if (!options.isLikelyPersonnummer(value)) {
            issues.push({
              rowNumber: row.rowNumber,
              field: field.field,
              code: 'INVALID_PERSONNUMMER',
              message: 'Ogiltigt personnummer (datum- eller kontrollsiffefel)',
              severity: 'error',
            });
          }
          break;
        }
        case 'date': {
          if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
            issues.push({
              rowNumber: row.rowNumber,
              field: field.field,
              code: 'INVALID_DATE',
              message: `Ogiltigt datum "${value}" (förväntat ÅÅÅÅ-MM-DD)`,
              severity: 'error',
            });
          } else {
            const year = Number(value.slice(0, 4));
            if (year < 1990 || year > 2100) {
              issues.push({
                rowNumber: row.rowNumber,
                field: field.field,
                code: 'DATE_OUT_OF_RANGE',
                message: `Datum "${value}" ligger utanför rimligt intervall (1990–2100)`,
                severity: 'warning',
              });
            }
          }
          break;
        }
        case 'amount_sek': {
          const amount = Number(value);
          if (Number.isNaN(amount)) {
            issues.push({
              rowNumber: row.rowNumber,
              field: field.field,
              code: 'INVALID_AMOUNT',
              message: `Ogiltigt belopp "${value}"`,
              severity: 'error',
            });
          } else if (amount < 0) {
            issues.push({
              rowNumber: row.rowNumber,
              field: field.field,
              code: 'NEGATIVE_AMOUNT',
              message: `Negativt belopp ${amount} kr — kontrollera om detta är en kreditering`,
              severity: 'error',
            });
          } else if (amount > 10_000_000) {
            issues.push({
              rowNumber: row.rowNumber,
              field: field.field,
              code: 'UNUSUALLY_HIGH_AMOUNT',
              message: `Ovanligt högt belopp ${amount} kr`,
              severity: 'warning',
            });
          }
          break;
        }
        case 'number': {
          if (Number.isNaN(Number(value))) {
            issues.push({
              rowNumber: row.rowNumber,
              field: field.field,
              code: 'INVALID_NUMBER',
              message: `Ogiltigt tal "${value}"`,
              severity: 'error',
            });
          }
          break;
        }
        case 'enum': {
          if (field.enumValues && !field.enumValues.includes(value)) {
            issues.push({
              rowNumber: row.rowNumber,
              field: field.field,
              code: 'INVALID_ENUM_VALUE',
              message: `Ogiltigt värde "${value}" för ${field.labelSv} (tillåtna: ${field.enumValues.join(', ')})`,
              severity: 'error',
            });
          }
          break;
        }
        case 'text':
          break;
      }
    }

    // Period sanity: end before start.
    const start = row.values['period_start'];
    const end = row.values['period_end'];
    if (start && end && ISO_DATE.test(start) && ISO_DATE.test(end) && end < start) {
      issues.push({
        rowNumber: row.rowNumber,
        field: 'period_end',
        code: 'PERIOD_END_BEFORE_START',
        message: `Periodslut ${end} ligger före periodstart ${start}`,
        severity: 'error',
      });
    }

    // In-file duplicate detection on natural keys.
    const naturalKey = ['decision_number', 'claim_number', 'invoice_number', 'application_number']
      .map((k) => row.values[k])
      .filter(Boolean)
      .join('|');
    const paymentKey =
      type.key.endsWith('_payments') || type.key === 'payment_files'
        ? `${row.values['personnummer'] ?? row.values['household_number'] ?? ''}|${row.values['amount_sek'] ?? ''}|${row.values['payment_date'] ?? ''}`
        : '';
    const dupeKey = naturalKey || paymentKey;
    if (dupeKey && dupeKey !== '|' && dupeKey !== '||') {
      const firstRow = seenKeys.get(`${type.key}:${dupeKey}`);
      if (firstRow !== undefined) {
        issues.push({
          rowNumber: row.rowNumber,
          field: undefined,
          code: 'DUPLICATE_ROW',
          message: `Raden verkar vara en dubblett av rad ${firstRow}`,
          severity: type.key.endsWith('_payments') ? 'error' : 'warning',
        });
      } else {
        seenKeys.set(`${type.key}:${dupeKey}`, row.rowNumber);
      }
    }
  }
  return issues;
}
