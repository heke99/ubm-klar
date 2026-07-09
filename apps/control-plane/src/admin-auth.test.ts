import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildControlPlaneServer } from './server';
import { InMemoryControlPlaneStore } from './store';

let app: FastifyInstance;

beforeEach(() => {
  app = buildControlPlaneServer({
    store: new InMemoryControlPlaneStore(),
    adminToken: 'test-admin-token',
  });
});

describe('control plane admin auth', () => {
  it('health stays open without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('rejects requests without a bearer token', async () => {
    const response = await app.inject({ method: 'GET', url: '/tenants' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects requests with the wrong token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tenants',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts requests with the correct token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tenants',
      headers: { authorization: 'Bearer test-admin-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});

describe('approvals and domain verification', () => {
  async function createTenant(appWithAuth: FastifyInstance) {
    const response = await appWithAuth.inject({
      method: 'POST',
      url: '/tenants',
      headers: { authorization: 'Bearer test-admin-token' },
      payload: {
        slug: 'malmo',
        municipalityName: 'Malmö stad',
        organizationNumber: '212000-1124',
        deploymentMode: 'model_b_vendor_hosted_isolated',
      },
    });
    return response.json();
  }

  it('verifies a domain and exposes it in the directory', async () => {
    const tenant = await createTenant(app);
    const auth = { authorization: 'Bearer test-admin-token' };
    const domain = (
      await app.inject({
        method: 'POST',
        url: `/tenants/${tenant.id}/domains`,
        headers: auth,
        payload: { domain: 'malmo.ubmklar.se', environment: 'prod' },
      })
    ).json();

    // Unverified domains are invisible to the directory (fail closed).
    const before = await app.inject({
      method: 'GET',
      url: '/directory/domains/malmo.ubmklar.se',
      headers: auth,
    });
    expect(before.statusCode).toBe(404);

    const verify = await app.inject({
      method: 'POST',
      url: `/tenants/${tenant.id}/domains/${domain.id}/verify`,
      headers: auth,
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().verified).toBe(true);

    const after = await app.inject({
      method: 'GET',
      url: '/directory/domains/malmo.ubmklar.se',
      headers: auth,
    });
    expect(after.statusCode).toBe(200);
    const record = after.json();
    expect(record.tenantSlug).toBe('malmo');
    expect(record.verified).toBe(true);
    expect(JSON.stringify(record)).not.toMatch(/service_role|sb_secret/);
  });

  it('requires approver and reason for approvals', async () => {
    const tenant = await createTenant(app);
    const auth = { authorization: 'Bearer test-admin-token' };
    const response = await app.inject({
      method: 'PUT',
      url: `/tenants/${tenant.id}/approvals`,
      headers: auth,
      payload: { kind: 'pilot', approved: true, approverId: '', reason: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('production is not allowed until required gates pass', async () => {
    const tenant = await createTenant(app);
    const auth = { authorization: 'Bearer test-admin-token' };
    await app.inject({
      method: 'PUT',
      url: `/tenants/${tenant.id}/readiness-gates`,
      headers: auth,
      payload: { gateId: 'rls_tests', gateName: 'RLS-tester', required: true, status: 'failed' },
    });
    await app.inject({
      method: 'PUT',
      url: `/tenants/${tenant.id}/approvals`,
      headers: auth,
      payload: { kind: 'production', approved: true, approverId: 'ansvarig-1', reason: 'go-live' },
    });
    const status = (
      await app.inject({ method: 'GET', url: `/tenants/${tenant.id}/approvals`, headers: auth })
    ).json();
    expect(status.productionApproved).toBe(true);
    expect(status.productionAllowed).toBe(false);
    expect(status.openRequiredGates).toContain('rls_tests');
  });
});
