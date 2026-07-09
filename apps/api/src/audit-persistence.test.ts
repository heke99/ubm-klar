import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDbClient, type DbClient } from '@ubm-klar/db';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';
import { TenantDataPlanePool } from './data-plane';

/**
 * Persistent audit/data-access sinks and evidence chain:
 * - sensitive actions write hash-chained rows to the tenant data plane
 * - the chain verifies end-to-end and detects tampering
 * - production-like servers refuse tenants without a persistent data plane
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
  activeModules: ['lss', 'economic_assistance', 'ubm_readiness', 'import_gateway'],
  dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
  dataPlanePublishableKey: 'sb_publishable_malmo',
  authProvider: 'entra_id',
  featureFlags: {},
};

const noDataPlaneRecord: TenantDirectoryRecord = {
  ...record,
  tenantSlug: 'utan-dataplan',
  domain: 'utan-dataplan.ubmklar.se',
};

const directory: TenantDirectory = {
  lookupByDomain: async (domain) => {
    if (domain === 'malmo.ubmklar.se') return record;
    if (domain === 'utan-dataplan.ubmklar.se') return noDataPlaneRecord;
    return undefined;
  },
};

const manager = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'audit-manager',
  'x-roles': 'ubm_export_manager',
};
const auditor = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'auditor-1',
  'x-roles': 'internal_auditor',
};

describe.skipIf(!databaseUrl)('persistent audit and evidence chain', () => {
  let app: FastifyInstance;
  let db: DbClient;

  beforeAll(() => {
    db = createDbClient({ connectionString: databaseUrl!, applicationName: 'audit-test' });
    app = buildApiServer({
      directory,
      allowDemoTenant: false,
      auth: { allowInsecureHeaderAuth: true },
      dataPlane: new TenantDataPlanePool({
        // Only malmo has a data plane; 'utan-dataplan' resolves to nothing.
        DATA_PLANE_DATABASE_URL__MALMO__PROD: databaseUrl!,
      }),
      demoDataEnabled: false,
      requirePersistentAudit: true,
    });
  });

  it('sensitive actions write persistent hash-chained audit events', async () => {
    const requestNumber = `UBM-AUDIT-${Date.now().toString(36)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/ubm/requests',
      headers: manager,
      payload: { requestNumber, receivedAt: new Date().toISOString(), domain: 'lss' },
    });
    expect(created.statusCode).toBe(201);

    const rows = await db.query<{
      event_hash: string | null;
      previous_hash: string | null;
      context: { subjectRef?: string };
    }>(
      `select event_hash, previous_hash, context from audit_events
       where event_key = 'ubm.request_registered' order by occurred_at desc limit 1`,
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0]!.event_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('denied authorization writes a persistent audit event', async () => {
    const denied = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { ...manager, 'x-roles': 'billing_admin_no_pii' },
    });
    expect(denied.statusCode).toBe(403);
    // The denial audit write is fire-and-forget: poll briefly.
    let found = 0;
    for (let attempt = 0; attempt < 20 && found === 0; attempt++) {
      const rows = await db.query(
        `select 1 from audit_events where event_key = 'authorization.denied' and outcome = 'denied' limit 1`,
      );
      found = rows.rows.length;
      if (found === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(found).toBe(1);
  });

  it('the evidence chain verifies over the persistent log', async () => {
    const verify = await app.inject({
      method: 'GET',
      url: '/audit/verify-chain',
      headers: auditor,
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().verification.valid).toBe(true);
    expect(verify.json().eventCount).toBeGreaterThan(0);
  });

  it('audit events are append-only in the database (no update/delete)', async () => {
    await expect(
      db.query(
        `update audit_events set action = 'manipulated' where event_key = 'ubm.request_registered'`,
      ),
    ).rejects.toThrow();
  });

  it('detects tampered events and shows a tamper warning', async () => {
    // Insert a forged event whose content does not match its hash. Backdated so
    // no concurrent legitimate event chains onto the forged hash before cleanup.
    const forged = await db.query<{ id: string }>(
      `insert into audit_events (event_key, action, outcome, occurred_at, previous_hash, event_hash)
       values ('case.open', 'forged_action', 'success', now() - interval '1 hour', null, repeat('0', 64)) returning id`,
    );
    try {
      const verify = await app.inject({
        method: 'GET',
        url: '/audit/verify-chain',
        headers: auditor,
      });
      expect(verify.json().verification.valid).toBe(false);
      expect(verify.json().verification.reason).toContain('tampered');
    } finally {
      // Cleanup requires bypassing the append-only trigger (superuser test database).
      await db.query('alter table audit_events disable trigger all');
      await db.query('delete from audit_events where id = $1::uuid', [forged.rows[0]!.id]);
      await db.query('alter table audit_events enable trigger all');
    }
  });

  it('logs are searchable via the API with filters', async () => {
    const events = await app.inject({
      method: 'GET',
      url: '/audit/events?eventKey=authorization.denied&outcome=denied',
      headers: auditor,
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().events.length).toBeGreaterThan(0);
    expect(
      events
        .json()
        .events.every((e: { eventKey: string }) => e.eventKey === 'authorization.denied'),
    ).toBe(true);
  });

  it('production-like servers refuse tenants without a persistent data plane', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { ...manager, host: 'utan-dataplan.ubmklar.se' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('audit_unavailable');
  });
});
