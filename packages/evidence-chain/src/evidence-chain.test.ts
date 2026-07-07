import { describe, expect, it } from 'vitest';
import { EvidenceChain, hashArtifact } from './evidence-chain';

describe('EvidenceChain', () => {
  it('appends hash-linked entries with sequence numbers', () => {
    const chain = new EvidenceChain('control_case', 'case-1');
    const first = chain.append({
      subjectKind: 'control_case',
      subjectId: 'case-1',
      entryKind: 'risk_flag',
      artifactReference: 'risk-flag-1',
      artifactHashSha256: hashArtifact('flag payload'),
      occurredAt: '2026-07-07T10:00:00Z',
    });
    const second = chain.append({
      subjectKind: 'control_case',
      subjectId: 'case-1',
      entryKind: 'review_decision',
      artifactReference: 'review-1',
      occurredAt: '2026-07-07T11:00:00Z',
    });
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(second.previousEntryHash).toBe(first.entryHash);
    expect(chain.verify().valid).toBe(true);
  });

  it('rejects entries for another subject', () => {
    const chain = new EvidenceChain('control_case', 'case-1');
    expect(() =>
      chain.append({
        subjectKind: 'control_case',
        subjectId: 'case-2',
        entryKind: 'note',
        artifactReference: 'x',
        occurredAt: '2026-07-07T10:00:00Z',
      }),
    ).toThrow('does not match');
  });

  it('detects tampering', () => {
    const chain = new EvidenceChain('ubm_export', 'export-1');
    chain.append({
      subjectKind: 'ubm_export',
      subjectId: 'export-1',
      entryKind: 'export_package',
      artifactReference: 'pkg-1',
      artifactHashSha256: hashArtifact('package'),
      occurredAt: '2026-07-07T10:00:00Z',
    });
    chain.append({
      subjectKind: 'ubm_export',
      subjectId: 'export-1',
      entryKind: 'receipt',
      artifactReference: 'receipt-1',
      occurredAt: '2026-07-07T12:00:00Z',
    });
    const entries = [...chain.list()].map((e) => ({ ...e }));
    entries[0]!.artifactReference = 'pkg-tampered';
    const rebuilt = new EvidenceChain('ubm_export', 'export-1', entries);
    expect(rebuilt.verify().valid).toBe(false);
  });
});
