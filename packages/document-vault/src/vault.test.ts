import { describe, expect, it } from 'vitest';
import { BUCKET_POLICIES } from './buckets';
import { evaluateDocumentExport, validateUpload } from './vault';

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

describe('bucket policies', () => {
  it('defines all nine required buckets', () => {
    expect(Object.keys(BUCKET_POLICIES)).toHaveLength(9);
  });

  it('marks support bundles as no-PII', () => {
    expect(BUCKET_POLICIES['support-bundles-no-pii'].containsPii).toBe(false);
  });

  it('requires export approval for every PII bucket', () => {
    for (const policy of Object.values(BUCKET_POLICIES)) {
      if (policy.containsPii) {
        expect(policy.exportRequiresApproval, policy.bucketKey).toBe(true);
      }
    }
  });
});

describe('validateUpload', () => {
  it('accepts a valid PDF', () => {
    const result = validateUpload({
      bucketKey: 'documents-lss',
      fileName: 'beslut.pdf',
      mimeType: 'application/pdf',
      content: PDF_BYTES,
      documentType: 'lss_decision',
      uploadedBy: 'u1',
    });
    expect(result.ok).toBe(true);
    expect(result.fileHashSha256).toHaveLength(64);
  });

  it('rejects disallowed mime types', () => {
    const result = validateUpload({
      bucketKey: 'documents-lss',
      fileName: 'macro.xlsm',
      mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      content: PDF_BYTES,
      documentType: 'other',
      uploadedBy: 'u1',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects content not matching declared type', () => {
    const result = validateUpload({
      bucketKey: 'documents-lss',
      fileName: 'fake.pdf',
      mimeType: 'application/pdf',
      content: new Uint8Array([0x4d, 0x5a, 0x00, 0x00]),
      documentType: 'other',
      uploadedBy: 'u1',
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('does not match');
  });

  it('rejects path traversal in file names', () => {
    const result = validateUpload({
      bucketKey: 'documents-lss',
      fileName: '../../etc/passwd.pdf',
      mimeType: 'application/pdf',
      content: PDF_BYTES,
      documentType: 'other',
      uploadedBy: 'u1',
    });
    expect(result.ok).toBe(false);
  });
});

describe('evaluateDocumentExport', () => {
  it('always allows reference-only export', () => {
    const decision = evaluateDocumentExport({
      bucketKey: 'documents-lss',
      documentClass: 'medical',
      requestedMode: 'reference_only',
      hasApprovedExportApproval: false,
      redactionCompleted: false,
    });
    expect(decision.allowed).toBe(true);
  });

  it('blocks full document export without approval and explains why', () => {
    const decision = evaluateDocumentExport({
      bucketKey: 'documents-ubm',
      documentClass: 'sensitive',
      requestedMode: 'full_document',
      hasApprovedExportApproval: false,
      redactionCompleted: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.effectiveMode).toBe('reference_only');
    expect(decision.reasons[0]).toContain('blockerad');
  });

  it('blocks redacted export when redaction is not completed', () => {
    const decision = evaluateDocumentExport({
      bucketKey: 'documents-ubm',
      documentClass: 'medical',
      requestedMode: 'redacted_document',
      hasApprovedExportApproval: true,
      redactionCompleted: false,
    });
    expect(decision.allowed).toBe(false);
  });

  it('allows approved full document export', () => {
    const decision = evaluateDocumentExport({
      bucketKey: 'documents-ubm',
      documentClass: 'medical',
      requestedMode: 'full_document',
      hasApprovedExportApproval: true,
      redactionCompleted: false,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.effectiveMode).toBe('full_document');
  });
});
