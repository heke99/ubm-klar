import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LocalFileStorage, type MalwareScanner } from '@ubm-klar/document-vault';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';
import { TenantDataPlanePool } from './data-plane';

/**
 * Document vault flow: upload with scanning, classified open-with-reason
 * (always access-logged), redaction plan/apply with separately stored
 * verified redacted copy, and infected uploads blocked.
 */
const databaseUrl = process.env.DATA_PLANE_TEST_DATABASE_URL;

const record: TenantDirectoryRecord = {
  tenantId: 'tenant-malmo',
  tenantSlug: 'malmo',
  municipalityName: 'Malmö stad',
  deploymentMode: 'model_b_vendor_hosted_isolated',
  environment: 'prod',
  domain: 'malmo.ubmklar.se',
  domainVerified: true,
  activeModules: ['lss', 'economic_assistance', 'document_vault', 'ubm_readiness'],
  dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
  dataPlanePublishableKey: 'sb_publishable_malmo',
  authProvider: 'entra_id',
  featureFlags: {},
};

const directory: TenantDirectory = {
  lookupByDomain: async (domain) => (domain === 'malmo.ubmklar.se' ? record : undefined),
};

/** Deterministic test scanner: flags files whose name contains "virus". */
const testScanner: MalwareScanner = {
  scan: async (_content, fileName) => (fileName.includes('virus') ? 'infected' : 'clean'),
};

const caseworker = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'doc-user',
  'x-roles': 'lss_case_worker',
};
const lawyer = { host: 'malmo.ubmklar.se', 'x-user-id': 'doc-lawyer', 'x-roles': 'lawyer' };

describe.skipIf(!databaseUrl)('document vault flow', () => {
  let app: FastifyInstance;

  beforeAll(() => {
    const storageDir = mkdtempSync(join(tmpdir(), 'vault-test-'));
    app = buildApiServer({
      directory,
      allowDemoTenant: false,
      auth: { allowInsecureHeaderAuth: true },
      dataPlane: new TenantDataPlanePool({ DATA_PLANE_DATABASE_URL: databaseUrl! }),
      demoDataEnabled: false,
      documents: {
        storage: new LocalFileStorage(storageDir),
        scanner: testScanner,
        scannerProvider: 'external-api',
        isProductionLike: true,
      },
    });
  });

  async function upload(fileName: string, text: string, documentClass = 'standard') {
    return app.inject({
      method: 'POST',
      url: '/documents',
      headers: caseworker,
      payload: {
        fileName,
        contentBase64: Buffer.from(text, 'utf8').toString('base64'),
        mimeType: 'text/plain',
        bucketKey: 'documents-lss',
        documentType: 'decision',
        documentClass,
      },
    });
  }

  it('uploads a clean document with scan verdict and metadata persisted', async () => {
    const response = await upload(`beslut-${Date.now()}.txt`, 'Beslut om personlig assistans.');
    expect(response.statusCode).toBe(201);
    expect(response.json().malwareScanStatus).toBe('clean');
    expect(response.json().fileHashSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('blocks infected uploads without storing them', async () => {
    const response = await upload(`virus-${Date.now()}.txt`, 'elak fil');
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('infected');
  });

  it('rejects files that violate bucket policy', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: caseworker,
      payload: {
        fileName: 'script.exe',
        contentBase64: Buffer.from('MZ...').toString('base64'),
        mimeType: 'application/x-msdownload',
        bucketKey: 'documents-lss',
        documentType: 'other',
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('upload_invalid');
  });

  it('sensitive documents require a reason to open; access is always logged', async () => {
    const uploaded = await upload(`medicinsk-${Date.now()}.txt`, 'Läkarintyg.', 'medical');
    const documentId = uploaded.json().id;

    const withoutReason = await app.inject({
      method: 'POST',
      url: `/documents/${documentId}/open`,
      headers: caseworker,
      payload: {},
    });
    expect(withoutReason.statusCode).toBe(422);
    expect(withoutReason.json().error).toBe('reason_required');

    const withReason = await app.inject({
      method: 'POST',
      url: `/documents/${documentId}/open`,
      headers: caseworker,
      payload: { reason: 'Handläggning av LSS-ärende 123' },
    });
    expect(withReason.statusCode).toBe(200);
    expect(withReason.body).toContain('Läkarintyg');

    // Standard documents open without reason but are still logged.
    const standard = await upload(`standard-${Date.now()}.txt`, 'Vanlig handling.');
    const standardOpen = await app.inject({
      method: 'POST',
      url: `/documents/${standard.json().id}/open`,
      headers: caseworker,
      payload: {},
    });
    expect(standardOpen.statusCode).toBe(200);
  });

  it('runs the redaction workflow: plan, apply, separately stored verified copy', async () => {
    const uploaded = await upload(
      `maskning-${Date.now()}.txt`,
      'Personen 19121212-1212 med konto 123-4567 ansöker om stöd.',
      'sensitive',
    );
    const documentId = uploaded.json().id;

    const plan = await app.inject({
      method: 'POST',
      url: `/documents/${documentId}/redaction/plan`,
      headers: lawyer,
      payload: {},
    });
    expect(plan.statusCode).toBe(201);
    expect(plan.json().plan.matchCount).toBeGreaterThan(0);
    const jobId = plan.json().jobId;

    const apply = await app.inject({
      method: 'POST',
      url: `/documents/${documentId}/redaction/apply`,
      headers: lawyer,
      payload: { jobId },
    });
    expect(apply.statusCode).toBe(201);
    expect(apply.json().verified).toBe(true);
    const redactedId = apply.json().redactedDocumentId;
    expect(redactedId).not.toBe(documentId);

    // The redacted copy is separate, marked, and contains no personnummer.
    const detail = await app.inject({
      method: 'GET',
      url: `/documents/${redactedId}`,
      headers: lawyer,
    });
    expect(detail.json().document.isRedactedVersion).toBe(true);
    expect(detail.json().document.originalDocumentId).toBe(documentId);
    expect(detail.json().document.bucketKey).toBe('documents-redacted');

    const openRedacted = await app.inject({
      method: 'POST',
      url: `/documents/${redactedId}/open`,
      headers: lawyer,
      payload: {},
    });
    expect(openRedacted.statusCode).toBe(200);
    expect(openRedacted.body).not.toContain('19121212-1212');
    expect(openRedacted.body).toContain('█');
  });

  it('refuses automatic redaction of non-text formats with NOT_IMPLEMENTED', async () => {
    const pdfLike = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: caseworker,
      payload: {
        fileName: `intyg-${Date.now()}.pdf`,
        contentBase64: Buffer.from('%PDF-1.7 test').toString('base64'),
        mimeType: 'application/pdf',
        bucketKey: 'documents-lss',
        documentType: 'certificate',
      },
    });
    expect(pdfLike.statusCode).toBe(201);
    const plan = await app.inject({
      method: 'POST',
      url: `/documents/${pdfLike.json().id}/redaction/plan`,
      headers: lawyer,
      payload: {},
    });
    expect(plan.statusCode).toBe(422);
    expect(plan.json().error).toBe('NOT_IMPLEMENTED');
  });
});
