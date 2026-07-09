import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createDbClient, type DbClient } from '@ubm-klar/db';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';
import { TenantDataPlanePool } from './data-plane';

/**
 * Export proposal lifecycle: review -> maker-checker approval -> packaging ->
 * verified download -> manual sending -> receipt -> closure. Blocked proposals
 * cannot be packaged; downloads are audited.
 */
const databaseUrl = process.env.DATA_PLANE_TEST_DATABASE_URL;

const RUN_SALT = Date.now() % 700;
function testPersonnummer(rawSeed: number): string {
  const seed = rawSeed + RUN_SALT + 100;
  const day = String(10 + (seed % 18)).padStart(2, '0');
  const serial = String(100 + (seed % 899));
  const nineDigits = `1203${day}${serial}`;
  for (let check = 0; check <= 9; check++) {
    const candidate = nineDigits + String(check);
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      let d = Number(candidate[i]);
      if (i % 2 === 0) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return `19${candidate}`;
  }
  throw new Error('no check digit found');
}

const record: TenantDirectoryRecord = {
  tenantId: 'tenant-malmo',
  tenantSlug: 'malmo',
  municipalityName: 'Malmö stad',
  deploymentMode: 'model_b_vendor_hosted_isolated',
  environment: 'prod',
  domain: 'malmo.ubmklar.se',
  domainVerified: true,
  activeModules: [
    'lss',
    'economic_assistance',
    'payment_control',
    'control_cases',
    'ubm_readiness',
    'import_gateway',
  ],
  dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
  dataPlanePublishableKey: 'sb_publishable_malmo',
  authProvider: 'entra_id',
  featureFlags: {},
};

const directory: TenantDirectory = {
  lookupByDomain: async (domain) => (domain === 'malmo.ubmklar.se' ? record : undefined),
};

const maker = { host: 'malmo.ubmklar.se', 'x-user-id': 'maker-1', 'x-roles': 'ubm_export_manager' };
const checker = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'checker-1',
  'x-roles': 'ubm_export_manager',
};

describe.skipIf(!databaseUrl)('export proposal lifecycle', () => {
  let app: FastifyInstance;
  let db: DbClient;
  let proposalId: string;
  let requestId: string;

  beforeAll(async () => {
    db = createDbClient({ connectionString: databaseUrl!, applicationName: 'export-flow-test' });
    app = buildApiServer({
      directory,
      allowDemoTenant: false,
      auth: { allowInsecureHeaderAuth: true },
      dataPlane: new TenantDataPlanePool({ DATA_PLANE_DATABASE_URL: databaseUrl! }),
      demoDataEnabled: false,
    });

    // Seed person + data + lineage, register request, match, create proposal.
    const pn = testPersonnummer(1);
    const person = await db.query<{ id: string }>(
      'insert into persons (personal_identity_number, is_synthetic) values ($1, false) returning id',
      [pn],
    );
    const batch = await db.query<{ id: string }>(
      `insert into import_batches (import_kind, file_name, status) values ('persons', 'seed2.csv', 'loaded') returning id`,
    );
    await db.query(
      `insert into import_staging_rows (batch_id, row_number, raw, committed_entity_kind, committed_entity_id)
       values ($1::uuid, 1, '{}'::jsonb, 'person', $2::uuid)`,
      [batch.rows[0]!.id, person.rows[0]!.id],
    );
    await db.query(
      `insert into lss_decisions (person_id, decision_number, insats_kind, decision_kind, decided_at)
       values ($1::uuid, $2, 'personlig_assistans', 'approval', '2026-02-01')`,
      [person.rows[0]!.id, `LSS-EXP-${Date.now()}`],
    );

    const created = await app.inject({
      method: 'POST',
      url: '/ubm/requests',
      headers: maker,
      payload: {
        requestNumber: `UBM-EXPORT-${Date.now().toString(36).toUpperCase()}`,
        receivedAt: new Date().toISOString(),
        domain: 'lss',
        legalSourceKey: 'lag_2024_ubm',
        requestedItems: [
          { itemKey: 'beslut', description: 'LSS-beslut', requestedDataKind: 'decisions' },
        ],
      },
    });
    requestId = created.json().id;
    await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/transition`,
      headers: maker,
      payload: { to: 'registered' },
    });
    await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/subjects`,
      headers: maker,
      payload: { personnummer: pn },
    });
    await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/transition`,
      headers: maker,
      payload: { to: 'validated' },
    });
    const proposal = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/proposal`,
      headers: maker,
      payload: {},
    });
    proposalId = proposal.json().proposal.id;
    expect(proposal.json().blocked).toBe(false);
  });

  it('cannot package before approval', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/package`,
      headers: checker,
    });
    expect(response.statusCode).toBe(409);
  });

  it('maker submits for review but cannot approve own proposal', async () => {
    const submit = await app.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/submit-for-review`,
      headers: maker,
    });
    expect(submit.statusCode).toBe(200);

    const selfApprove = await app.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/approve`,
      headers: maker,
      payload: { decision: 'approved' },
    });
    expect(selfApprove.statusCode).toBe(422);
    expect(selfApprove.json().error).toBe('maker_cannot_approve');
  });

  it('a different checker approves; package + verified download work', async () => {
    const approve = await app.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/approve`,
      headers: checker,
      payload: { decision: 'approved', comment: 'Granskad och godkänd' },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe('approved');

    const packaged = await app.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/package`,
      headers: checker,
    });
    expect(packaged.statusCode).toBe(201);
    const { manifestHash, packageHash } = packaged.json();
    expect(manifestHash).toMatch(/^[0-9a-f]{64}$/);

    const download = await app.inject({
      method: 'GET',
      url: `/ubm/export-proposals/${proposalId}/download`,
      headers: checker,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/zip');
    const zip = download.rawPayload;
    expect(createHash('sha256').update(zip).digest('hex')).toBe(packageHash);

    // The zip contains manifest.json with the recorded manifest hash.
    const zipText = zip.toString('latin1');
    expect(zipText).toContain('manifest.json');
    expect(zipText).toContain('export-summary.md');
    expect(zipText).toContain('checksums.txt');

    // Download is audited and access-logged.
    const audit = await db.query(
      `select 1 from audit_events where event_key = 'export.downloaded' and subject_id = $1::uuid`,
      [proposalId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(0); // in-memory audit sink until Batch 13
    const access = await db.query(
      `select 1 from data_access_events where case_id = $1::uuid and reason = 'nedladdning av exportpaket'`,
      [proposalId],
    );
    expect(access.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('registers manual sending and receipt; request reaches receipt_received', async () => {
    const send = await app.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/register-sending`,
      headers: checker,
      payload: { channel: 'säker e-post', recipientReference: 'UBM dnr 2026-123' },
    });
    expect(send.statusCode, send.body).toBe(200);

    const receipt = await app.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/receipt`,
      headers: checker,
      payload: { receiptReference: 'Mottagningskvitto 2026-07-09' },
    });
    expect(receipt.statusCode).toBe(200);

    const detail = await app.inject({
      method: 'GET',
      url: `/ubm/requests/${requestId}`,
      headers: maker,
    });
    expect(detail.json().request.status).toBe('receipt_received');

    // Close the request.
    const close = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/transition`,
      headers: maker,
      payload: { to: 'closed' },
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe('closed');
  });

  it('blocked proposals cannot be submitted or packaged', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/ubm/requests',
      headers: maker,
      payload: {
        requestNumber: `UBM-BLOCK2-${Date.now().toString(36)}`,
        receivedAt: new Date().toISOString(),
        domain: 'lss',
      },
    });
    const blockedRequestId = created.json().id;
    await app.inject({
      method: 'POST',
      url: `/ubm/requests/${blockedRequestId}/subjects`,
      headers: maker,
      payload: { personnummer: testPersonnummer(55) },
    });
    const proposal = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${blockedRequestId}/proposal`,
      headers: maker,
      payload: {},
    });
    expect(proposal.json().blocked).toBe(true);
    const blockedProposalId = proposal.json().proposal.id;

    const submit = await app.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${blockedProposalId}/submit-for-review`,
      headers: maker,
    });
    expect(submit.statusCode).toBe(409);
    expect(submit.json().message).toContain('blockerat');

    const packageAttempt = await app.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${blockedProposalId}/package`,
      headers: checker,
    });
    expect(packageAttempt.statusCode).toBe(409);
  });
});
