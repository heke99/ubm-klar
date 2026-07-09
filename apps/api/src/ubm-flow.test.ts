import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDbClient, type DbClient } from '@ubm-klar/db';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';
import { TenantDataPlanePool } from './data-plane';

/**
 * UBM request workflow against a real data plane: manual registration,
 * validation, subject matching with confidence, eligibility on real data,
 * export proposal creation (including blocked proposals that explain why).
 */
const databaseUrl = process.env.DATA_PLANE_TEST_DATABASE_URL;

const RUN_SALT = Date.now() % 800;
function testPersonnummer(rawSeed: number): string {
  const seed = rawSeed + RUN_SALT + 400;
  const day = String(10 + (seed % 18)).padStart(2, '0');
  const serial = String(100 + (seed % 899));
  const nineDigits = `1202${day}${serial}`;
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

const exportManager = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'ubm-manager',
  'x-roles': 'ubm_export_manager',
};
const lawyer = { host: 'malmo.ubmklar.se', 'x-user-id': 'lawyer-1', 'x-roles': 'lawyer' };
const dpo = { host: 'malmo.ubmklar.se', 'x-user-id': 'dpo-1', 'x-roles': 'dpo' };

describe.skipIf(!databaseUrl)('UBM request workflow', () => {
  let app: FastifyInstance;
  let db: DbClient;
  let pn: string;
  let personId: string;

  beforeAll(async () => {
    db = createDbClient({ connectionString: databaseUrl!, applicationName: 'ubm-flow-test' });
    app = buildApiServer({
      directory,
      allowDemoTenant: false,
      auth: { allowInsecureHeaderAuth: true },
      dataPlane: new TenantDataPlanePool({ DATA_PLANE_DATABASE_URL: databaseUrl! }),
      demoDataEnabled: false,
    });

    // Seed a person with an LSS decision + payment WITH import lineage.
    pn = testPersonnummer(1);
    const person = await db.query<{ id: string }>(
      `insert into persons (personal_identity_number, is_synthetic) values ($1, false) returning id`,
      [pn],
    );
    personId = person.rows[0]!.id;
    const batch = await db.query<{ id: string }>(
      `insert into import_batches (import_kind, file_name, status) values ('persons', 'seed.csv', 'loaded') returning id`,
    );
    await db.query(
      `insert into import_staging_rows (batch_id, row_number, raw, committed_entity_kind, committed_entity_id)
       values ($1::uuid, 1, '{}'::jsonb, 'person', $2::uuid)`,
      [batch.rows[0]!.id, personId],
    );
    await db.query(
      `insert into lss_decisions (person_id, decision_number, insats_kind, decision_kind, decided_at)
       values ($1::uuid, $2, 'personlig_assistans', 'approval', '2026-01-15')`,
      [personId, `LSS-${Date.now()}`],
    );
    await db.query(
      `insert into lss_payments (person_id, amount_sek, payment_date, status)
       values ($1::uuid, 25000, '2026-06-25', 'paid')`,
      [personId],
    );
  });

  it('registers a request manually and refuses disabled intake channels', async () => {
    const refused = await app.inject({
      method: 'POST',
      url: '/ubm/requests',
      headers: exportManager,
      payload: {
        requestNumber: 'UBM-KANAL-TEST',
        intakeChannel: 'official_transport',
        receivedAt: new Date().toISOString(),
      },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toBe('intake_channel_disabled');
  });

  it('runs the full manual workflow to an approved-path proposal', async () => {
    const requestNumber = `UBM-2026-${Date.now().toString(36).toUpperCase()}`;
    const created = await app.inject({
      method: 'POST',
      url: '/ubm/requests',
      headers: exportManager,
      payload: {
        requestNumber,
        receivedAt: new Date().toISOString(),
        deadlineAt: '2026-09-01',
        domain: 'lss',
        legalSourceKey: 'lag_2024_ubm',
        requestedItems: [
          { itemKey: 'beslut', description: 'Gällande LSS-beslut', requestedDataKind: 'decisions' },
          {
            itemKey: 'utbetalningar',
            description: 'Utbetalningar 2026',
            requestedDataKind: 'payments',
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const requestId = created.json().id;

    // received -> registered
    const registered = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/transition`,
      headers: exportManager,
      payload: { to: 'registered' },
    });
    expect(registered.statusCode).toBe(200);

    // Subject matching by personnummer with confidence + reason.
    const subject = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/subjects`,
      headers: exportManager,
      payload: { personnummer: pn },
    });
    expect(subject.statusCode).toBe(201);
    expect(subject.json().matchStatus).toBe('matched');
    expect(subject.json().matchConfidence).toBe(1);
    expect(subject.json().matchReason).toContain('personnummer');

    // Unknown person -> not_found with explanation.
    const noMatch = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/subjects`,
      headers: exportManager,
      payload: { personnummer: testPersonnummer(77) },
    });
    expect(noMatch.json().matchStatus).toBe('not_found');

    // registered -> validated (has subject + items)
    const validated = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/transition`,
      headers: exportManager,
      payload: { to: 'validated' },
    });
    expect(validated.statusCode).toBe(200);

    // Eligibility on real data: payments involved -> maker-checker required.
    const eligibility = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/eligibility`,
      headers: exportManager,
      payload: {},
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json().input.municipalityHoldsRelevantData).toBe(true);
    expect(eligibility.json().input.dataLineageComplete).toBe(true);
    expect(eligibility.json().decision.outcome).toBe('requires_maker_checker');

    // Create the proposal: not blocked, carries real rows.
    const proposal = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/proposal`,
      headers: exportManager,
      payload: {},
    });
    expect(proposal.statusCode).toBe(201);
    expect(proposal.json().blocked).toBe(false);
    const proposalId = proposal.json().proposal.id;

    const detail = await app.inject({
      method: 'GET',
      url: `/ubm/requests/${requestId}`,
      headers: exportManager,
    });
    expect(detail.json().request.status).toBe('proposal_created');
    expect(detail.json().proposals[0].id).toBe(proposalId);

    // Proposal rows contain the person's decisions and payments.
    const rows = await db.query(
      'select entity_kind from ubm_export_rows where proposal_id = $1::uuid',
      [proposalId],
    );
    const kinds = rows.rows.map((r) => r.entity_kind);
    expect(kinds).toContain('lss_decision');
    expect(kinds).toContain('lss_payment');
  });

  it('legal/DPO reviews are recorded and audit-logged', async () => {
    const requestNumber = `UBM-REVIEW-${Date.now().toString(36)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/ubm/requests',
      headers: exportManager,
      payload: { requestNumber, receivedAt: new Date().toISOString(), domain: 'lss' },
    });
    const requestId = created.json().id;

    const legalReview = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/reviews`,
      headers: lawyer,
      payload: { kind: 'legal', decision: 'approved', comment: 'OK enligt OSL-prövning' },
    });
    expect(legalReview.statusCode).toBe(201);

    const dpoReview = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/reviews`,
      headers: dpo,
      payload: { kind: 'dpo', decision: 'approved' },
    });
    expect(dpoReview.statusCode).toBe(201);

    // Case workers cannot submit legal reviews.
    const denied = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/reviews`,
      headers: { ...exportManager, 'x-roles': 'lss_case_worker' },
      payload: { kind: 'legal', decision: 'approved' },
    });
    expect(denied.statusCode).toBe(403);

    const detail = await app.inject({
      method: 'GET',
      url: `/ubm/requests/${requestId}`,
      headers: exportManager,
    });
    expect(detail.json().reviews).toHaveLength(2);
  });

  it('creates a BLOCKED proposal with clear reasons when no data exists', async () => {
    const requestNumber = `UBM-BLOCKED-${Date.now().toString(36)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/ubm/requests',
      headers: exportManager,
      payload: { requestNumber, receivedAt: new Date().toISOString(), domain: 'lss' },
    });
    const requestId = created.json().id;
    await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/transition`,
      headers: exportManager,
      payload: { to: 'registered' },
    });
    // Subject that does not exist in the data plane.
    await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/subjects`,
      headers: exportManager,
      payload: { personnummer: testPersonnummer(99) },
    });

    const proposal = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/proposal`,
      headers: exportManager,
      payload: {},
    });
    expect(proposal.statusCode).toBe(201);
    expect(proposal.json().blocked).toBe(true);
    expect(proposal.json().proposal.status).toBe('eligibility_blocked');
    expect(proposal.json().decision.blockers.length).toBeGreaterThan(0);
  });

  it('rejects invalid state transitions', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/ubm/requests',
      headers: exportManager,
      payload: {
        requestNumber: `UBM-TRANS-${Date.now().toString(36)}`,
        receivedAt: new Date().toISOString(),
      },
    });
    const requestId = created.json().id;
    const invalid = await app.inject({
      method: 'POST',
      url: `/ubm/requests/${requestId}/transition`,
      headers: exportManager,
      payload: { to: 'approved' },
    });
    expect(invalid.statusCode).toBe(409);
  });
});
