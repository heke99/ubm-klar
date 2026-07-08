import { describe, expect, it } from 'vitest';
import { isValidPersonnummerFormat, type DataQualitySubject } from './checks';
import { aggregateStatus, buildReport, DataQualityEngine } from './engine';

function subject(overrides: Partial<DataQualitySubject> = {}): DataQualitySubject {
  return {
    entityKind: 'payment',
    entityId: 'pay-1',
    fields: {},
    context: {},
    ...overrides,
  };
}

describe('isValidPersonnummerFormat', () => {
  it('accepts valid personnummer', () => {
    expect(isValidPersonnummerFormat('811218-9876')).toBe(true);
    expect(isValidPersonnummerFormat('19811218-9876')).toBe(true);
  });
  it('rejects invalid check digits and dates', () => {
    expect(isValidPersonnummerFormat('811218-9875')).toBe(false);
    expect(isValidPersonnummerFormat('811318-9876')).toBe(false);
    expect(isValidPersonnummerFormat('12345')).toBe(false);
  });
});

describe('DataQualityEngine', () => {
  const engine = new DataQualityEngine();

  it('passes clean payments', () => {
    const result = engine.run(
      subject({
        context: {
          hasDecision: true,
          paymentInsideDecisionPeriod: true,
          hasRecipient: true,
          lineageComplete: true,
        },
      }),
    );
    expect(result.overallStatus).toBe('valid');
    expect(result.findings).toHaveLength(0);
  });

  it('blocks payments without decision', () => {
    const result = engine.run(subject({ context: { hasDecision: false } }));
    expect(result.overallStatus).toBe('blocked');
    expect(result.findings.map((f) => f.checkKey)).toContain('payment_without_decision');
  });

  it('flags missing personnummer as blocked', () => {
    const result = engine.run(
      subject({ entityKind: 'person', fields: { personal_identity_number: '' } }),
    );
    expect(result.overallStatus).toBe('blocked');
  });

  it('sends invalid personnummer to manual review but accepts synthetic demo data', () => {
    const invalid = engine.run(
      subject({ entityKind: 'person', fields: { personal_identity_number: '811218-9875' } }),
    );
    expect(invalid.overallStatus).toBe('requires_manual_review');

    const synthetic = engine.run(
      subject({
        entityKind: 'person',
        fields: { personal_identity_number: '999999-TEST', is_synthetic: true },
      }),
    );
    expect(synthetic.findings.map((f) => f.checkKey)).not.toContain(
      'invalid_personal_identity_number_format',
    );
  });

  it('routes lineage problems to requires_lineage_fix', () => {
    const result = engine.run(subject({ context: { lineageComplete: false } }));
    expect(result.overallStatus).toBe('requires_lineage_fix');
  });

  it('routes missing legal basis to legal review and missing purpose to DPO review', () => {
    const legal = engine.run(subject({ context: { hasLegalBasis: false } }));
    expect(legal.overallStatus).toBe('requires_legal_review');
    const dpo = engine.run(subject({ context: { hasPurpose: false } }));
    expect(dpo.overallStatus).toBe('requires_dpo_review');
  });

  it('flags invalid periods', () => {
    const result = engine.run(
      subject({ fields: { period_start: '2026-05-01', period_end: '2026-04-01' } }),
    );
    expect(result.overallStatus).toBe('blocked');
  });

  it('flags UBM mapping gaps', () => {
    const result = engine.run(subject({ context: { hasUbmMapping: false } }));
    expect(result.overallStatus).toBe('requires_mapping_fix');
  });

  it('requires DPO approval only when required', () => {
    const required = engine.run(
      subject({ context: { dpoLegalApprovalRequired: true, dpoLegalApprovalPresent: false } }),
    );
    expect(required.overallStatus).toBe('requires_dpo_review');
    const present = engine.run(
      subject({ context: { dpoLegalApprovalRequired: true, dpoLegalApprovalPresent: true } }),
    );
    expect(present.overallStatus).toBe('valid');
  });

  it('aggregates worst status', () => {
    expect(
      aggregateStatus([
        { checkKey: 'a', status: 'valid_with_warning', message: '' },
        { checkKey: 'b', status: 'blocked', message: '' },
        { checkKey: 'c', status: 'requires_manual_review', message: '' },
      ]),
    ).toBe('blocked');
  });

  it('builds reports', () => {
    const results = engine.runBatch([
      subject({ context: { hasDecision: false } }),
      subject({ context: { hasDecision: true, hasRecipient: true } }),
    ]);
    const report = buildReport(results);
    expect(report.total).toBe(2);
    expect(report.byStatus.blocked).toBe(1);
    expect(report.blockedShare).toBe(0.5);
  });
});
