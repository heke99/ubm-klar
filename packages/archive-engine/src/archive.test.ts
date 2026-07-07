import { describe, expect, it } from 'vitest';
import {
  buildEArchivePackage,
  evaluateRetention,
  verifyEArchivePackage,
  type RetentionCandidate,
  type RetentionRule,
} from './archive';

const rules: RetentionRule[] = [
  {
    ruleKey: 'ea_case_5y',
    classificationKey: 'ea_case',
    triggerEvent: 'case_closed',
    retentionYears: 5,
    action: 'dispose',
    isActive: true,
  },
  {
    ruleKey: 'lss_decision_archive',
    classificationKey: 'lss_decision',
    triggerEvent: 'decision_expired',
    retentionYears: 10,
    action: 'archive',
    isActive: true,
  },
];

function candidate(overrides: Partial<RetentionCandidate> = {}): RetentionCandidate {
  return {
    entityKind: 'ea_case',
    entityId: 'c1',
    classificationKey: 'ea_case',
    triggerEvent: 'case_closed',
    triggerDate: '2020-01-15',
    legalHoldKeys: [],
    ...overrides,
  };
}

describe('evaluateRetention', () => {
  it('marks records due after the retention period', () => {
    const result = evaluateRetention(candidate(), rules, '2026-07-07');
    expect(result.due).toBe(true);
    expect(result.action).toBe('dispose');
    expect(result.dueDate).toBe('2025-01-15');
  });

  it('is not due before the retention period ends', () => {
    const result = evaluateRetention(candidate({ triggerDate: '2024-01-15' }), rules, '2026-07-07');
    expect(result.due).toBe(false);
    expect(result.dueDate).toBe('2029-01-15');
  });

  it('legal holds always block disposal', () => {
    const result = evaluateRetention(
      candidate({ legalHoldKeys: ['hold-ubm-audit'] }),
      rules,
      '2026-07-07',
    );
    expect(result.due).toBe(false);
    expect(result.blockedByLegalHold).toBe(true);
  });

  it('requires manual review when no rule matches', () => {
    const result = evaluateRetention(
      candidate({ classificationKey: 'unknown_class' }),
      rules,
      '2026-07-07',
    );
    expect(result.due).toBe(false);
    expect(result.explanation).toContain('Manuell bedömning');
  });
});

describe('e-archive packages', () => {
  const entries = [
    { entityKind: 'ea_decision', entityId: 'd1', content: 'beslut-innehåll-1', metadata: { year: '2026' } },
    { entityKind: 'ea_decision', entityId: 'd2', content: 'beslut-innehåll-2', metadata: { year: '2026' } },
  ];

  it('builds packages with manifests and checksums', () => {
    const pkg = buildEArchivePackage('EARK-2026-001', entries);
    expect(pkg.manifest.entryCount).toBe(2);
    expect(pkg.manifestHashSha256).toHaveLength(64);
    expect(verifyEArchivePackage(pkg, entries).valid).toBe(true);
  });

  it('detects content tampering during verification', () => {
    const pkg = buildEArchivePackage('EARK-2026-002', entries);
    const tampered = [entries[0]!, { ...entries[1]!, content: 'manipulerat' }];
    const result = verifyEArchivePackage(pkg, tampered);
    expect(result.valid).toBe(false);
    expect(result.mismatches[0]).toContain('d2');
  });

  it('detects missing entries', () => {
    const pkg = buildEArchivePackage('EARK-2026-003', entries);
    const result = verifyEArchivePackage(pkg, [entries[0]!]);
    expect(result.valid).toBe(false);
  });
});
