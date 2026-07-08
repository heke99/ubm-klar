import { createHash } from 'node:crypto';

export interface RetentionRule {
  ruleKey: string;
  classificationKey: string;
  triggerEvent:
    | 'case_closed'
    | 'decision_expired'
    | 'payment_completed'
    | 'person_deceased'
    | 'fixed_date';
  retentionYears: number;
  action: 'dispose' | 'archive' | 'review';
  isActive: boolean;
}

export interface RetentionCandidate {
  entityKind: string;
  entityId: string;
  classificationKey: string;
  triggerEvent: RetentionRule['triggerEvent'];
  triggerDate: string;
  legalHoldKeys: string[];
}

export interface RetentionEvaluation {
  entityKind: string;
  entityId: string;
  due: boolean;
  action?: RetentionRule['action'];
  ruleKey?: string;
  blockedByLegalHold: boolean;
  dueDate?: string;
  explanation: string;
}

function addYears(date: string, years: number): string {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * Evaluates retention for a candidate. Legal holds always win: a held record is
 * never disposed regardless of retention rules.
 */
export function evaluateRetention(
  candidate: RetentionCandidate,
  rules: RetentionRule[],
  today: string,
): RetentionEvaluation {
  const base = { entityKind: candidate.entityKind, entityId: candidate.entityId };
  const rule = rules.find(
    (r) =>
      r.isActive &&
      r.classificationKey === candidate.classificationKey &&
      r.triggerEvent === candidate.triggerEvent,
  );
  if (!rule) {
    return {
      ...base,
      due: false,
      blockedByLegalHold: false,
      explanation: 'Ingen aktiv gallringsregel matchar posten. Manuell bedömning krävs.',
    };
  }
  const dueDate = addYears(candidate.triggerDate, rule.retentionYears);
  if (candidate.legalHoldKeys.length > 0) {
    return {
      ...base,
      due: false,
      blockedByLegalHold: true,
      ruleKey: rule.ruleKey,
      dueDate,
      explanation: `Posten omfattas av rättsligt undantag (${candidate.legalHoldKeys.join(', ')}) och får inte gallras.`,
    };
  }
  if (dueDate > today) {
    return {
      ...base,
      due: false,
      blockedByLegalHold: false,
      ruleKey: rule.ruleKey,
      dueDate,
      explanation: `Gallring/arkivering förfaller ${dueDate}.`,
    };
  }
  return {
    ...base,
    due: true,
    action: rule.action,
    ruleKey: rule.ruleKey,
    blockedByLegalHold: false,
    dueDate,
    explanation: `Åtgärden "${rule.action}" förföll ${dueDate}.`,
  };
}

export interface EArchiveEntry {
  entityKind: string;
  entityId: string;
  content: string;
  metadata: Record<string, string>;
}

export interface EArchivePackage {
  packageNumber: string;
  format: 'fgs_paket' | 'oais_sip' | 'zip_manifest';
  manifest: {
    packageNumber: string;
    createdAt: string;
    entryCount: number;
    entries: Array<{
      entityKind: string;
      entityId: string;
      contentHashSha256: string;
      metadata: Record<string, string>;
    }>;
  };
  manifestHashSha256: string;
  contentHashSha256: string;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function buildEArchivePackage(
  packageNumber: string,
  entries: EArchiveEntry[],
  format: EArchivePackage['format'] = 'zip_manifest',
  clock: () => Date = () => new Date(),
): EArchivePackage {
  const sorted = [...entries].sort((a, b) =>
    `${a.entityKind}:${a.entityId}`.localeCompare(`${b.entityKind}:${b.entityId}`),
  );
  const manifestEntries = sorted.map((entry) => ({
    entityKind: entry.entityKind,
    entityId: entry.entityId,
    contentHashSha256: sha256(entry.content),
    metadata: entry.metadata,
  }));
  const manifest = {
    packageNumber,
    createdAt: clock().toISOString(),
    entryCount: manifestEntries.length,
    entries: manifestEntries,
  };
  const contentHash = sha256(sorted.map((e) => e.content).join('\n'));
  return {
    packageNumber,
    format,
    manifest,
    manifestHashSha256: sha256(JSON.stringify(manifest)),
    contentHashSha256: contentHash,
  };
}

/** Verifies that package content still matches the manifest (checksum audit). */
export function verifyEArchivePackage(
  pkg: EArchivePackage,
  entries: EArchiveEntry[],
): { valid: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const byKey = new Map(entries.map((e) => [`${e.entityKind}:${e.entityId}`, e]));
  for (const manifestEntry of pkg.manifest.entries) {
    const key = `${manifestEntry.entityKind}:${manifestEntry.entityId}`;
    const entry = byKey.get(key);
    if (!entry) {
      mismatches.push(`${key}: saknas i innehållet`);
      continue;
    }
    if (sha256(entry.content) !== manifestEntry.contentHashSha256) {
      mismatches.push(`${key}: innehållets kontrollsumma avviker från manifestet`);
    }
  }
  return { valid: mismatches.length === 0, mismatches };
}
