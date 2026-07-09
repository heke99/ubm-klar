import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDbClient, type DbClient } from '@ubm-klar/db';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';
import { TenantDataPlanePool } from './data-plane';

/** Manual UBM notification intake -> matching -> control case -> outcome -> close. */
const databaseUrl = process.env.DATA_PLANE_TEST_DATABASE_URL;

const record: TenantDirectoryRecord = {
  tenantId: 'tenant-malmo',
  tenantSlug: 'malmo',
  municipalityName: 'Malmö stad',
  deploymentMode: 'model_b_vendor_hosted_isolated',
  environment: 'prod',
  domain: 'malmo.ubmklar.se',
  domainVerified: true,
  activeModules: ['lss', 'economic_assistance', 'ubm_readiness', 'control_cases'],
  dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
  dataPlanePublishableKey: 'sb_publishable_malmo',
  authProvider: 'entra_id',
  featureFlags: {},
};

const directory: TenantDirectory = {
  lookupByDomain: async (domain) => (domain === 'malmo.ubmklar.se' ? record : undefined),
};

const handler = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'notif-handler',
  'x-roles': 'ubm_export_manager',
};

describe.skipIf(!databaseUrl)('UBM notification flow', () => {
  let app: FastifyInstance;
  let db: DbClient;
  let pn: string;

  beforeAll(async () => {
    db = createDbClient({ connectionString: databaseUrl!, applicationName: 'notif-test' });
    app = buildApiServer({
      directory,
      allowDemoTenant: false,
      auth: { allowInsecureHeaderAuth: true },
      dataPlane: new TenantDataPlanePool({ DATA_PLANE_DATABASE_URL: databaseUrl! }),
      demoDataEnabled: false,
    });
    pn = `19351111-${String(1000 + (Date.now() % 8999))}`;
    await db.query(
      `insert into persons (personal_identity_number, is_synthetic) values ($1, false)
       on conflict (personal_identity_number) do nothing`,
      [pn],
    );
  });

  it('registers, matches (logged), creates a case, records outcome and closes', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/ubm/notifications',
      headers: handler,
      payload: {
        notificationNumber: `UN-${Date.now().toString(36).toUpperCase()}`,
        receivedAt: new Date().toISOString(),
        domain: 'economic_assistance',
        summary: 'Underrättelse om möjlig parallell utbetalning i annan kommun.',
      },
    });
    expect(created.statusCode).toBe(201);
    const notificationId = created.json().id;

    // No-match first: manual review.
    const noMatch = await app.inject({
      method: 'POST',
      url: `/ubm/notifications/${notificationId}/match`,
      headers: handler,
      payload: { personnummer: '19360101-9999' },
    });
    expect(noMatch.json().matchStatus).toBe('no_match');

    // Real match: confidence 1.0 with related data counts.
    const matched = await app.inject({
      method: 'POST',
      url: `/ubm/notifications/${notificationId}/match`,
      headers: handler,
      payload: { personnummer: pn },
    });
    expect(matched.json().matchStatus).toBe('matched');
    expect(matched.json().confidence).toBe(1);

    // Matching wrote a data access event with the notification as the reason.
    const accessLog = await db.query(
      `select 1 from data_access_events where case_id = $1::uuid and access_kind = 'person_search' limit 1`,
      [notificationId],
    );
    expect(accessLog.rows.length).toBe(1);

    // Create a control case from the notification.
    const caseCreated = await app.inject({
      method: 'POST',
      url: `/ubm/notifications/${notificationId}/create-case`,
      headers: handler,
      payload: {},
    });
    expect(caseCreated.statusCode).toBe(201);
    const caseId = caseCreated.json().caseId;
    expect(caseId).toBeTruthy();

    // Duplicate case creation is refused.
    const duplicate = await app.inject({
      method: 'POST',
      url: `/ubm/notifications/${notificationId}/create-case`,
      headers: handler,
      payload: {},
    });
    expect(duplicate.statusCode).toBe(409);

    // Outcome + close.
    const outcome = await app.inject({
      method: 'POST',
      url: `/ubm/notifications/${notificationId}/outcome`,
      headers: handler,
      payload: { outcome: 'recovery_claim', detail: 'Återkrav initierat.' },
    });
    expect(outcome.statusCode).toBe(200);
    expect(outcome.json().note).toContain('manuellt');

    const closed = await app.inject({
      method: 'POST',
      url: `/ubm/notifications/${notificationId}/close`,
      headers: handler,
      payload: {},
    });
    expect(closed.json().status).toBe('closed');

    // Full audit trail persisted.
    const audit = await db.query(
      `select action from audit_events where subject_id = $1::uuid order by occurred_at`,
      [notificationId],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'notification_registered',
        'notification_matched',
        'control_case_created',
        'outcome_recovery_claim',
        'notification_closed',
      ]),
    );
  });

  it('no official transmission endpoint exists', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/ubm/notifications',
      headers: handler,
      payload: {
        notificationNumber: `UN-TX-${Date.now().toString(36)}`,
        receivedAt: new Date().toISOString(),
        summary: 'Test.',
      },
    });
    const notificationId = created.json().id;
    const transmit = await app.inject({
      method: 'POST',
      url: `/ubm/notifications/${notificationId}/transmit`,
      headers: handler,
      payload: {},
    });
    expect(transmit.statusCode).toBe(404);
  });

  it('unauthorized roles cannot handle notifications', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ubm/notifications',
      headers: { ...handler, 'x-roles': 'lss_case_worker' },
      payload: {
        notificationNumber: 'UN-DENIED',
        receivedAt: new Date().toISOString(),
        summary: 'Otillåten.',
      },
    });
    expect(response.statusCode).toBe(403);
  });
});
