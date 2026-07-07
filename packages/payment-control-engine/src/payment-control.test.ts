import { describe, expect, it } from 'vitest';
import type { RiskFlag } from '@ubm-klar/rule-engine';
import {
  assignCase,
  controlCaseFromRiskFlag,
  createControlCase,
  InvalidCaseTransitionError,
  registerOutcome,
  transitionCase,
} from './control-cases';
import {
  InvalidPaymentTransitionError,
  validatePaymentTransition,
} from './payment-status';

describe('payment status transitions', () => {
  it('allows the happy path created -> paid', () => {
    validatePaymentTransition({ from: 'created', to: 'pending_approval', changedBy: 'u1' });
    validatePaymentTransition({ from: 'pending_approval', to: 'approved', changedBy: 'u2' });
    validatePaymentTransition({ from: 'approved', to: 'sent', changedBy: 'u2' });
    validatePaymentTransition({ from: 'sent', to: 'paid', changedBy: 'system' });
  });

  it('rejects invalid transitions', () => {
    expect(() =>
      validatePaymentTransition({ from: 'created', to: 'paid', changedBy: 'u1' }),
    ).toThrow(InvalidPaymentTransitionError);
    expect(() =>
      validatePaymentTransition({ from: 'cancelled', to: 'approved', changedBy: 'u1' }),
    ).toThrow(InvalidPaymentTransitionError);
  });

  it('requires approval workflow for stopping approved payments', () => {
    expect(() =>
      validatePaymentTransition({
        from: 'approved',
        to: 'stopped',
        changedBy: 'u1',
        reason: 'Misstänkt felaktig utbetalning',
      }),
    ).toThrow('approval workflow');
    validatePaymentTransition({
      from: 'approved',
      to: 'stopped',
      changedBy: 'u1',
      reason: 'Misstänkt felaktig utbetalning',
      approvalWorkflowId: 'wf-1',
    });
  });

  it('requires a reason for stop/pause/reversal/recovery', () => {
    expect(() =>
      validatePaymentTransition({
        from: 'paid',
        to: 'recovery_started',
        changedBy: 'u1',
      }),
    ).toThrow('requires a reason');
  });
});

function flag(overrides: Partial<RiskFlag> = {}): RiskFlag {
  return {
    ruleKey: 'duplicate_payment',
    ruleVersion: '1.0.0',
    severity: 'high',
    domain: 'payment_control',
    title: 'Dubblettutbetalning',
    recommendedAction: 'Utred och stoppa vid behov.',
    subjectKind: 'payment',
    subjectId: 'pay-1',
    explanation: 'Samma mottagare, belopp och period.',
    evidenceReferences: ['payment:pay-1'],
    amountAtRiskSek: 10_000,
    dryRun: false,
    flaggedAt: '2026-07-07T10:00:00Z',
    ...overrides,
  };
}

describe('control cases', () => {
  it('creates cases from high/critical flags with evidence reference', () => {
    const controlCase = controlCaseFromRiskFlag(flag());
    expect(controlCase).toBeDefined();
    expect(controlCase!.sourceReference).toContain('duplicate_payment@1.0.0');
    expect(controlCase!.severity).toBe('high');
  });

  it('does not create cases from low severity or dry-run flags', () => {
    expect(controlCaseFromRiskFlag(flag({ severity: 'low' }))).toBeUndefined();
    expect(controlCaseFromRiskFlag(flag({ dryRun: true }))).toBeUndefined();
  });

  it('walks the case lifecycle with status history', () => {
    let controlCase = createControlCase({
      sourceKind: 'manual',
      sourceReference: 'manual:tips',
      domain: 'payment_control',
      title: 'Manuellt kontrollärende',
      severity: 'medium',
    });
    controlCase = assignCase(controlCase, 'investigator-1', 'manager-1');
    controlCase = transitionCase(controlCase, 'investigating', 'investigator-1');
    controlCase = transitionCase(controlCase, 'awaiting_decision', 'investigator-1');
    controlCase = registerOutcome(
      controlCase,
      'recovery_claim',
      'Felaktig utbetalning konstaterad, återkrav initieras.',
      'manager-1',
    );
    controlCase = transitionCase(controlCase, 'closed', 'manager-1');
    expect(controlCase.status).toBe('closed');
    expect(controlCase.outcome).toBe('recovery_claim');
    expect(controlCase.statusHistory.map((h) => h.to)).toEqual([
      'open',
      'assigned',
      'investigating',
      'awaiting_decision',
      'decided',
      'closed',
    ]);
  });

  it('rejects invalid case transitions', () => {
    const controlCase = createControlCase({
      sourceKind: 'manual',
      sourceReference: 'x',
      domain: 'common',
      title: 't',
      severity: 'low',
    });
    expect(() => transitionCase(controlCase, 'decided', 'u1')).toThrow(
      InvalidCaseTransitionError,
    );
  });

  it('requires an outcome before closing a decided case', () => {
    let controlCase = createControlCase({
      sourceKind: 'manual',
      sourceReference: 'x',
      domain: 'common',
      title: 't',
      severity: 'low',
    });
    controlCase = assignCase(controlCase, 'i1', 'm1');
    controlCase = transitionCase(controlCase, 'investigating', 'i1');
    controlCase = transitionCase(controlCase, 'awaiting_decision', 'i1');
    controlCase = transitionCase(controlCase, 'decided', 'm1');
    expect(() => transitionCase(controlCase, 'closed', 'm1')).toThrow('without a registered outcome');
  });
});
