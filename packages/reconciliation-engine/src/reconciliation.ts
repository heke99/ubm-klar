import type { RiskSeverity } from '@ubm-klar/shared-types';

/** A row from an imported payment file, normalized. */
export interface PaymentFileRow {
  id: string;
  externalReference?: string;
  recipientAccountReference?: string;
  recipientOrgNumber?: string;
  personId?: string;
  organizationId?: string;
  amountSek: number;
  paymentDate: string;
  bookedStatus?: 'pending' | 'booked' | 'confirmed' | 'rejected' | 'reversed';
}

/** An expected payment from a decision (LSS or economic assistance). */
export interface ExpectedPayment {
  id: string;
  kind: 'lss_payment' | 'ea_payment';
  personId?: string;
  organizationId?: string;
  decisionId?: string;
  decisionPeriodStart?: string;
  decisionPeriodEnd?: string;
  approvedAmountSek?: number;
  amountSek: number;
  scheduledDate?: string;
  recipientAccountReference?: string;
  status: string;
}

export interface RecipientRegistryEntry {
  recipientKind: 'person' | 'organization';
  personId?: string;
  organizationId?: string;
  accountReference: string;
  verified: boolean;
  validFrom: string;
  validTo?: string;
  /** Most recent account change date, if any. */
  lastAccountChangeAt?: string;
}

export interface BlocklistEntry {
  blockedKind: 'person' | 'organization' | 'account_reference';
  personId?: string;
  organizationId?: string;
  accountReference?: string;
  validFrom: string;
  validTo?: string;
}

export interface ActiveRecoveryClaim {
  claimId: string;
  personId?: string;
  organizationId?: string;
}

export type ReconciliationResultKind =
  | 'matched'
  | 'duplicate_payment'
  | 'missing_decision'
  | 'outside_decision_period'
  | 'blocked_recipient'
  | 'account_changed_near_payment'
  | 'recipient_mismatch'
  | 'recovery_claim_conflict'
  | 'amount_mismatch'
  | 'unmatched';

export interface ReconciliationResult {
  rowId: string;
  resultKind: ReconciliationResultKind;
  severity: RiskSeverity;
  explanation: string;
  matchedPaymentId?: string;
  evidenceReferences: string[];
}

export interface ReconciliationInput {
  rows: PaymentFileRow[];
  expectedPayments: ExpectedPayment[];
  recipientRegistry: RecipientRegistryEntry[];
  blocklist: BlocklistEntry[];
  activeRecoveryClaims: ActiveRecoveryClaim[];
  /** Days before payment where an account change is considered suspicious. */
  accountChangeWindowDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS;
}

function isActive(entry: { validFrom: string; validTo?: string }, date: string): boolean {
  return entry.validFrom <= date && (!entry.validTo || entry.validTo >= date);
}

/**
 * Reconciles imported payment file rows against expected payments, the
 * recipient registry, blocklists and active recovery claims. Every finding is
 * explainable and carries evidence references.
 */
export function reconcilePaymentFile(input: ReconciliationInput): ReconciliationResult[] {
  const results: ReconciliationResult[] = [];
  const windowDays = input.accountChangeWindowDays ?? 14;
  const matchedPaymentIds = new Set<string>();
  const seenRowSignatures = new Map<string, string>();

  for (const row of input.rows) {
    const evidence = [`payment_file_row:${row.id}`];

    // 1. Blocklist check (hard stop)
    const blocked = input.blocklist.find(
      (entry) =>
        isActive(entry, row.paymentDate) &&
        ((entry.blockedKind === 'person' && entry.personId && entry.personId === row.personId) ||
          (entry.blockedKind === 'organization' &&
            entry.organizationId &&
            entry.organizationId === row.organizationId) ||
          (entry.blockedKind === 'account_reference' &&
            entry.accountReference &&
            entry.accountReference === row.recipientAccountReference)),
    );
    if (blocked) {
      results.push({
        rowId: row.id,
        resultKind: 'blocked_recipient',
        severity: 'critical',
        explanation: 'Utbetalning till spärrad mottagare i betalningsfilen.',
        evidenceReferences: [...evidence, 'blocklist_entry'],
      });
      continue;
    }

    // 2. Duplicate check within the file (same person/org + amount + date)
    const signature = `${row.personId ?? row.organizationId ?? 'unknown'}|${row.amountSek}|${row.paymentDate}`;
    const duplicateOf = seenRowSignatures.get(signature);
    if (duplicateOf) {
      results.push({
        rowId: row.id,
        resultKind: 'duplicate_payment',
        severity: 'high',
        explanation: `Möjlig dubblettutbetalning: samma mottagare, belopp och datum som rad ${duplicateOf}.`,
        evidenceReferences: [...evidence, `payment_file_row:${duplicateOf}`],
      });
      continue;
    }
    seenRowSignatures.set(signature, row.id);

    // 3. Match to expected payment
    const candidates = input.expectedPayments.filter(
      (p) =>
        !matchedPaymentIds.has(p.id) &&
        ((p.personId && p.personId === row.personId) ||
          (p.organizationId && p.organizationId === row.organizationId)) &&
        Math.abs(p.amountSek - row.amountSek) < 0.005,
    );
    const match = candidates[0];

    if (!match) {
      const anyForRecipient = input.expectedPayments.some(
        (p) =>
          (p.personId && p.personId === row.personId) ||
          (p.organizationId && p.organizationId === row.organizationId),
      );
      results.push({
        rowId: row.id,
        resultKind: anyForRecipient ? 'amount_mismatch' : 'missing_decision',
        severity: anyForRecipient ? 'medium' : 'high',
        explanation: anyForRecipient
          ? 'Beloppet i betalningsfilen matchar ingen förväntad utbetalning för mottagaren.'
          : 'Utbetalningen i filen saknar koppling till godkänt beslut.',
        evidenceReferences: evidence,
      });
      continue;
    }
    matchedPaymentIds.add(match.id);
    evidence.push(`${match.kind}:${match.id}`);

    // 4. Decision period check
    if (
      match.decisionPeriodStart &&
      match.decisionPeriodEnd &&
      (row.paymentDate < match.decisionPeriodStart || row.paymentDate > match.decisionPeriodEnd)
    ) {
      results.push({
        rowId: row.id,
        resultKind: 'outside_decision_period',
        severity: 'high',
        explanation: `Utbetalningsdatum ${row.paymentDate} ligger utanför beslutsperioden ${match.decisionPeriodStart}–${match.decisionPeriodEnd}.`,
        matchedPaymentId: match.id,
        evidenceReferences: evidence,
      });
      continue;
    }

    // 5. Recovery claim conflict
    const claim = input.activeRecoveryClaims.find(
      (c) =>
        (c.personId && c.personId === row.personId) ||
        (c.organizationId && c.organizationId === row.organizationId),
    );
    if (claim) {
      results.push({
        rowId: row.id,
        resultKind: 'recovery_claim_conflict',
        severity: 'high',
        explanation: 'Ny utbetalning till mottagare med aktivt återkrav utan kontroll.',
        matchedPaymentId: match.id,
        evidenceReferences: [...evidence, `recovery_claim:${claim.claimId}`],
      });
      continue;
    }

    // 6. Recipient registry checks
    const registryEntry = input.recipientRegistry.find(
      (entry) =>
        isActive(entry, row.paymentDate) &&
        ((entry.personId && entry.personId === row.personId) ||
          (entry.organizationId && entry.organizationId === row.organizationId)),
    );
    if (
      registryEntry &&
      row.recipientAccountReference &&
      registryEntry.accountReference !== row.recipientAccountReference
    ) {
      results.push({
        rowId: row.id,
        resultKind: 'recipient_mismatch',
        severity: 'critical',
        explanation: 'Kontot i betalningsfilen avviker från verifierat konto i mottagarregistret.',
        matchedPaymentId: match.id,
        evidenceReferences: [...evidence, 'payment_recipient_registry'],
      });
      continue;
    }
    if (
      registryEntry?.lastAccountChangeAt &&
      daysBetween(registryEntry.lastAccountChangeAt, row.paymentDate) <= windowDays
    ) {
      results.push({
        rowId: row.id,
        resultKind: 'account_changed_near_payment',
        severity: 'high',
        explanation: `Mottagarkontot ändrades inom ${windowDays} dagar före utbetalningen.`,
        matchedPaymentId: match.id,
        evidenceReferences: [...evidence, 'payment_account_change_log'],
      });
      continue;
    }

    results.push({
      rowId: row.id,
      resultKind: 'matched',
      severity: 'info',
      explanation: 'Utbetalningen matchar beslut, mottagare och period.',
      matchedPaymentId: match.id,
      evidenceReferences: evidence,
    });
  }

  return results;
}

export interface ReconciliationSummary {
  total: number;
  matched: number;
  flagged: number;
  byKind: Record<ReconciliationResultKind, number>;
}

export function summarizeReconciliation(results: ReconciliationResult[]): ReconciliationSummary {
  const byKind = {} as Record<ReconciliationResultKind, number>;
  for (const result of results) {
    byKind[result.resultKind] = (byKind[result.resultKind] ?? 0) + 1;
  }
  const matched = byKind.matched ?? 0;
  return { total: results.length, matched, flagged: results.length - matched, byKind };
}
