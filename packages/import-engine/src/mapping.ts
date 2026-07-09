import type { ParsedTable } from './parsers';

export interface FieldMapping {
  sourceColumn: string;
  targetField: string;
  transform?:
    'trim' | 'uppercase' | 'lowercase' | 'date_iso' | 'amount_sek' | 'personnummer_normalize';
  required: boolean;
}

export interface MappingTemplate {
  templateKey: string;
  name: string;
  sourceSystemHint?: string;
  importKind: string;
  mappings: FieldMapping[];
}

export interface MappedRow {
  rowNumber: number;
  values: Record<string, string>;
  errors: string[];
}

export interface MappingResult {
  rows: MappedRow[];
  errorCount: number;
}

export function applyTransform(value: string, transform: FieldMapping['transform']): string {
  switch (transform) {
    case 'trim':
      return value.trim();
    case 'uppercase':
      return value.toUpperCase();
    case 'lowercase':
      return value.toLowerCase();
    case 'date_iso': {
      const normalized = value.trim().replaceAll('/', '-').replaceAll('.', '-');
      const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!match) return value.trim();
      return `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`;
    }
    case 'amount_sek': {
      const cleaned = value
        .replace(/[\s\u00a0]/g, '')
        .replace(',', '.')
        .replace(/kr$/i, '');
      return cleaned;
    }
    case 'personnummer_normalize':
      return value.replace(/\s/g, '');
    default:
      return value;
  }
}

export function applyMapping(table: ParsedTable, template: MappingTemplate): MappingResult {
  const rows: MappedRow[] = table.rows.map((sourceRow, index) => {
    const values: Record<string, string> = {};
    const errors: string[] = [];
    for (const mapping of template.mappings) {
      const raw = sourceRow[mapping.sourceColumn];
      if (raw === undefined || raw === '') {
        if (mapping.required) {
          errors.push(
            `Missing required field "${mapping.targetField}" (column "${mapping.sourceColumn}")`,
          );
        }
        continue;
      }
      values[mapping.targetField] = applyTransform(raw, mapping.transform);
    }
    return { rowNumber: index + 1, values, errors };
  });
  return { rows, errorCount: rows.filter((r) => r.errors.length > 0).length };
}

/** Suggests mapping candidates by fuzzy column-name matching (mapping wizard). */
export function suggestMappings(
  columns: string[],
  targetFields: string[],
): Array<{ sourceColumn: string; targetField: string; confidence: number }> {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-zåäö0-9]/g, '');
  const suggestions: Array<{ sourceColumn: string; targetField: string; confidence: number }> = [];
  for (const column of columns) {
    const normalizedColumn = normalize(column);
    for (const target of targetFields) {
      const normalizedTarget = normalize(target);
      let confidence = 0;
      if (normalizedColumn === normalizedTarget) confidence = 1;
      else if (
        normalizedColumn.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedColumn)
      ) {
        confidence = 0.7;
      }
      if (confidence > 0) {
        suggestions.push({ sourceColumn: column, targetField: target, confidence });
      }
    }
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence);
}
