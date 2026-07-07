import { randomUUID } from 'node:crypto';
import type { ApprovalDecision } from '@ubm-klar/shared-types';

/**
 * Maker-checker approval workflows.
 *
 * Invariants:
 * - The creator (maker) can never be the sole approver (checker).
 * - Every step requires a distinct approver.
 * - Decisions are immutable once made.
 * - Rejection or return-for-changes terminates the workflow.
 *
 * Used for: UBM exports, payment recipient changes, document exports,
 * break-glass, exit exports, go-live approvals.
 */
export type WorkflowKind =
  | 'ubm_export'
  | 'document_export'
  | 'payment_recipient_change'
  | 'payment_stop'
  | 'break_glass'
  | 'exit_export'
  | 'e_archive_export'
  | 'disposal_decision'
  | 'go_live'
  | 'rule_configuration_change';

export interface ApprovalStep {
  id: string;
  stepOrder: number;
  requiredRole: string;
  decision?: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
}

export type WorkflowStatus = 'pending' | 'approved' | 'rejected' | 'returned_for_changes';

export interface ApprovalWorkflow {
  id: string;
  kind: WorkflowKind;
  subjectKind: string;
  subjectId: string;
  createdBy: string;
  createdAt: string;
  status: WorkflowStatus;
  steps: ApprovalStep[];
}

export class ApprovalError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'maker_cannot_approve'
      | 'duplicate_approver'
      | 'step_out_of_order'
      | 'workflow_closed'
      | 'step_already_decided'
      | 'wrong_role'
      | 'unknown_step',
  ) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export interface CreateWorkflowInput {
  kind: WorkflowKind;
  subjectKind: string;
  subjectId: string;
  createdBy: string;
  /** Ordered list of roles that must approve (at least one). */
  requiredRoles: string[];
}

export function createWorkflow(
  input: CreateWorkflowInput,
  clock: () => Date = () => new Date(),
): ApprovalWorkflow {
  if (input.requiredRoles.length === 0) {
    throw new Error('An approval workflow needs at least one approval step');
  }
  return {
    id: randomUUID(),
    kind: input.kind,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    createdBy: input.createdBy,
    createdAt: clock().toISOString(),
    status: 'pending',
    steps: input.requiredRoles.map((role, index) => ({
      id: randomUUID(),
      stepOrder: index + 1,
      requiredRole: role,
    })),
  };
}

export interface DecideStepInput {
  stepId: string;
  decision: ApprovalDecision;
  decidedBy: string;
  /** Role in which the approver acts; must match the step's required role. */
  actingRole: string;
  comment?: string;
}

export function decideStep(
  workflow: ApprovalWorkflow,
  input: DecideStepInput,
  clock: () => Date = () => new Date(),
): ApprovalWorkflow {
  if (workflow.status !== 'pending') {
    throw new ApprovalError(`Workflow is ${workflow.status}`, 'workflow_closed');
  }
  const step = workflow.steps.find((s) => s.id === input.stepId);
  if (!step) {
    throw new ApprovalError(`Unknown step: ${input.stepId}`, 'unknown_step');
  }
  if (step.decision) {
    throw new ApprovalError('Step already decided', 'step_already_decided');
  }
  const priorUndecided = workflow.steps.find(
    (s) => s.stepOrder < step.stepOrder && !s.decision,
  );
  if (priorUndecided) {
    throw new ApprovalError(
      `Step ${priorUndecided.stepOrder} must be decided first`,
      'step_out_of_order',
    );
  }
  if (input.actingRole !== step.requiredRole) {
    throw new ApprovalError(
      `Step requires role "${step.requiredRole}", got "${input.actingRole}"`,
      'wrong_role',
    );
  }
  // HARD RULE: maker can never approve own workflow
  if (input.decidedBy === workflow.createdBy && input.decision === 'approved') {
    throw new ApprovalError(
      'The creator of a workflow can never approve it (maker-checker)',
      'maker_cannot_approve',
    );
  }
  // Each step needs a distinct approver
  const alreadyApproved = workflow.steps.some(
    (s) => s.decision === 'approved' && s.decidedBy === input.decidedBy,
  );
  if (alreadyApproved && input.decision === 'approved') {
    throw new ApprovalError(
      'The same person cannot approve multiple steps in one workflow',
      'duplicate_approver',
    );
  }

  const decidedStep: ApprovalStep = {
    ...step,
    decision: input.decision,
    decidedBy: input.decidedBy,
    decidedAt: clock().toISOString(),
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
  };
  const steps = workflow.steps.map((s) => (s.id === step.id ? decidedStep : s));

  let status: WorkflowStatus = 'pending';
  if (input.decision === 'rejected') status = 'rejected';
  else if (input.decision === 'returned_for_changes') status = 'returned_for_changes';
  else if (steps.every((s) => s.decision === 'approved')) status = 'approved';

  return { ...workflow, steps, status };
}

/** True when the subject may proceed (all steps approved). */
export function isApproved(workflow: ApprovalWorkflow): boolean {
  return workflow.status === 'approved';
}
