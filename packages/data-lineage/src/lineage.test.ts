import { describe, expect, it } from 'vitest';
import {
  checkEntityLineage,
  isLineageComplete,
  resolveSystemOfRecord,
  type LineageRecord,
} from './lineage';

function record(overrides: Partial<LineageRecord> = {}): LineageRecord {
  return {
    entityKind: 'lss_decision',
    entityId: 'd1',
    fieldKey: 'hours_per_week',
    sourceSystemId: 'sys-1',
    sourceRecordLinkId: 'link-1',
    importBatchId: 'batch-1',
    usedInDecision: true,
    usedInPayment: false,
    ...overrides,
  };
}

describe('isLineageComplete', () => {
  it('is complete with source system and record link', () => {
    expect(isLineageComplete(record())).toBe(true);
  });
  it('is incomplete without source system', () => {
    const r = record();
    delete r.sourceSystemId;
    expect(isLineageComplete(r)).toBe(false);
  });
  it('is incomplete when imported without source record link', () => {
    const r = record();
    delete r.sourceRecordLinkId;
    expect(isLineageComplete(r)).toBe(false);
  });
  it('manually entered data (no import batch) needs only source system', () => {
    const r = record();
    delete r.importBatchId;
    delete r.sourceRecordLinkId;
    expect(isLineageComplete(r)).toBe(true);
  });
});

describe('checkEntityLineage', () => {
  it('reports missing and incomplete fields', () => {
    const incomplete = record({ fieldKey: 'amount' });
    delete incomplete.sourceSystemId;
    const result = checkEntityLineage(
      ['hours_per_week', 'amount', 'decision_date'],
      [record(), incomplete],
    );
    expect(result.complete).toBe(false);
    expect(result.missingFields).toEqual(['decision_date']);
    expect(result.fieldsWithoutSource).toEqual(['amount']);
  });

  it('passes when all fields have complete lineage', () => {
    const result = checkEntityLineage(['hours_per_week'], [record()]);
    expect(result.complete).toBe(true);
  });
});

describe('resolveSystemOfRecord', () => {
  const definitions = [
    { entityKind: 'lss_decision', sourceSystemId: 'sys-entity', validFrom: '2026-01-01' },
    {
      entityKind: 'lss_decision',
      fieldKey: 'hours_per_week',
      sourceSystemId: 'sys-field',
      validFrom: '2026-01-01',
    },
    {
      entityKind: 'lss_decision',
      fieldKey: 'old_field',
      sourceSystemId: 'sys-old',
      validFrom: '2020-01-01',
      validTo: '2025-12-31',
    },
  ];

  it('prefers field-specific definitions', () => {
    const resolved = resolveSystemOfRecord(
      definitions,
      'lss_decision',
      'hours_per_week',
      '2026-07-01',
    );
    expect(resolved?.sourceSystemId).toBe('sys-field');
  });

  it('falls back to entity-wide definitions', () => {
    const resolved = resolveSystemOfRecord(
      definitions,
      'lss_decision',
      'other_field',
      '2026-07-01',
    );
    expect(resolved?.sourceSystemId).toBe('sys-entity');
  });

  it('respects validity windows', () => {
    const resolved = resolveSystemOfRecord(definitions, 'lss_decision', 'old_field', '2026-07-01');
    expect(resolved?.sourceSystemId).toBe('sys-entity');
  });
});
