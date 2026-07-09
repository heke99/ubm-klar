import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbClient, type DbClient } from '@ubm-klar/db';
import { LocalFileStorage, type MalwareScanner } from '@ubm-klar/document-vault';
import { ControlPlaneTenantDirectory } from '@ubm-klar/tenant-resolver';
import { buildControlPlaneServer, InMemoryControlPlaneStore } from '@ubm-klar/control-plane';
import { buildApiServer } from './server';
import { TenantDataPlanePool } from './data-plane';

/**
 * END-TO-END pilot suite: a REAL control plane (HTTP) + the API + a real data
 * plane database, covering the 9 critical pilot flows. Runs in CI's database
 * job (DATA_PLANE_TEST_DATABASE_URL) and locally against Postgres 16.
 */
const databaseUrl = process.env.DATA_PLANE_TEST_DATABASE_URL;

const RUN = Date.now().toString(36).toUpperCase();
function testPersonnummer(rawSeed: number): string {
  const seed = rawSeed + (Date.now() % 600);
  const day = String(10 + (seed % 18)).padStart(2, '0');
  const nineDigits = `1204${day}${String(100 + (seed % 899))}`;
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
  throw new Error('no check digit');
}

const DOMAIN = 'pilotstad.ubmklar.se';
const maker = { host: DOMAIN, 'x-user-id': 'e2e-maker', 'x-roles': 'ubm_export_manager' };
const checker = { host: DOMAIN, 'x-user-id': 'e2e-checker', 'x-roles': 'ubm_export_manager' };
const controller = { host: DOMAIN, 'x-user-id': 'e2e-controller', 'x-roles': 'controller' };
const investigator = {
  host: DOMAIN,
  'x-user-id': 'e2e-investigator',
  'x-roles': 'control_investigator',
};
const caseworker = { host: DOMAIN, 'x-user-id': 'e2e-worker', 'x-roles': 'lss_case_worker' };
const lawyerUser = { host: DOMAIN, 'x-user-id': 'e2e-lawyer', 'x-roles': 'lawyer' };
const admin = { host: DOMAIN, 'x-user-id': 'e2e-admin', 'x-roles': 'municipality_admin' };
const auditor = { host: DOMAIN, 'x-user-id': 'e2e-auditor', 'x-roles': 'internal_auditor' };

describe.skipIf(!databaseUrl)('E2E pilot flows (control plane + API + Postgres)', () => {
  let controlPlane: FastifyInstance;
  let controlPlaneUrl: string;
  let api: FastifyInstance;
  let db: DbClient;
  let tenantId: string;

  const scanner: MalwareScanner = {
    scan: async (_c, fileName) => (fileName.includes('virus') ? 'infected' : 'clean'),
  };

  beforeAll(async () => {
    db = createDbClient({ connectionString: databaseUrl!, applicationName: 'e2e-pilot' });

    // Real control plane over HTTP with admin + directory tokens.
    controlPlane = buildControlPlaneServer({
      store: new InMemoryControlPlaneStore(),
      adminToken: 'e2e-admin-token',
      directoryToken: 'e2e-dir-token',
    });
    await controlPlane.listen({ port: 0, host: '127.0.0.1' });
    const address = controlPlane.server.address();
    controlPlaneUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    api = buildApiServer({
      directory: new ControlPlaneTenantDirectory({
        baseUrl: controlPlaneUrl,
        directoryToken: 'e2e-dir-token',
        env: { DATA_PLANE_PUBLISHABLE_KEY__PILOTSTAD__PROD: 'sb_publishable_pilotstad' },
      }),
      allowDemoTenant: false,
      auth: { allowInsecureHeaderAuth: true },
      dataPlane: new TenantDataPlanePool({
        DATA_PLANE_DATABASE_URL__PILOTSTAD__PROD: databaseUrl!,
      }),
      demoDataEnabled: false,
      requirePersistentAudit: true,
      documents: {
        storage: new LocalFileStorage(mkdtempSync(join(tmpdir(), 'e2e-vault-'))),
        scanner,
        scannerProvider: 'external-api',
        isProductionLike: true,
      },
      readinessChecks: [
        {
          name: 'control_plane',
          required: true,
          run: async () => {
            const response = await fetch(`${controlPlaneUrl}/health`);
            return { ok: response.ok };
          },
        },
      ],
    });
  });

  afterAll(async () => {
    await controlPlane?.close();
    await db?.end();
  });

  const cpAuth = { authorization: 'Bearer e2e-admin-token', 'content-type': 'application/json' };

  it('Flow 1: provisioning + fail-closed tenant resolution across services', async () => {
    // Unknown domain fails closed BEFORE the tenant exists.
    const before = await api.inject({ method: 'GET', url: '/tenant', headers: { host: DOMAIN } });
    expect(before.statusCode).toBe(421);

    // Provision the tenant in the control plane over real HTTP.
    const tenantResponse = await controlPlane.inject({
      method: 'POST',
      url: '/tenants',
      headers: cpAuth,
      payload: {
        slug: 'pilotstad',
        municipalityName: 'Pilotstad',
        organizationNumber: '212000-7777',
        deploymentMode: 'model_b_vendor_hosted_isolated',
      },
    });
    tenantId = tenantResponse.json().id;
    const domain = (
      await controlPlane.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/domains`,
        headers: cpAuth,
        payload: { domain: DOMAIN, environment: 'prod' },
      })
    ).json();
    await controlPlane.inject({
      method: 'PUT',
      url: `/tenants/${tenantId}/environments`,
      headers: cpAuth,
      payload: { environment: 'prod', dataPlaneUrl: 'https://pilotstad-prod.example.se' },
    });
    for (const moduleId of [
      'lss',
      'economic_assistance',
      'payment_control',
      'control_cases',
      'ubm_readiness',
      'import_gateway',
      'document_vault',
    ]) {
      await controlPlane.inject({
        method: 'PUT',
        url: `/tenants/${tenantId}/modules`,
        headers: cpAuth,
        payload: { moduleId, enabled: true },
      });
    }

    // Still 421: the domain is registered but NOT verified (fail closed).
    const unverified = await api.inject({
      method: 'GET',
      url: '/tenant',
      headers: { host: DOMAIN },
    });
    expect(unverified.statusCode).toBe(421);

    const verified = await controlPlane.inject({
      method: 'POST',
      url: `/tenants/${tenantId}/domains/${domain.id}/verify`,
      headers: { authorization: 'Bearer e2e-admin-token' },
    });
    expect(verified.statusCode).toBe(200);

    const resolved = await api.inject({ method: 'GET', url: '/tenant', headers: { host: DOMAIN } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().municipality).toBe('Pilotstad');
    expect(resolved.json().dataPlanePublishableKey).toBe('sb_publishable_pilotstad');
    expect(JSON.stringify(resolved.json())).not.toContain('service_role');

    // Pilot approval marks the tenant as pilot -> resolver carries the status.
    await controlPlane.inject({
      method: 'PATCH',
      url: `/tenants/${tenantId}/status`,
      headers: cpAuth,
      payload: { status: 'onboarding' },
    });
    await controlPlane.inject({
      method: 'PUT',
      url: `/tenants/${tenantId}/approvals`,
      headers: cpAuth,
      payload: { kind: 'pilot', approved: true, approverId: 'vd-1', reason: 'Pilotavtal signerat' },
    });

    const ready = await api.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
  });

  it('Flow 2: authentication and authorization enforcement', async () => {
    const anonymous = await api.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { host: DOMAIN },
    });
    expect(anonymous.statusCode).toBe(401);
    const wrongRole = await api.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { host: DOMAIN, 'x-user-id': 'e2e-billing', 'x-roles': 'billing_admin_no_pii' },
    });
    expect(wrongRole.statusCode).toBe(403);
    const allowed = await api.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: caseworker,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().dataSource).not.toBe('demo');
  });

  let personPn: string;
  it('Flow 3: controlled import — upload, map, validate, commit with lineage', async () => {
    personPn = testPersonnummer(1);
    const csv = `pnr;fornamn\n${personPn};E2E-${RUN}\n`;
    const upload = await api.inject({
      method: 'POST',
      url: '/imports',
      headers: controller,
      payload: {
        fileName: `e2e-persons-${RUN}.csv`,
        contentBase64: Buffer.from(csv).toString('base64'),
        importTypeKey: 'lss_persons',
        sourceSystemKey: 'generic_csv',
      },
    });
    expect(upload.statusCode).toBe(201);
    const batchId = upload.json().batchId;
    await api.inject({
      method: 'POST',
      url: `/imports/${batchId}/mapping`,
      headers: controller,
      payload: {
        mappings: [
          { sourceColumn: 'pnr', targetField: 'personnummer', required: true },
          { sourceColumn: 'fornamn', targetField: 'given_name', required: false },
        ],
      },
    });
    const validate = await api.inject({
      method: 'POST',
      url: `/imports/${batchId}/validate`,
      headers: controller,
    });
    expect(validate.json().errorRows).toBe(0);
    const commit = await api.inject({
      method: 'POST',
      url: `/imports/${batchId}/commit`,
      headers: controller,
    });
    expect(commit.json().status).toBe('loaded');

    const lineage = await db.query(
      `select 1 from import_staging_rows where batch_id = $1::uuid and committed_entity_id is not null`,
      [batchId],
    );
    expect(lineage.rows.length).toBe(1);
  });

  it('Flow 4: payment control run creates flags and audited control cases', async () => {
    // Imported person gets an expired decision + late payment (rule trigger).
    const person = await db.query<{ id: string }>(
      'select id from persons where personal_identity_number = $1',
      [personPn],
    );
    const decision = await db.query<{ id: string }>(
      `insert into lss_decisions (person_id, decision_number, insats_kind, decision_kind, decided_at, status)
       values ($1::uuid, 'E2E-LSS-${RUN}', 'personlig_assistans', 'approval', '2025-01-01', 'expired') returning id`,
      [person.rows[0]!.id],
    );
    await db.query(
      `insert into lss_decision_periods (decision_id, period_start, period_end) values ($1::uuid, '2025-01-01', '2025-06-30')`,
      [decision.rows[0]!.id],
    );
    await db.query(
      `insert into lss_payments (person_id, decision_id, amount_sek, payment_date, status)
       values ($1::uuid, $2::uuid, 31000, '2026-06-25', 'paid')`,
      [person.rows[0]!.id, decision.rows[0]!.id],
    );

    const run = await api.inject({
      method: 'POST',
      url: '/payment-control/run',
      headers: controller,
      payload: { domain: 'lss' },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json().flagsCreated).toBeGreaterThan(0);

    const cases = await api.inject({ method: 'GET', url: '/control-cases', headers: investigator });
    expect(cases.json().cases.length).toBeGreaterThan(0);
    const caseId = cases.json().cases[0].id;
    await api.inject({
      method: 'POST',
      url: `/control-cases/${caseId}/outcome`,
      headers: investigator,
      payload: { outcome: 'payment_stopped', note: 'E2E' },
    });
    const detail = await api.inject({
      method: 'GET',
      url: `/control-cases/${caseId}`,
      headers: investigator,
    });
    expect(detail.json().case.outcome).toBe('payment_stopped');
  });

  let proposalId: string;
  let requestId: string;
  it('Flow 5: UBM request to packaged, downloaded, receipted and closed export', async () => {
    const created = await api.inject({
      method: 'POST',
      url: '/ubm/requests',
      headers: maker,
      payload: {
        requestNumber: `E2E-UBM-${RUN}`,
        receivedAt: new Date().toISOString(),
        domain: 'lss',
        legalSourceKey: 'lag_2024_ubm',
        requestedItems: [
          { itemKey: 'beslut', description: 'LSS-beslut', requestedDataKind: 'decisions' },
        ],
      },
    });
    requestId = created.json().id;
    await api.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/transition`,
      headers: maker,
      payload: { to: 'registered' },
    });
    const subject = await api.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/subjects`,
      headers: maker,
      payload: { personnummer: personPn },
    });
    expect(subject.json().matchStatus).toBe('matched');
    await api.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/transition`,
      headers: maker,
      payload: { to: 'validated' },
    });
    const proposal = await api.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/proposal`,
      headers: maker,
      payload: {},
    });
    expect(proposal.json().blocked).toBe(false);
    proposalId = proposal.json().proposal.id;

    await api.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/submit-for-review`,
      headers: maker,
    });
    const selfApprove = await api.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/approve`,
      headers: maker,
      payload: { decision: 'approved' },
    });
    expect(selfApprove.statusCode).toBe(422); // maker-checker

    await api.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/approve`,
      headers: checker,
      payload: { decision: 'approved' },
    });
    const packaged = await api.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/package`,
      headers: checker,
    });
    expect(packaged.statusCode).toBe(201);
    const download = await api.inject({
      method: 'GET',
      url: `/ubm/export-proposals/${proposalId}/download`,
      headers: checker,
    });
    expect(download.statusCode).toBe(200);
    expect(createHash('sha256').update(download.rawPayload).digest('hex')).toBe(
      packaged.json().packageHash,
    );
    await api.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/register-sending`,
      headers: checker,
      payload: { channel: 'säker e-post' },
    });
    await api.inject({
      method: 'POST',
      url: `/ubm/export-proposals/${proposalId}/receipt`,
      headers: checker,
      payload: { receiptReference: `E2E-KVITTENS-${RUN}` },
    });
    const close = await api.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/transition`,
      headers: maker,
      payload: { to: 'closed' },
    });
    expect(close.json().status).toBe('closed');
  });

  it('Flow 6: document vault — classified upload, reason-gated open, verified redaction', async () => {
    const upload = await api.inject({
      method: 'POST',
      url: '/documents',
      headers: caseworker,
      payload: {
        fileName: `e2e-intyg-${RUN}.txt`,
        contentBase64: Buffer.from(`Intyg för ${personPn} konto 123-4567.`).toString('base64'),
        mimeType: 'text/plain',
        bucketKey: 'documents-lss',
        documentType: 'certificate',
        documentClass: 'medical',
      },
    });
    expect(upload.statusCode).toBe(201);
    const documentId = upload.json().id;

    const noReason = await api.inject({
      method: 'POST',
      url: `/documents/${documentId}/open`,
      headers: caseworker,
      payload: {},
    });
    expect(noReason.statusCode).toBe(422);

    const opened = await api.inject({
      method: 'POST',
      url: `/documents/${documentId}/open`,
      headers: caseworker,
      payload: { reason: 'E2E-handläggning' },
    });
    expect(opened.statusCode).toBe(200);

    const plan = await api.inject({
      method: 'POST',
      url: `/documents/${documentId}/redaction/plan`,
      headers: lawyerUser,
      payload: {},
    });
    const apply = await api.inject({
      method: 'POST',
      url: `/documents/${documentId}/redaction/apply`,
      headers: lawyerUser,
      payload: { jobId: plan.json().jobId },
    });
    expect(apply.json().verified).toBe(true);

    const infected = await api.inject({
      method: 'POST',
      url: '/documents',
      headers: caseworker,
      payload: {
        fileName: `virus-${RUN}.txt`,
        contentBase64: Buffer.from('elak').toString('base64'),
        mimeType: 'text/plain',
        bucketKey: 'documents-lss',
        documentType: 'other',
      },
    });
    expect(infected.statusCode).toBe(422);
  });

  it('Flow 7: notification intake to outcome', async () => {
    const created = await api.inject({
      method: 'POST',
      url: '/ubm/notifications',
      headers: maker,
      payload: {
        notificationNumber: `E2E-UN-${RUN}`,
        receivedAt: new Date().toISOString(),
        domain: 'lss',
        summary: 'E2E-underrättelse.',
      },
    });
    const notificationId = created.json().id;
    const match = await api.inject({
      method: 'POST',
      url: `/ubm/notifications/${notificationId}/match`,
      headers: maker,
      payload: { personnummer: personPn },
    });
    expect(match.json().matchStatus).toBe('matched');
    await api.inject({
      method: 'POST',
      url: `/ubm/notifications/${notificationId}/create-case`,
      headers: maker,
      payload: {},
    });
    const outcome = await api.inject({
      method: 'POST',
      url: `/ubm/notifications/${notificationId}/outcome`,
      headers: maker,
      payload: { outcome: 'no_action' },
    });
    expect(outcome.statusCode).toBe(200);
  });

  it('Flow 8: persistent audit with verified evidence chain and searchable logs', async () => {
    const verify = await api.inject({
      method: 'GET',
      url: '/audit/verify-chain',
      headers: auditor,
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().verification.valid).toBe(true);
    expect(verify.json().hashedEventCount).toBeGreaterThan(0);

    const events = await api.inject({
      method: 'GET',
      url: '/audit/events?eventKey=export.downloaded',
      headers: auditor,
    });
    expect(events.json().events.length).toBeGreaterThan(0);

    const access = await api.inject({
      method: 'GET',
      url: '/audit/data-access?accessKind=person_search',
      headers: auditor,
    });
    expect(access.json().events.length).toBeGreaterThan(0);
  });

  it('Flow 9: readiness gates block production; waivers require full documentation', async () => {
    const status = await api.inject({
      method: 'GET',
      url: '/onboarding/approval-status',
      headers: admin,
    });
    expect(status.json().production.allowed).toBe(false);

    const badWaiver = await api.inject({
      method: 'POST',
      url: '/onboarding/gates/backup_tested/waiver',
      headers: admin,
      payload: { reason: '', expiresAt: '2099-01-01', riskLevel: 'low' },
    });
    expect(badWaiver.statusCode).toBe(422);

    const goodWaiver = await api.inject({
      method: 'POST',
      url: '/onboarding/gates/backup_tested/waiver',
      headers: admin,
      payload: { reason: 'E2E: syntetiska data', expiresAt: '2099-01-01', riskLevel: 'medium' },
    });
    expect(goodWaiver.statusCode).toBe(200);

    const gates = await api.inject({ method: 'GET', url: '/onboarding/gates', headers: admin });
    const backupGate = gates
      .json()
      .gates.find((gate: { gateKey: string }) => gate.gateKey === 'backup_tested');
    expect(backupGate.status).toBe('waived');
    expect(backupGate.waiverRiskLevel).toBe('medium');
  });
});
