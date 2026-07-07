import { describe, expect, it } from 'vitest';
import { detectCuriosityBrowsing, type AccessEventSample } from './curiosity-detection';
import { evaluateReveal, maskValue } from './reveal';

describe('evaluateReveal', () => {
  it('blocks sensitive reveal without reason', () => {
    const decision = evaluateReveal({
      userId: 'u1',
      entityKind: 'person',
      entityId: 'p1',
      fieldKey: 'income',
      dataClass: 'income_data',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.error).toContain('skäl');
  });

  it('blocks too-short reasons', () => {
    const decision = evaluateReveal({
      userId: 'u1',
      entityKind: 'person',
      entityId: 'p1',
      fieldKey: 'income',
      dataClass: 'income_data',
      reason: 'kolla',
    });
    expect(decision.allowed).toBe(false);
  });

  it('allows reveal with adequate reason and demands logging', () => {
    const decision = evaluateReveal({
      userId: 'u1',
      entityKind: 'person',
      entityId: 'p1',
      fieldKey: 'income',
      dataClass: 'income_data',
      reason: 'Kontroll av inkomstuppgift i pågående ärende EA-123',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.mustLog).toBe(true);
  });
});

describe('maskValue', () => {
  it('masks bank accounts keeping last 4 digits', () => {
    expect(maskValue('12345678901', 'bank_account_payment_recipient')).toBe('••••8901');
  });
  it('masks personnummer-style values keeping year part', () => {
    expect(maskValue('198112189876', 'personal_data')).toBe('1981••••••••');
  });
  it('handles empty values', () => {
    expect(maskValue(null, 'income_data')).toBe('');
  });
});

function event(overrides: Partial<AccessEventSample>): AccessEventSample {
  return {
    actorUserId: 'u1',
    accessKind: 'person_record_open',
    hasCaseAssignment: true,
    hasReason: true,
    occurredAt: new Date('2026-07-07T10:00:00Z'),
    ...overrides,
  };
}

describe('detectCuriosityBrowsing', () => {
  it('returns nothing for normal activity', () => {
    const events = Array.from({ length: 10 }, () => event({}));
    expect(detectCuriosityBrowsing(events)).toHaveLength(0);
  });

  it('flags high-volume person access', () => {
    const events = Array.from({ length: 80 }, () => event({}));
    const findings = detectCuriosityBrowsing(events);
    expect(findings.some((f) => f.findingKind === 'high_volume_person_access')).toBe(true);
  });

  it('flags repeated searches on the same person', () => {
    const events = Array.from({ length: 8 }, () =>
      event({ accessKind: 'person_search', personId: 'person-x' }),
    );
    const findings = detectCuriosityBrowsing(events);
    const finding = findings.find((f) => f.findingKind === 'repeated_search_same_person');
    expect(finding?.severity).toBe('high');
  });

  it('flags protected identity access without case as critical', () => {
    const findings = detectCuriosityBrowsing([
      event({ accessKind: 'protected_identity_view', hasCaseAssignment: false }),
    ]);
    expect(findings[0]?.severity).toBe('critical');
  });

  it('flags off-hours access', () => {
    const events = Array.from({ length: 12 }, () =>
      event({ occurredAt: new Date('2026-07-07T23:30:00Z') }),
    );
    const findings = detectCuriosityBrowsing(events);
    expect(findings.some((f) => f.findingKind === 'off_hours_access')).toBe(true);
  });

  it('flags case opens without assignment or reason', () => {
    const findings = detectCuriosityBrowsing([
      event({ accessKind: 'case_open', hasCaseAssignment: false, hasReason: false }),
    ]);
    expect(findings.some((f) => f.findingKind === 'access_without_case_assignment')).toBe(true);
  });
});
