import { createHash } from 'node:crypto';

/**
 * Evidence chain: an append-only, hash-linked series of evidence entries
 * attached to a subject (control case, UBM export, payment flag, ...).
 * Each entry records what artifact it points to and the artifact's hash,
 * so the full trail can be verified later (court/audit quality).
 */
export interface EvidenceEntry {
  sequence: number;
  subjectKind: string;
  subjectId: string;
  entryKind:
    | 'source_record'
    | 'import_batch'
    | 'data_quality_result'
    | 'risk_flag'
    | 'rule_version'
    | 'schema_version'
    | 'legal_source_version'
    | 'document'
    | 'redaction'
    | 'review_decision'
    | 'approval'
    | 'export_package'
    | 'receipt'
    | 'status_change'
    | 'note';
  artifactReference: string;
  artifactHashSha256?: string;
  actorUserId?: string;
  occurredAt: string;
  previousEntryHash: string | null;
  entryHash: string;
}

export type EvidenceEntryInput = Omit<
  EvidenceEntry,
  'sequence' | 'previousEntryHash' | 'entryHash'
>;

export function hashArtifact(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function computeEntryHash(entry: Omit<EvidenceEntry, 'entryHash'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sequence: entry.sequence,
        subjectKind: entry.subjectKind,
        subjectId: entry.subjectId,
        entryKind: entry.entryKind,
        artifactReference: entry.artifactReference,
        artifactHashSha256: entry.artifactHashSha256 ?? null,
        occurredAt: entry.occurredAt,
        previousEntryHash: entry.previousEntryHash,
      }),
    )
    .digest('hex');
}

export class EvidenceChain {
  private entries: EvidenceEntry[] = [];

  constructor(
    readonly subjectKind: string,
    readonly subjectId: string,
    existingEntries: EvidenceEntry[] = [],
  ) {
    this.entries = [...existingEntries];
  }

  append(input: EvidenceEntryInput): EvidenceEntry {
    if (input.subjectKind !== this.subjectKind || input.subjectId !== this.subjectId) {
      throw new Error('Evidence entry subject does not match this chain');
    }
    const previous = this.entries.at(-1);
    const withoutHash: Omit<EvidenceEntry, 'entryHash'> = {
      ...input,
      sequence: (previous?.sequence ?? 0) + 1,
      previousEntryHash: previous?.entryHash ?? null,
    };
    const entry: EvidenceEntry = { ...withoutHash, entryHash: computeEntryHash(withoutHash) };
    this.entries.push(entry);
    return entry;
  }

  list(): readonly EvidenceEntry[] {
    return this.entries;
  }

  verify(): { valid: boolean; brokenAtSequence?: number } {
    let previousHash: string | null = null;
    for (const entry of this.entries) {
      if (entry.previousEntryHash !== previousHash) {
        return { valid: false, brokenAtSequence: entry.sequence };
      }
      const { entryHash: _ignored, ...rest } = entry;
      if (computeEntryHash(rest) !== entry.entryHash) {
        return { valid: false, brokenAtSequence: entry.sequence };
      }
      previousHash = entry.entryHash;
    }
    return { valid: true };
  }
}
