import { randomUUID } from 'node:crypto';
import type { ControlCaseStatus, RiskSeverity } from '@ubm-klar/shared-types';
import type { RiskFlag } from '@ubm-klar/rule-engine';

export type ControlCaseSourceKind =
  | 'risk_flag'
  | 'ubm_notification'
  | 'manual'
  | 'import_error'
  | 'payment_anomaly'
  | 'access_anomaly';

export type ControlCaseOutcome =
  | 'recovery_claim'
  | 'payment_stopped'
  | 'no_action'
  | 'police_report'
  | 'corrected_source_data'
  | 'other_action';

export interface ControlCase {
  id: string;
  caseNumber: string;
  sourceKind: ControlCaseSourceKind;
  sourceReference: string;
  domain: 'lss' | 'economic_assistance' | 'payment_control' | 'security' | 'common';
  title: string;
  severity: RiskSeverity;
  status: ControlCaseStatus;
  personId?: string;
  amountAtRiskSek?: number;
  assignedTo?: string;
  outcome?: ControlCaseOutcome;
  outcomeNote?: string;
  createdAt: string;
  statusHistory: Array<{
    from?: ControlCaseStatus;
    to: ControlCaseStatus;
    changedBy: string;
    reason?: string;
    occurredAt: string;
  }>;
}

const STATUS_TRANSITIONS: Record<ControlCaseStatus, ControlCaseStatus[]> = {
  open: ['assigned', 'closed'],
  assigned: ['investigating', 'open', 'closed'],
  investigating: ['awaiting_decision', 'assigned'],
  awaiting_decision: ['decided', 'investigating'],
  decided: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['assigned', 'investigating'],
};

export class InvalidCaseTransitionError extends Error {
  constructor(from: ControlCaseStatus, to: ControlCaseStatus) {
    super(`Invalid control case transition: ${from} -> ${to}`);
    this.name = 'InvalidCaseTransitionError';
  }
}

let caseCounter = 0;

export function createControlCase(
  input: Omit<ControlCase, 'id' | 'caseNumber' | 'status' | 'createdAt' | 'statusHistory'>,
  clock: () => Date = () => new Date(),
): ControlCase {
  caseCounter += 1;
  const now = clock().toISOString();
  return {
    ...input,
    id: randomUUID(),
    caseNumber: `KA-${now.slice(0, 4)}-${String(caseCounter).padStart(5, '0')}`,
    status: 'open',
    createdAt: now,
    statusHistory: [{ to: 'open', changedBy: 'system', occurredAt: now }],
  };
}

/** Severities that automatically open a control case when flagged. */
export const AUTO_CASE_SEVERITIES: readonly RiskSeverity[] = ['high', 'critical'] as const;

export function controlCaseFromRiskFlag(
  flag: RiskFlag,
  clock: () => Date = () => new Date(),
): ControlCase | undefined {
  if (flag.dryRun) return undefined;
  if (!AUTO_CASE_SEVERITIES.includes(flag.severity)) return undefined;
  return createControlCase(
    {
      sourceKind: 'risk_flag',
      sourceReference: `${flag.ruleKey}@${flag.ruleVersion}:${flag.subjectId}`,
      domain: flag.domain as ControlCase['domain'],
      title: flag.title,
      severity: flag.severity,
      ...(flag.personId !== undefined ? { personId: flag.personId } : {}),
      ...(flag.amountAtRiskSek !== undefined ? { amountAtRiskSek: flag.amountAtRiskSek } : {}),
    },
    clock,
  );
}

export function transitionCase(
  controlCase: ControlCase,
  to: ControlCaseStatus,
  changedBy: string,
  reason?: string,
  clock: () => Date = () => new Date(),
): ControlCase {
  const allowed = STATUS_TRANSITIONS[controlCase.status] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidCaseTransitionError(controlCase.status, to);
  }
  if (to === 'closed' && controlCase.status === 'decided' && !controlCase.outcome) {
    throw new Error('A decided case cannot be closed without a registered outcome');
  }
  return {
    ...controlCase,
    status: to,
    statusHistory: [
      ...controlCase.statusHistory,
      {
        from: controlCase.status,
        to,
        changedBy,
        ...(reason !== undefined ? { reason } : {}),
        occurredAt: clock().toISOString(),
      },
    ],
  };
}

export function assignCase(
  controlCase: ControlCase,
  assignee: string,
  changedBy: string,
): ControlCase {
  const transitioned =
    controlCase.status === 'open' ? transitionCase(controlCase, 'assigned', changedBy) : controlCase;
  return { ...transitioned, assignedTo: assignee };
}

export function registerOutcome(
  controlCase: ControlCase,
  outcome: ControlCaseOutcome,
  note: string,
  changedBy: string,
): ControlCase {
  if (controlCase.status !== 'awaiting_decision') {
    throw new Error('Outcome can only be registered while the case awaits decision');
  }
  const decided = transitionCase(controlCase, 'decided', changedBy, note);
  return { ...decided, outcome, outcomeNote: note };
}
