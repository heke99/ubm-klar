import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDbClient, type DbClient } from '@ubm-klar/db';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';
import { TenantDataPlanePool } from './data-plane';

/** Municipality admin: users/roles with audited grants, support access review. */
const databaseUrl = process.env.DATA_PLANE_TEST_DATABASE_URL;

const record: TenantDirectoryRecord = {
  tenantId: 'tenant-malmo',
  tenantSlug: 'malmo',
  municipalityName: 'Malmö stad',
  deploymentMode: 'model_b_vendor_hosted_isolated',
  environment: 'prod',
  domain: 'malmo.ubmklar.se',
  domainVerified: true,
  activeModules: ['lss', 'economic_assistance', 'platform_foundation'],
  dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
  dataPlanePublishableKey: 'sb_publishable_malmo',
  authProvider: 'entra_id',
  featureFlags: {},
};

const directory: TenantDirectory = {
  lookupByDomain: async (domain) => (domain === 'malmo.ubmklar.se' ? record : undefined),
};

const admin = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'kommun-admin',
  'x-roles': 'municipality_admin',
};

describe.skipIf(!databaseUrl)('municipality admin', () => {
  let app: FastifyInstance;
  let db: DbClient;

  beforeAll(() => {
    db = createDbClient({ connectionString: databaseUrl!, applicationName: 'admin-test' });
    app = buildApiServer({
      directory,
      allowDemoTenant: false,
      auth: { allowInsecureHeaderAuth: true },
      dataPlane: new TenantDataPlanePool({ DATA_PLANE_DATABASE_URL: databaseUrl! }),
      demoDataEnabled: false,
    });
  });

  it('lists users with their active roles', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/users', headers: admin });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().users)).toBe(true);
  });

  it('role grants require a reason and are audited; revocation works', async () => {
    const users = await app.inject({ method: 'GET', url: '/admin/users', headers: admin });
    const target = users.json().users[0];
    expect(target).toBeTruthy();

    const withoutReason = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/roles`,
      headers: admin,
      payload: { roleKey: 'internal_auditor', reason: '' },
    });
    expect(withoutReason.statusCode).toBe(400);

    const granted = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/roles`,
      headers: admin,
      payload: { roleKey: 'internal_auditor', reason: 'Internrevision Q3' },
    });
    expect(granted.statusCode).toBe(201);

    const audit = await db.query(
      `select 1 from audit_events where event_key = 'role_mapping.changed'
       and action = 'role_granted_internal_auditor' limit 1`,
    );
    expect(audit.rows.length).toBe(1);

    const afterGrant = await app.inject({ method: 'GET', url: '/admin/users', headers: admin });
    const updated = afterGrant.json().users.find((u: { id: string }) => u.id === target.id);
    expect(updated.roles).toContain('internal_auditor');

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${target.id}/roles/internal_auditor`,
      headers: admin,
    });
    expect(revoked.statusCode).toBe(200);
    const afterRevoke = await app.inject({ method: 'GET', url: '/admin/users', headers: admin });
    const final = afterRevoke.json().users.find((u: { id: string }) => u.id === target.id);
    expect(final.roles).not.toContain('internal_auditor');
  });

  it('support access review lists JIT and break-glass sessions from the audit log', async () => {
    // Create a support session so the review has content.
    await app.inject({
      method: 'POST',
      url: '/support/jit-sessions',
      headers: { ...admin, 'x-user-id': 'vendor-support', 'x-roles': 'support_technician_no_pii' },
      payload: {
        supportCaseReference: 'SUP-2026-042',
        approvedByMunicipalityUser: 'kommun-admin',
        scope: 'technical_status',
        reason: 'Felsökning importkö',
        requestedDurationMs: 60 * 60 * 1000,
      },
    });
    const review = await app.inject({
      method: 'GET',
      url: '/admin/support-access',
      headers: { ...admin, 'x-roles': 'internal_auditor' },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().sessions.length).toBeGreaterThan(0);
    expect(JSON.stringify(review.json())).not.toMatch(/\d{6}[-+]?\d{4}/); // no personnummer-like content
  });

  it('non-admin roles cannot manage users', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { ...admin, 'x-roles': 'lss_case_worker' },
    });
    expect(response.statusCode).toBe(403);
  });
});
