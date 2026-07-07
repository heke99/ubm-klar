import { describe, expect, it } from 'vitest';
import { createWorkflow, decideStep } from '@ubm-klar/approval-workflows';
import {
  buildExitExport,
  EXIT_EXPORT_SCOPE,
  ExitExportNotApprovedError,
  verifyExitExport,
  type ExitExportItemInput,
} from './exit-export';

function approvedWorkflow() {
  let wf = createWorkflow({
    kind: 'exit_export',
    subjectKind: 'exit_export',
    subjectId: 'exp-1',
    createdBy: 'system-owner-1',
    requiredRoles: ['municipality_admin'],
  });
  wf = decideStep(wf, {
    stepId: wf.steps[0]!.id,
    decision: 'approved',
    decidedBy: 'admin-2',
    actingRole: 'municipality_admin',
  });
  return wf;
}

function fullItems(): ExitExportItemInput[] {
  return EXIT_EXPORT_SCOPE.map((kind) => ({
    itemKind: kind,
    rowCount: 100,
    content: `innehåll för ${kind}`,
  }));
}

describe('exit export', () => {
  it('requires an approved exit_export maker-checker workflow', () => {
    const pending = createWorkflow({
      kind: 'exit_export',
      subjectKind: 'exit_export',
      subjectId: 'exp-1',
      createdBy: 'system-owner-1',
      requiredRoles: ['municipality_admin'],
    });
    expect(() => buildExitExport('EXIT-1', 'system-owner-1', pending, fullItems())).toThrow(
      ExitExportNotApprovedError,
    );
  });

  it('rejects workflows of the wrong kind', () => {
    let wf = createWorkflow({
      kind: 'ubm_export',
      subjectKind: 'x',
      subjectId: 'x',
      createdBy: 'u1',
      requiredRoles: ['municipality_admin'],
    });
    wf = decideStep(wf, {
      stepId: wf.steps[0]!.id,
      decision: 'approved',
      decidedBy: 'u2',
      actingRole: 'municipality_admin',
    });
    expect(() => buildExitExport('EXIT-1', 'u1', wf, fullItems())).toThrow('not an exit_export');
  });

  it('builds a complete manifest covering all 13 scopes', () => {
    const manifest = buildExitExport('EXIT-1', 'system-owner-1', approvedWorkflow(), fullItems());
    expect(manifest.items).toHaveLength(EXIT_EXPORT_SCOPE.length);
    expect(manifest.complete).toBe(true);
    expect(verifyExitExport(manifest, fullItems()).valid).toBe(true);
  });

  it('marks missing scopes as incomplete', () => {
    const partial = fullItems().slice(0, 5);
    const manifest = buildExitExport('EXIT-2', 'system-owner-1', approvedWorkflow(), partial);
    expect(manifest.complete).toBe(false);
    expect(manifest.missingItemKinds).toContain('evidence_chain');
    expect(verifyExitExport(manifest, partial).valid).toBe(false);
  });

  it('detects tampered content during verification', () => {
    const items = fullItems();
    const manifest = buildExitExport('EXIT-3', 'system-owner-1', approvedWorkflow(), items);
    const tampered = items.map((item) =>
      item.itemKind === 'audit_logs' ? { ...item, content: 'manipulerad' } : item,
    );
    const result = verifyExitExport(manifest, tampered);
    expect(result.valid).toBe(false);
    expect(result.problems[0]).toContain('audit_logs');
  });
});
