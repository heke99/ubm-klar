/**
 * Public record request workflow (allmän handling) with mandatory secrecy
 * review before any disclosure. Redaction happens before release when the
 * review decides `release_redacted`.
 */
export type PublicRecordRequestStatus =
  | 'received'
  | 'identifying_records'
  | 'secrecy_review'
  | 'partially_approved'
  | 'approved'
  | 'denied'
  | 'disclosed'
  | 'appealed'
  | 'closed';

export interface SecrecyReviewDecision {
  requestItemId: string;
  reviewer: string;
  legalBasis: string;
  decision: 'release' | 'release_redacted' | 'withhold';
  motivation: string;
  redactionCompleted?: boolean;
}

export interface DisclosureItem {
  requestItemId: string;
  documentId: string;
  mode: 'full' | 'redacted';
}

export interface DisclosureGateResult {
  allowed: boolean;
  disclosableItems: DisclosureItem[];
  withheldItems: string[];
  errors: string[];
}

export interface RequestItemState {
  requestItemId: string;
  documentId: string;
  review?: SecrecyReviewDecision;
}

/**
 * Gate before building a disclosure package: every item must have a secrecy
 * review; redacted releases require completed redaction; withheld items are
 * excluded with a documented legal basis.
 */
export function evaluateDisclosure(items: RequestItemState[]): DisclosureGateResult {
  const errors: string[] = [];
  const disclosableItems: DisclosureItem[] = [];
  const withheldItems: string[] = [];

  for (const item of items) {
    if (!item.review) {
      errors.push(
        `Handling ${item.documentId} saknar sekretessprövning. Utlämnande är blockerat tills prövning är gjord.`,
      );
      continue;
    }
    if (!item.review.motivation.trim() || !item.review.legalBasis.trim()) {
      errors.push(`Sekretessprövningen för ${item.documentId} saknar motivering eller lagstöd.`);
      continue;
    }
    switch (item.review.decision) {
      case 'release':
        disclosableItems.push({ requestItemId: item.requestItemId, documentId: item.documentId, mode: 'full' });
        break;
      case 'release_redacted':
        if (!item.review.redactionCompleted) {
          errors.push(
            `Handling ${item.documentId} ska maskas före utlämnande men maskningen är inte slutförd.`,
          );
        } else {
          disclosableItems.push({
            requestItemId: item.requestItemId,
            documentId: item.documentId,
            mode: 'redacted',
          });
        }
        break;
      case 'withhold':
        withheldItems.push(item.documentId);
        break;
    }
  }

  return {
    allowed: errors.length === 0 && disclosableItems.length + withheldItems.length === items.length,
    disclosableItems,
    withheldItems,
    errors,
  };
}

const REQUEST_TRANSITIONS: Record<PublicRecordRequestStatus, PublicRecordRequestStatus[]> = {
  received: ['identifying_records', 'denied'],
  identifying_records: ['secrecy_review', 'denied'],
  secrecy_review: ['approved', 'partially_approved', 'denied'],
  partially_approved: ['disclosed', 'appealed'],
  approved: ['disclosed', 'appealed'],
  denied: ['appealed', 'closed'],
  disclosed: ['closed', 'appealed'],
  appealed: ['secrecy_review', 'closed'],
  closed: [],
};

export function transitionPublicRecordRequest(
  from: PublicRecordRequestStatus,
  to: PublicRecordRequestStatus,
): PublicRecordRequestStatus {
  if (!(REQUEST_TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error(`Invalid public record request transition: ${from} -> ${to}`);
  }
  return to;
}
