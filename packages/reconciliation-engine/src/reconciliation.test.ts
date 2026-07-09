import { describe, expect, it } from 'vitest';
import {
  reconcilePaymentFile,
  summarizeReconciliation,
  type ExpectedPayment,
  type PaymentFileRow,
  type ReconciliationInput,
} from './reconciliation';

function row(overrides: Partial<PaymentFileRow> = {}): PaymentFileRow {
  return {
    id: 'row-1',
    personId: 'person-1',
    amountSek: 10_000,
    paymentDate: '2026-07-15',
    recipientAccountReference: 'BG-5050-1055',
    ...overrides,
  };
}

function expected(overrides: Partial<ExpectedPayment> = {}): ExpectedPayment {
  return {
    id: 'pay-1',
    kind: 'ea_payment',
    personId: 'person-1',
    decisionId: 'dec-1',
    decisionPeriodStart: '2026-07-01',
    decisionPeriodEnd: '2026-07-31',
    amountSek: 10_000,
    recipientAccountReference: 'BG-5050-1055',
    status: 'approved',
    ...overrides,
  };
}

function input(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    rows: [row()],
    expectedPayments: [expected()],
    recipientRegistry: [
      {
        recipientKind: 'person',
        personId: 'person-1',
        accountReference: 'BG-5050-1055',
        verified: true,
        validFrom: '2026-01-01',
      },
    ],
    blocklist: [],
    activeRecoveryClaims: [],
    ...overrides,
  };
}

describe('reconcilePaymentFile', () => {
  it('matches clean payments', () => {
    const results = reconcilePaymentFile(input());
    expect(results[0]!.resultKind).toBe('matched');
    expect(results[0]!.matchedPaymentId).toBe('pay-1');
  });

  it('flags payments to blocked recipients as critical', () => {
    const results = reconcilePaymentFile(
      input({
        blocklist: [{ blockedKind: 'person', personId: 'person-1', validFrom: '2026-01-01' }],
      }),
    );
    expect(results[0]!.resultKind).toBe('blocked_recipient');
    expect(results[0]!.severity).toBe('critical');
  });

  it('detects duplicate payments within a file', () => {
    const results = reconcilePaymentFile(
      input({
        rows: [row(), row({ id: 'row-2' })],
        expectedPayments: [expected()],
      }),
    );
    expect(results.map((r) => r.resultKind)).toEqual(['matched', 'duplicate_payment']);
  });

  it('flags rows without any decision', () => {
    const results = reconcilePaymentFile(input({ rows: [row({ personId: 'person-unknown' })] }));
    expect(results[0]!.resultKind).toBe('missing_decision');
  });

  it('flags amount mismatches separately from missing decisions', () => {
    const results = reconcilePaymentFile(input({ rows: [row({ amountSek: 999 })] }));
    expect(results[0]!.resultKind).toBe('amount_mismatch');
  });

  it('flags payments outside the decision period', () => {
    const results = reconcilePaymentFile(input({ rows: [row({ paymentDate: '2026-09-01' })] }));
    expect(results[0]!.resultKind).toBe('outside_decision_period');
  });

  it('flags new payments while a recovery claim is active', () => {
    const results = reconcilePaymentFile(
      input({ activeRecoveryClaims: [{ claimId: 'claim-1', personId: 'person-1' }] }),
    );
    expect(results[0]!.resultKind).toBe('recovery_claim_conflict');
    expect(results[0]!.evidenceReferences).toContain('recovery_claim:claim-1');
  });

  it('flags account mismatches against the recipient registry as critical', () => {
    const results = reconcilePaymentFile(
      input({ rows: [row({ recipientAccountReference: 'BG-9999-0000' })] }),
    );
    expect(results[0]!.resultKind).toBe('recipient_mismatch');
    expect(results[0]!.severity).toBe('critical');
  });

  it('flags account changes near the payment date', () => {
    const results = reconcilePaymentFile(
      input({
        recipientRegistry: [
          {
            recipientKind: 'person',
            personId: 'person-1',
            accountReference: 'BG-5050-1055',
            verified: true,
            validFrom: '2026-01-01',
            lastAccountChangeAt: '2026-07-10',
          },
        ],
      }),
    );
    expect(results[0]!.resultKind).toBe('account_changed_near_payment');
  });

  it('summarizes results', () => {
    const results = reconcilePaymentFile(
      input({
        rows: [row(), row({ id: 'row-2', personId: 'person-unknown' })],
      }),
    );
    const summary = summarizeReconciliation(results);
    expect(summary.total).toBe(2);
    expect(summary.matched).toBe(1);
    expect(summary.flagged).toBe(1);
  });
});
