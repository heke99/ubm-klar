import { describe, expect, it } from 'vitest';
import { DEFAULT_UBM_PHASES } from '@ubm-klar/legal-source-engine';
import {
  matchNotification,
  scoreCandidate,
  type MatchCandidate,
} from './notification-matching';
import {
  InvalidRequestTransitionError,
  transitionRequest,
  validateUbmRequest,
  type UbmRequestValidationInput,
} from './request-manager';

function validationInput(
  overrides: Partial<UbmRequestValidationInput> = {},
): UbmRequestValidationInput {
  return {
    requestNumber: 'UBM-2026-0001',
    intakeChannel: 'manual_registration',
    receivedAt: '2026-07-15T09:00:00Z',
    phases: DEFAULT_UBM_PHASES,
    featureFlags: {},
    hasSubject: true,
    hasRequestedItems: true,
    ...overrides,
  };
}

describe('validateUbmRequest', () => {
  it('accepts valid manual registrations after 2026-07-01', () => {
    expect(validateUbmRequest(validationInput()).valid).toBe(true);
  });

  it('rejects requests before phase 1 is effective', () => {
    const result = validateUbmRequest(validationInput({ receivedAt: '2026-05-01T09:00:00Z' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Fas 1');
  });

  it('rejects disabled intake channels including official transport', () => {
    const result = validateUbmRequest(validationInput({ intakeChannel: 'official_transport' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('UBM-transport');
  });

  it('requires subject and requested items', () => {
    const result = validateUbmRequest(validationInput({ hasSubject: false, hasRequestedItems: false }));
    expect(result.errors).toHaveLength(2);
  });
});

describe('request status machine', () => {
  it('walks the full happy path', () => {
    let status = transitionRequest('received', 'registered');
    status = transitionRequest(status, 'validated');
    status = transitionRequest(status, 'matching');
    status = transitionRequest(status, 'data_collection');
    status = transitionRequest(status, 'eligibility_review');
    status = transitionRequest(status, 'proposal_created');
    status = transitionRequest(status, 'in_review');
    status = transitionRequest(status, 'approved');
    status = transitionRequest(status, 'exported');
    status = transitionRequest(status, 'receipt_received');
    expect(transitionRequest(status, 'closed')).toBe('closed');
  });

  it('rejects skipping review', () => {
    expect(() => transitionRequest('proposal_created', 'approved')).toThrow(
      InvalidRequestTransitionError,
    );
  });

  it('cannot reopen closed requests', () => {
    expect(() => transitionRequest('closed', 'registered')).toThrow(
      InvalidRequestTransitionError,
    );
  });
});

const candidates: MatchCandidate[] = [
  {
    candidateKind: 'person',
    candidateId: 'p1',
    personalIdentityNumber: '19811218-9876',
    name: 'Testa Testsson',
  },
  {
    candidateKind: 'decision',
    candidateId: 'd1',
    decisionNumber: 'LSS-2026-001',
    personalIdentityNumber: '19811218-9876',
  },
  { candidateKind: 'payment', candidateId: 'pay1', amountSek: 12500, paymentDate: '2026-06-25' },
];

describe('notification matching', () => {
  it('auto-matches on exact personnummer + decision number', () => {
    const result = matchNotification(
      { personalIdentityNumber: '198112189876', decisionNumber: 'LSS-2026-001' },
      candidates,
    );
    expect(result.decision).toBe('auto_matched');
    expect(result.best?.candidateId).toBe('d1');
    expect(result.best?.scoreBasis).toContain('personnummer_exact');
  });

  it('sends weak matches to manual review', () => {
    const result = matchNotification(
      { amountSek: 12500, paymentDate: '2026-06-25' },
      candidates,
    );
    expect(result.decision).toBe('manual_review');
  });

  it('returns no_match when nothing scores', () => {
    const result = matchNotification({ nameFragment: 'okänd' }, candidates);
    expect(result.decision).toBe('no_match');
  });

  it('ambiguous top candidates require manual review even at high scores', () => {
    const twins: MatchCandidate[] = [
      { candidateKind: 'person', candidateId: 'a', personalIdentityNumber: '19811218-9876', decisionNumber: 'X-1' },
      { candidateKind: 'person', candidateId: 'b', personalIdentityNumber: '19811218-9876', decisionNumber: 'X-1' },
    ];
    const result = matchNotification(
      { personalIdentityNumber: '19811218-9876', decisionNumber: 'X-1' },
      twins,
    );
    expect(result.decision).toBe('manual_review');
  });

  it('caps scores at 1.0', () => {
    const scored = scoreCandidate(
      {
        personalIdentityNumber: '19811218-9876',
        decisionNumber: 'LSS-2026-001',
        amountSek: 100,
        paymentDate: '2026-01-01',
      },
      {
        candidateKind: 'decision',
        candidateId: 'x',
        personalIdentityNumber: '19811218-9876',
        decisionNumber: 'LSS-2026-001',
        amountSek: 100,
        paymentDate: '2026-01-01',
      },
    );
    expect(scored.score).toBe(1);
  });
});
