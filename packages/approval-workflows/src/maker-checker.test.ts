import { describe, expect, it } from 'vitest';
import { ApprovalError, createWorkflow, decideStep, isApproved } from './maker-checker';

function workflow(requiredRoles = ['lawyer', 'ubm_export_manager']) {
  return createWorkflow({
    kind: 'ubm_export',
    subjectKind: 'ubm_submission',
    subjectId: 'sub-1',
    createdBy: 'maker-user',
    requiredRoles,
  });
}

describe('maker-checker workflows', () => {
  it('creates ordered pending steps', () => {
    const wf = workflow();
    expect(wf.status).toBe('pending');
    expect(wf.steps.map((s) => s.stepOrder)).toEqual([1, 2]);
  });

  it('never lets the maker approve', () => {
    const wf = workflow(['lawyer']);
    expect(() =>
      decideStep(wf, {
        stepId: wf.steps[0]!.id,
        decision: 'approved',
        decidedBy: 'maker-user',
        actingRole: 'lawyer',
      }),
    ).toThrowError(expect.objectContaining({ code: 'maker_cannot_approve' }) as unknown as Error);
  });

  it('lets the maker reject their own workflow (withdrawal)', () => {
    const wf = workflow(['lawyer']);
    const updated = decideStep(wf, {
      stepId: wf.steps[0]!.id,
      decision: 'rejected',
      decidedBy: 'maker-user',
      actingRole: 'lawyer',
    });
    expect(updated.status).toBe('rejected');
  });

  it('requires the correct role per step', () => {
    const wf = workflow();
    expect(() =>
      decideStep(wf, {
        stepId: wf.steps[0]!.id,
        decision: 'approved',
        decidedBy: 'someone',
        actingRole: 'dpo',
      }),
    ).toThrowError(expect.objectContaining({ code: 'wrong_role' }) as unknown as Error);
  });

  it('enforces step order', () => {
    const wf = workflow();
    expect(() =>
      decideStep(wf, {
        stepId: wf.steps[1]!.id,
        decision: 'approved',
        decidedBy: 'checker-2',
        actingRole: 'ubm_export_manager',
      }),
    ).toThrowError(expect.objectContaining({ code: 'step_out_of_order' }) as unknown as Error);
  });

  it('prevents the same person approving multiple steps', () => {
    let wf = workflow();
    wf = decideStep(wf, {
      stepId: wf.steps[0]!.id,
      decision: 'approved',
      decidedBy: 'checker-1',
      actingRole: 'lawyer',
    });
    expect(() =>
      decideStep(wf, {
        stepId: wf.steps[1]!.id,
        decision: 'approved',
        decidedBy: 'checker-1',
        actingRole: 'ubm_export_manager',
      }),
    ).toThrowError(expect.objectContaining({ code: 'duplicate_approver' }) as unknown as Error);
  });

  it('approves when all steps are approved by distinct checkers', () => {
    let wf = workflow();
    wf = decideStep(wf, {
      stepId: wf.steps[0]!.id,
      decision: 'approved',
      decidedBy: 'checker-1',
      actingRole: 'lawyer',
    });
    expect(isApproved(wf)).toBe(false);
    wf = decideStep(wf, {
      stepId: wf.steps[1]!.id,
      decision: 'approved',
      decidedBy: 'checker-2',
      actingRole: 'ubm_export_manager',
    });
    expect(isApproved(wf)).toBe(true);
  });

  it('terminates on rejection and blocks further decisions', () => {
    let wf = workflow();
    wf = decideStep(wf, {
      stepId: wf.steps[0]!.id,
      decision: 'rejected',
      decidedBy: 'checker-1',
      actingRole: 'lawyer',
      comment: 'Underlaget är ofullständigt',
    });
    expect(wf.status).toBe('rejected');
    expect(() =>
      decideStep(wf, {
        stepId: wf.steps[1]!.id,
        decision: 'approved',
        decidedBy: 'checker-2',
        actingRole: 'ubm_export_manager',
      }),
    ).toThrow(ApprovalError);
  });

  it('supports returned_for_changes', () => {
    let wf = workflow(['dpo']);
    wf = decideStep(wf, {
      stepId: wf.steps[0]!.id,
      decision: 'returned_for_changes',
      decidedBy: 'checker-1',
      actingRole: 'dpo',
    });
    expect(wf.status).toBe('returned_for_changes');
  });

  it('blocks double-deciding a step', () => {
    let wf = workflow(['lawyer']);
    wf = decideStep(wf, {
      stepId: wf.steps[0]!.id,
      decision: 'approved',
      decidedBy: 'checker-1',
      actingRole: 'lawyer',
    });
    expect(() =>
      decideStep(wf, {
        stepId: wf.steps[0]!.id,
        decision: 'approved',
        decidedBy: 'checker-2',
        actingRole: 'lawyer',
      }),
    ).toThrowError(expect.objectContaining({ code: 'workflow_closed' }) as unknown as Error);
  });
});
