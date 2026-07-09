import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDbClient, type DbClient } from '@ubm-klar/db';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';
import { TenantDataPlanePool } from './data-plane';

/**
 * Payment control on imported data: rule run creates risk flags, high/critical
 * flags become control cases, and the case workflow (assign/note/status/
 * outcome) is fully audited.
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
  activeModules: ['lss', 'economic_assistance', 'payment_control', 'control_cases'],
  dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
  dataPlanePublishableKey: 'sb_publishable_malmo',
  authProvider: 'entra_id',
  featureFlags: {},
};

const directory: TenantDirectory = {
  lookupByDomain: async (domain) => (domain === 'malmo.ubmklar.se' ? record : undefined),
};

const controller = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'pc-controller',
  'x-roles': 'controller',
};
const investigator = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'pc-investigator',
  'x-roles': 'control_investigator',
};

describe.skipIf(!databaseUrl)('payment control flow', () => {
  let app: FastifyInstance;
  let db: DbClient;
  let expiredDecisionPaymentId: string;

  beforeAll(async () => {
    db = createDbClient({ connectionString: databaseUrl!, applicationName: 'pc-test' });
    app = buildApiServer({
      directory,
      allowDemoTenant: false,
      auth: { allowInsecureHeaderAuth: true },
      dataPlane: new TenantDataPlanePool({ DATA_PLANE_DATABASE_URL: databaseUrl! }),
      demoDataEnabled: false,
    });

    // Seed an "imported" scenario that MUST trigger rules:
    // an expired decision with a payment after the decision period ended.
    const person = await db.query<{ id: string }>(
      `insert into persons (personal_identity_number, is_synthetic)
       values ('19340404-' || lpad((floor(random() * 9000) + 1000)::text, 4, '0'), false)
       on conflict (personal_identity_number) do update set updated_at = now()
       returning id`,
    );
    const personId = person.rows[0]!.id;
    const decision = await db.query<{ id: string }>(
      `insert into lss_decisions (person_id, decision_number, insats_kind, decision_kind, decided_at, status)
       values ($1::uuid, 'LSS-PC-' || extract(epoch from now())::bigint, 'personlig_assistans', 'approval', '2025-01-01', 'expired')
       returning id`,
      [personId],
    );
    await db.query(
      `insert into lss_decision_periods (decision_id, period_start, period_end)
       values ($1::uuid, '2025-01-01', '2025-12-31')`,
      [decision.rows[0]!.id],
    );
    const payment = await db.query<{ id: string }>(
      `insert into lss_payments (person_id, decision_id, amount_sek, payment_date, status)
       values ($1::uuid, $2::uuid, 45000, '2026-06-25', 'paid') returning id`,
      [personId, decision.rows[0]!.id],
    );
    expiredDecisionPaymentId = payment.rows[0]!.id;
  });

  it('rule run over imported data creates risk flags and control cases', async () => {
    const run = await app.inject({
      method: 'POST',
      url: '/payment-control/run',
      headers: controller,
      payload: { domain: 'lss' },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json().rulesEvaluated).toBe(25);
    expect(run.json().flagsCreated).toBeGreaterThan(0);

    // The expired-decision payment must be flagged.
    const flags = await db.query<{ id: string; severity: string; control_case_id: string | null }>(
      `select id, severity, control_case_id from risk_flags where subject_id = $1::uuid`,
      [expiredDecisionPaymentId],
    );
    expect(flags.rows.length).toBeGreaterThan(0);
    const highFlag = flags.rows.find((f) => ['high', 'critical'].includes(f.severity));
    expect(highFlag).toBeTruthy();
    expect(highFlag!.control_case_id).toBeTruthy();
  });

  it('rule runs are idempotent (no duplicate open flags)', async () => {
    const before = await db.query<{ count: string }>(
      `select count(*) as count from risk_flags where subject_id = $1::uuid`,
      [expiredDecisionPaymentId],
    );
    await app.inject({
      method: 'POST',
      url: '/payment-control/run',
      headers: controller,
      payload: { domain: 'lss' },
    });
    const after = await db.query<{ count: string }>(
      `select count(*) as count from risk_flags where subject_id = $1::uuid`,
      [expiredDecisionPaymentId],
    );
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
  });

  it('dashboard shows real case counts', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/control-cases',
      headers: investigator,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().cases.length).toBeGreaterThan(0);
    expect(response.json().counts).toBeTruthy();
  });

  it('case workflow: assign, note, status, outcome — all with event trail', async () => {
    const flag = await db.query<{ control_case_id: string }>(
      `select control_case_id from risk_flags
       where subject_id = $1::uuid and control_case_id is not null limit 1`,
      [expiredDecisionPaymentId],
    );
    const caseId = flag.rows[0]!.control_case_id;

    const assign = await app.inject({
      method: 'POST',
      url: `/control-cases/${caseId}/assign`,
      headers: investigator,
      payload: { assigneeSubjectId: 'pc-investigator' },
    });
    expect(assign.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/control-cases/${caseId}/notes`,
      headers: investigator,
      payload: { note: 'Kontaktar anordnaren för underlag.' },
    });
    await app.inject({
      method: 'POST',
      url: `/control-cases/${caseId}/transition`,
      headers: investigator,
      payload: { status: 'investigating' },
    });
    const outcome = await app.inject({
      method: 'POST',
      url: `/control-cases/${caseId}/outcome`,
      headers: investigator,
      payload: { outcome: 'payment_stopped', note: 'Utbetalning stoppad i väntan på utredning.' },
    });
    expect(outcome.statusCode).toBe(200);

    const detail = await app.inject({
      method: 'GET',
      url: `/control-cases/${caseId}`,
      headers: investigator,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.case.status).toBe('decided');
    expect(body.case.outcome).toBe('payment_stopped');
    expect(body.notes.length).toBeGreaterThan(0);
    expect(body.flags.length).toBeGreaterThan(0);
    const eventKinds = body.events.map((e: { eventKind: string }) => e.eventKind);
    expect(eventKinds).toEqual(
      expect.arrayContaining(['assigned', 'status_investigating', 'outcome_registered']),
    );

    // Actions are in the persistent audit log.
    const audit = await db.query(
      `select 1 from audit_events where event_key = 'control_case.action' and subject_id = $1::uuid limit 1`,
      [caseId],
    );
    expect(audit.rows.length).toBe(1);
  });

  it('read-only roles cannot act on cases', async () => {
    const flag = await db.query<{ control_case_id: string }>(
      `select control_case_id from risk_flags
       where subject_id = $1::uuid and control_case_id is not null limit 1`,
      [expiredDecisionPaymentId],
    );
    const response = await app.inject({
      method: 'POST',
      url: `/control-cases/${flag.rows[0]!.control_case_id}/notes`,
      headers: { ...investigator, 'x-roles': 'read_only_reviewer' },
      payload: { note: 'otillåten' },
    });
    expect(response.statusCode).toBe(403);
  });
});
