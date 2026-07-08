import { createHash, randomUUID } from 'node:crypto';
import { isApproved, type ApprovalWorkflow } from '@ubm-klar/approval-workflows';
import type { EvidenceChain } from '@ubm-klar/evidence-chain';

/**
 * UBM export package generation: deterministic manifest + payload with sha256
 * hashes, signature abstraction, approval enforcement (maker-checker) and
 * receipt handling. Sending happens only via approved transport profiles.
 */
export interface UbmExportRow {
  entityKind: string;
  entityId: string;
  payload: Record<string, string>;
}

export interface UbmExportDocumentRef {
  documentId: string;
  fileHashSha256: string;
  exportMode: 'reference_only' | 'redacted_document' | 'full_document';
}

export interface UbmExportPackageInput {
  proposalId: string;
  requestNumber?: string;
  domain: 'lss' | 'economic_assistance';
  schemaKey: string;
  schemaVersion: string;
  legalSourceKey: string;
  legalSourceVersion: string;
  ruleSetVersion: string;
  rows: UbmExportRow[];
  documents: UbmExportDocumentRef[];
  createdBy: string;
}

export interface UbmExportPackage {
  submissionId: string;
  submissionNumber: string;
  manifest: {
    proposalId: string;
    requestNumber?: string;
    domain: string;
    schemaKey: string;
    schemaVersion: string;
    legalSourceKey: string;
    legalSourceVersion: string;
    ruleSetVersion: string;
    rowCount: number;
    documentCount: number;
    createdAt: string;
    generator: 'ubm-klar';
  };
  payload: string;
  manifestHashSha256: string;
  payloadHashSha256: string;
  signature?: string;
}

export interface PackageSigner {
  sign(hash: string): Promise<string>;
  verify(hash: string, signature: string): Promise<boolean>;
}

/** Placeholder signer used until a municipality-approved signing key is configured. */
export class UnsignedPackageSigner implements PackageSigner {
  async sign(): Promise<string> {
    return 'UNSIGNED:signature-configuration-pending';
  }
  async verify(_hash: string, signature: string): Promise<boolean> {
    return signature.startsWith('UNSIGNED:');
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function buildExportPackage(
  input: UbmExportPackageInput,
  signer: PackageSigner = new UnsignedPackageSigner(),
  clock: () => Date = () => new Date(),
): Promise<UbmExportPackage> {
  const payloadObject = {
    schema: { key: input.schemaKey, version: input.schemaVersion },
    rows: [...input.rows].sort((a, b) =>
      `${a.entityKind}:${a.entityId}`.localeCompare(`${b.entityKind}:${b.entityId}`),
    ),
    documents: [...input.documents].sort((a, b) => a.documentId.localeCompare(b.documentId)),
  };
  const payload = JSON.stringify(payloadObject);
  const payloadHash = sha256(payload);

  const manifest: UbmExportPackage['manifest'] = {
    proposalId: input.proposalId,
    ...(input.requestNumber !== undefined ? { requestNumber: input.requestNumber } : {}),
    domain: input.domain,
    schemaKey: input.schemaKey,
    schemaVersion: input.schemaVersion,
    legalSourceKey: input.legalSourceKey,
    legalSourceVersion: input.legalSourceVersion,
    ruleSetVersion: input.ruleSetVersion,
    rowCount: input.rows.length,
    documentCount: input.documents.length,
    createdAt: clock().toISOString(),
    generator: 'ubm-klar',
  };
  const manifestHash = sha256(JSON.stringify(manifest) + payloadHash);
  const signature = await signer.sign(manifestHash);

  return {
    submissionId: randomUUID(),
    submissionNumber: `UBM-${manifest.createdAt.slice(0, 10).replaceAll('-', '')}-${input.proposalId.slice(0, 8)}`,
    manifest,
    payload,
    manifestHashSha256: manifestHash,
    payloadHashSha256: payloadHash,
    signature,
  };
}

export type TransportProfile = 'manual_download' | 'sftp' | 'api' | 'ubm_official_transport_pending';

export interface SendContext {
  approvalWorkflow: ApprovalWorkflow;
  transportProfile: TransportProfile;
  transportApproved: boolean;
}

export class ExportNotApprovedError extends Error {
  constructor(reason: string) {
    super(`Export cannot be sent: ${reason}`);
    this.name = 'ExportNotApprovedError';
  }
}

/**
 * Gate before any package leaves the data plane: maker-checker workflow must be
 * approved and the transport profile must be explicitly approved. The official
 * UBM transport stays unusable until specifications/credentials exist.
 */
export function assertSendable(context: SendContext): void {
  if (!isApproved(context.approvalWorkflow)) {
    throw new ExportNotApprovedError(
      `approval workflow status is "${context.approvalWorkflow.status}" (maker-checker not completed)`,
    );
  }
  if (!context.transportApproved) {
    throw new ExportNotApprovedError('transport profile is not approved');
  }
  if (context.transportProfile === 'ubm_official_transport_pending') {
    throw new ExportNotApprovedError(
      'official UBM transport is not available until specifications and credentials are provided',
    );
  }
}

export interface UbmReceipt {
  receiptId: string;
  submissionId: string;
  receiptKind: 'transport_receipt' | 'processing_receipt' | 'error_receipt' | 'manual_confirmation';
  receiptReference?: string;
  receiptHashSha256?: string;
  receivedAt: string;
}

export function registerReceipt(
  submissionId: string,
  receiptKind: UbmReceipt['receiptKind'],
  receiptContent: string | undefined,
  chain: EvidenceChain,
  clock: () => Date = () => new Date(),
): UbmReceipt {
  const receipt: UbmReceipt = {
    receiptId: randomUUID(),
    submissionId,
    receiptKind,
    ...(receiptContent !== undefined ? { receiptHashSha256: sha256(receiptContent) } : {}),
    receivedAt: clock().toISOString(),
  };
  chain.append({
    subjectKind: chain.subjectKind,
    subjectId: chain.subjectId,
    entryKind: 'receipt',
    artifactReference: `ubm_receipt:${receipt.receiptId}`,
    ...(receipt.receiptHashSha256 !== undefined
      ? { artifactHashSha256: receipt.receiptHashSha256 }
      : {}),
    occurredAt: receipt.receivedAt,
  });
  return receipt;
}
