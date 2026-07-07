import { createHash } from 'node:crypto';
import { isApproved, type ApprovalWorkflow } from '@ubm-klar/approval-workflows';

/**
 * Exit export: the municipality's complete data takeout when leaving the
 * platform. Requires maker-checker approval; produces a manifest with per-item
 * checksums so the receiving party can verify completeness.
 */
export const EXIT_EXPORT_SCOPE = [
  'structured_data',
  'documents',
  'document_metadata',
  'audit_logs',
  'data_access_logs',
  'ubm_exports_receipts',
  'control_cases',
  'rule_configs',
  'import_history',
  'mappings',
  'source_record_links',
  'data_lineage',
  'evidence_chain',
] as const;

export type ExitExportItemKind = (typeof EXIT_EXPORT_SCOPE)[number];

export interface ExitExportItemInput {
  itemKind: ExitExportItemKind;
  rowCount: number;
  content: string;
}

export interface ExitExportManifest {
  exportNumber: string;
  requestedBy: string;
  approvedWorkflowId: string;
  createdAt: string;
  items: Array<{
    itemKind: ExitExportItemKind;
    rowCount: number;
    fileReference: string;
    fileHashSha256: string;
  }>;
  manifestHashSha256: string;
  complete: boolean;
  missingItemKinds: ExitExportItemKind[];
}

export class ExitExportNotApprovedError extends Error {
  constructor(reason: string) {
    super(`Exit export blocked: ${reason}`);
    this.name = 'ExitExportNotApprovedError';
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function buildExitExport(
  exportNumber: string,
  requestedBy: string,
  approvalWorkflow: ApprovalWorkflow,
  items: ExitExportItemInput[],
  clock: () => Date = () => new Date(),
): ExitExportManifest {
  if (approvalWorkflow.kind !== 'exit_export') {
    throw new ExitExportNotApprovedError('approval workflow is not an exit_export workflow');
  }
  if (!isApproved(approvalWorkflow)) {
    throw new ExitExportNotApprovedError(
      `approval workflow status is "${approvalWorkflow.status}" (maker-checker required)`,
    );
  }

  const manifestItems = [...items]
    .sort((a, b) => a.itemKind.localeCompare(b.itemKind))
    .map((item) => ({
      itemKind: item.itemKind,
      rowCount: item.rowCount,
      fileReference: `${exportNumber}/${item.itemKind}.jsonl`,
      fileHashSha256: sha256(item.content),
    }));

  const providedKinds = new Set(items.map((i) => i.itemKind));
  const missingItemKinds = EXIT_EXPORT_SCOPE.filter((kind) => !providedKinds.has(kind));

  const base = {
    exportNumber,
    requestedBy,
    approvedWorkflowId: approvalWorkflow.id,
    createdAt: clock().toISOString(),
    items: manifestItems,
    complete: missingItemKinds.length === 0,
    missingItemKinds,
  };
  return { ...base, manifestHashSha256: sha256(JSON.stringify(base)) };
}

export function verifyExitExport(
  manifest: ExitExportManifest,
  items: ExitExportItemInput[],
): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  const byKind = new Map(items.map((i) => [i.itemKind, i]));
  for (const manifestItem of manifest.items) {
    const item = byKind.get(manifestItem.itemKind);
    if (!item) {
      problems.push(`${manifestItem.itemKind}: saknas i leveransen`);
      continue;
    }
    if (sha256(item.content) !== manifestItem.fileHashSha256) {
      problems.push(`${manifestItem.itemKind}: kontrollsumman avviker från manifestet`);
    }
  }
  if (!manifest.complete) {
    problems.push(`Exporten är ofullständig: ${manifest.missingItemKinds.join(', ')}`);
  }
  return { valid: problems.length === 0, problems };
}
