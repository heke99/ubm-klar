import { createHash } from 'node:crypto';
import { BUCKET_POLICIES, type BucketKey } from './buckets';

export type MalwareScanStatus = 'pending' | 'clean' | 'infected' | 'scan_failed' | 'skipped_policy';

/** Malware scanning abstraction: plug in ClamAV, a cloud scanner, or a stub locally. */
export interface MalwareScanner {
  scan(content: Uint8Array, fileName: string): Promise<MalwareScanStatus>;
}

export class DisabledMalwareScanner implements MalwareScanner {
  async scan(): Promise<MalwareScanStatus> {
    return 'skipped_policy';
  }
}

export interface DocumentUploadRequest {
  bucketKey: BucketKey;
  fileName: string;
  mimeType: string;
  content: Uint8Array;
  documentType: string;
  personId?: string;
  caseKind?: string;
  caseId?: string;
  uploadedBy: string;
}

export interface DocumentUploadValidation {
  ok: boolean;
  errors: string[];
  fileHashSha256: string;
}

export function sha256Hex(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Magic-byte checks for the formats the vault accepts. */
const MAGIC_BYTES: Record<string, (bytes: Uint8Array) => boolean> = {
  'application/pdf': (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'application/zip': (b) => b[0] === 0x50 && b[1] === 0x4b,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) =>
    b[0] === 0x50 && b[1] === 0x4b,
};

export function validateUpload(request: DocumentUploadRequest): DocumentUploadValidation {
  const errors: string[] = [];
  const policy = BUCKET_POLICIES[request.bucketKey];

  if (!policy.allowedMimeTypes.includes(request.mimeType)) {
    errors.push(`File type ${request.mimeType} is not allowed in bucket ${request.bucketKey}`);
  }
  if (request.content.byteLength === 0) {
    errors.push('Empty files are not allowed');
  }
  if (request.content.byteLength > policy.maxFileSizeBytes) {
    errors.push(`File exceeds maximum size of ${policy.maxFileSizeBytes} bytes`);
  }
  const magicCheck = MAGIC_BYTES[request.mimeType];
  if (magicCheck && request.content.byteLength >= 4 && !magicCheck(request.content)) {
    errors.push(`File content does not match declared type ${request.mimeType}`);
  }
  if (/[\\/]|\.\./.test(request.fileName)) {
    errors.push('File name must not contain path separators or traversal sequences');
  }

  return { ok: errors.length === 0, errors, fileHashSha256: sha256Hex(request.content) };
}

export type ExportMode = 'reference_only' | 'redacted_document' | 'full_document';

export interface DocumentExportRequest {
  bucketKey: BucketKey;
  documentClass:
    | 'standard'
    | 'sensitive'
    | 'medical'
    | 'protected_identity'
    | 'children'
    | 'disclosure'
    | 'archive';
  requestedMode: ExportMode;
  hasApprovedExportApproval: boolean;
  redactionCompleted: boolean;
}

export interface DocumentExportDecision {
  allowed: boolean;
  effectiveMode: ExportMode;
  reasons: string[];
}

/**
 * Export gate: document references first; full documents only after approval.
 * Sensitive classes additionally require completed redaction unless a full
 * document was explicitly approved.
 */
export function evaluateDocumentExport(request: DocumentExportRequest): DocumentExportDecision {
  const reasons: string[] = [];
  const policy = BUCKET_POLICIES[request.bucketKey];

  if (request.requestedMode === 'reference_only') {
    return {
      allowed: true,
      effectiveMode: 'reference_only',
      reasons: ['References are always allowed'],
    };
  }

  if (policy.exportRequiresApproval && !request.hasApprovedExportApproval) {
    reasons.push(
      'Exporten är blockerad: dokumentexport kräver godkännande. Skicka dokumentreferens i stället, eller begär exportgodkännande.',
    );
    return { allowed: false, effectiveMode: 'reference_only', reasons };
  }

  const sensitiveClasses = ['sensitive', 'medical', 'protected_identity', 'children'];
  if (sensitiveClasses.includes(request.documentClass)) {
    if (request.requestedMode === 'full_document') {
      if (!request.hasApprovedExportApproval) {
        reasons.push('Fullständigt dokument kräver uttryckligt godkännande.');
        return { allowed: false, effectiveMode: 'reference_only', reasons };
      }
      reasons.push('Fullständigt dokument godkänt för export.');
      return { allowed: true, effectiveMode: 'full_document', reasons };
    }
    if (!request.redactionCompleted) {
      reasons.push('Maskning måste vara slutförd innan maskerad version kan exporteras.');
      return { allowed: false, effectiveMode: 'reference_only', reasons };
    }
  }

  reasons.push('Export godkänd.');
  return { allowed: true, effectiveMode: request.requestedMode, reasons };
}
