import { describe, expect, it } from 'vitest';
import {
  evaluateDisclosure,
  transitionPublicRecordRequest,
  type RequestItemState,
} from './public-records';

function item(overrides: Partial<RequestItemState> = {}): RequestItemState {
  return {
    requestItemId: 'item-1',
    documentId: 'doc-1',
    review: {
      requestItemId: 'item-1',
      reviewer: 'lawyer-1',
      legalBasis: 'OSL 26 kap. 1 §',
      decision: 'release',
      motivation: 'Inga sekretessbelagda uppgifter identifierade.',
    },
    ...overrides,
  };
}

describe('evaluateDisclosure', () => {
  it('blocks disclosure of unreviewed items', () => {
    const noReview = item();
    delete noReview.review;
    const result = evaluateDisclosure([noReview]);
    expect(result.allowed).toBe(false);
    expect(result.errors[0]).toContain('sekretessprövning');
  });

  it('allows full release after review', () => {
    const result = evaluateDisclosure([item()]);
    expect(result.allowed).toBe(true);
    expect(result.disclosableItems[0]!.mode).toBe('full');
  });

  it('requires completed redaction for release_redacted', () => {
    const pending = item({
      review: {
        requestItemId: 'item-1',
        reviewer: 'lawyer-1',
        legalBasis: 'OSL 26 kap. 1 §',
        decision: 'release_redacted',
        motivation: 'Personuppgifter om tredje man ska maskas.',
        redactionCompleted: false,
      },
    });
    expect(evaluateDisclosure([pending]).allowed).toBe(false);

    const done = item({
      review: { ...pending.review!, redactionCompleted: true },
    });
    const result = evaluateDisclosure([done]);
    expect(result.allowed).toBe(true);
    expect(result.disclosableItems[0]!.mode).toBe('redacted');
  });

  it('records withheld items separately', () => {
    const withheld = item({
      review: {
        requestItemId: 'item-1',
        reviewer: 'lawyer-1',
        legalBasis: 'OSL 26 kap. 1 §',
        decision: 'withhold',
        motivation: 'Uppgifterna omfattas av sekretess.',
      },
    });
    const result = evaluateDisclosure([withheld]);
    expect(result.allowed).toBe(true);
    expect(result.withheldItems).toEqual(['doc-1']);
    expect(result.disclosableItems).toHaveLength(0);
  });

  it('rejects reviews without motivation or legal basis', () => {
    const bad = item({
      review: {
        requestItemId: 'item-1',
        reviewer: 'lawyer-1',
        legalBasis: '',
        decision: 'release',
        motivation: '',
      },
    });
    expect(evaluateDisclosure([bad]).allowed).toBe(false);
  });
});

describe('request status machine', () => {
  it('walks the disclosure path', () => {
    let status = transitionPublicRecordRequest('received', 'identifying_records');
    status = transitionPublicRecordRequest(status, 'secrecy_review');
    status = transitionPublicRecordRequest(status, 'partially_approved');
    status = transitionPublicRecordRequest(status, 'disclosed');
    expect(transitionPublicRecordRequest(status, 'closed')).toBe('closed');
  });

  it('cannot disclose without secrecy review', () => {
    expect(() => transitionPublicRecordRequest('received', 'disclosed')).toThrow('Invalid');
  });
});
