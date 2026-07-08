/**
 * UBM notification matching with confidence scoring. Uncertain matches go to
 * manual review instead of being auto-linked.
 */
export interface NotificationSubjectHints {
  personalIdentityNumber?: string;
  orgNumber?: string;
  nameFragment?: string;
  decisionNumber?: string;
  paymentReference?: string;
  amountSek?: number;
  paymentDate?: string;
}

export interface MatchCandidate {
  candidateKind: 'person' | 'case' | 'decision' | 'payment';
  candidateId: string;
  personalIdentityNumber?: string;
  orgNumber?: string;
  name?: string;
  decisionNumber?: string;
  paymentReference?: string;
  amountSek?: number;
  paymentDate?: string;
}

export interface ScoredCandidate {
  candidateKind: MatchCandidate['candidateKind'];
  candidateId: string;
  score: number;
  scoreBasis: string[];
}

export interface NotificationMatchResult {
  candidates: ScoredCandidate[];
  best?: ScoredCandidate;
  decision: 'auto_matched' | 'manual_review' | 'no_match';
}

export const AUTO_MATCH_THRESHOLD = 0.9;
/** Any candidate scoring at or above this goes to a human instead of being dropped. */
export const REVIEW_THRESHOLD = 0.2;

export function scoreCandidate(
  hints: NotificationSubjectHints,
  candidate: MatchCandidate,
): ScoredCandidate {
  let score = 0;
  const basis: string[] = [];

  if (
    hints.personalIdentityNumber &&
    candidate.personalIdentityNumber &&
    hints.personalIdentityNumber.replace(/[-+]/g, '') ===
      candidate.personalIdentityNumber.replace(/[-+]/g, '')
  ) {
    score += 0.6;
    basis.push('personnummer_exact');
  }
  if (hints.orgNumber && candidate.orgNumber === hints.orgNumber) {
    score += 0.5;
    basis.push('org_number_exact');
  }
  if (hints.decisionNumber && candidate.decisionNumber === hints.decisionNumber) {
    score += 0.35;
    basis.push('decision_number_exact');
  }
  if (hints.paymentReference && candidate.paymentReference === hints.paymentReference) {
    score += 0.35;
    basis.push('payment_reference_exact');
  }
  if (
    hints.amountSek !== undefined &&
    candidate.amountSek !== undefined &&
    Math.abs(hints.amountSek - candidate.amountSek) < 0.005
  ) {
    score += 0.15;
    basis.push('amount_exact');
  }
  if (hints.paymentDate && candidate.paymentDate === hints.paymentDate) {
    score += 0.1;
    basis.push('payment_date_exact');
  }
  if (
    hints.nameFragment &&
    candidate.name &&
    candidate.name.toLowerCase().includes(hints.nameFragment.toLowerCase())
  ) {
    score += 0.1;
    basis.push('name_fragment');
  }

  return {
    candidateKind: candidate.candidateKind,
    candidateId: candidate.candidateId,
    score: Math.min(1, score),
    scoreBasis: basis,
  };
}

export function matchNotification(
  hints: NotificationSubjectHints,
  candidates: MatchCandidate[],
): NotificationMatchResult {
  const scored = candidates
    .map((c) => scoreCandidate(hints, c))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (!best || best.score < REVIEW_THRESHOLD) {
    return { candidates: scored, decision: 'no_match', ...(best ? { best } : {}) };
  }
  const runnerUp = scored[1];
  const ambiguous = runnerUp !== undefined && best.score - runnerUp.score < 0.1;
  if (best.score >= AUTO_MATCH_THRESHOLD && !ambiguous) {
    return { candidates: scored, best, decision: 'auto_matched' };
  }
  return { candidates: scored, best, decision: 'manual_review' };
}
