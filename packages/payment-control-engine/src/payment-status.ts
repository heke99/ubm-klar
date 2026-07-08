import type { PaymentStatus } from '@ubm-klar/shared-types';

/** Allowed payment status transitions. Anything not listed is rejected. */
export const PAYMENT_STATUS_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  created: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['sent', 'paused', 'stopped', 'cancelled'],
  sent: ['paid', 'rejected', 'reversed', 'stopped'],
  paid: ['reversed', 'recovery_started'],
  rejected: ['created'],
  reversed: ['recovery_started'],
  paused: ['approved', 'stopped', 'cancelled'],
  cancelled: [],
  stopped: ['recovery_started', 'cancelled'],
  recovery_started: [],
};

export class InvalidPaymentTransitionError extends Error {
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`Invalid payment status transition: ${from} -> ${to}`);
    this.name = 'InvalidPaymentTransitionError';
  }
}

export interface PaymentTransition {
  from: PaymentStatus;
  to: PaymentStatus;
  changedBy: string;
  reason?: string;
  /** Pauses/stops of approved payments require an approval workflow reference. */
  approvalWorkflowId?: string;
}

const TRANSITIONS_REQUIRING_APPROVAL: Array<{ from: PaymentStatus; to: PaymentStatus }> = [
  { from: 'approved', to: 'stopped' },
  { from: 'sent', to: 'stopped' },
  { from: 'approved', to: 'paused' },
];

export function validatePaymentTransition(transition: PaymentTransition): void {
  const allowed = PAYMENT_STATUS_TRANSITIONS[transition.from] ?? [];
  if (!allowed.includes(transition.to)) {
    throw new InvalidPaymentTransitionError(transition.from, transition.to);
  }
  const needsApproval = TRANSITIONS_REQUIRING_APPROVAL.some(
    (t) => t.from === transition.from && t.to === transition.to,
  );
  if (needsApproval && !transition.approvalWorkflowId) {
    throw new Error(
      `Transition ${transition.from} -> ${transition.to} requires a maker-checker approval workflow`,
    );
  }
  if (
    ['stopped', 'paused', 'reversed', 'recovery_started'].includes(transition.to) &&
    !transition.reason?.trim()
  ) {
    throw new Error(`Transition to ${transition.to} requires a reason`);
  }
}
