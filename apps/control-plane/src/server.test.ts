import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildControlPlaneServer } from './server';
import { InMemoryControlPlaneStore } from './store';

let app: FastifyInstance;
let store: InMemoryControlPlaneStore;

beforeEach(() => {
  store = new InMemoryControlPlaneStore();
  app = buildControlPlaneServer({ store });
});

async function createTenant(overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/tenants',
    payload: {
      slug: 'malmo',
      municipalityName: 'Malmö stad',
      organizationNumber: '212000-1124',
      deploymentMode: 'model_b_vendor_hosted_isolated',
      ...overrides,
    },
  });
  return response;
}

describe('control plane tenants', () => {
  it('creates a tenant with metadata only', async () => {
    const response = await createTenant();
    expect(response.statusCode).toBe(201);
    const tenant = response.json();
    expect(tenant.slug).toBe('malmo');
    expect(tenant.status).toBe('prospect');
  });

  it('rejects duplicate slugs', async () => {
    await createTenant();
    const response = await createTenant();
    expect(response.statusCode).toBe(500);
  });

  it('rejects invalid organization numbers', async () => {
    const response = await createTenant({ organizationNumber: 'not-a-number' });
    expect(response.statusCode).toBe(400);
  });
});

describe('no-PII boundary', () => {
  it('rejects request bodies containing personal identity numbers', async () => {
    const response = await createTenant({ municipalityName: 'Malmö 19811218-9876' });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('pii_rejected');
    expect(await store.listTenants()).toHaveLength(0);
  });

  it('rejects support cases with forbidden field names', async () => {
    const tenant = (await createTenant()).json();
    const response = await app.inject({
      method: 'POST',
      url: `/tenants/${tenant.id}/support-cases`,
      payload: {
        title: 'Import stuck',
        category: 'import',
        severity: 'high',
        descriptionNoPii: 'batch 42 stuck in queue',
        household_id: 'abc',
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it('accepts clean no-PII support cases', async () => {
    const tenant = (await createTenant()).json();
    const response = await app.inject({
      method: 'POST',
      url: `/tenants/${tenant.id}/support-cases`,
      payload: {
        title: 'Import stuck',
        category: 'import',
        severity: 'high',
        descriptionNoPii: 'import batch stuck at validation step, error E_TIMEOUT',
        errorCode: 'E_TIMEOUT',
      },
    });
    expect(response.statusCode).toBe(201);
  });
});

describe('domains', () => {
  it('accepts valid Model B subdomains', async () => {
    const tenant = (await createTenant()).json();
    const response = await app.inject({
      method: 'POST',
      url: `/tenants/${tenant.id}/domains`,
      payload: { domain: 'malmo.ubmklar.se', environment: 'prod' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().domainModel).toBe('model_b_subdomain');
  });

  it('accepts valid Model C municipality domains', async () => {
    const tenant = (await createTenant()).json();
    const response = await app.inject({
      method: 'POST',
      url: `/tenants/${tenant.id}/domains`,
      payload: { domain: 'ubm-klar.malmo.se', environment: 'prod' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().domainModel).toBe('model_c_municipality_domain');
  });

  it('rejects authority-implying domains', async () => {
    const tenant = (await createTenant()).json();
    for (const domain of ['malmo.ubm.se', 'x.utbetalningsmyndigheten.se', 'kommun.gov.se']) {
      const response = await app.inject({
        method: 'POST',
        url: `/tenants/${tenant.id}/domains`,
        payload: { domain, environment: 'prod' },
      });
      expect(response.statusCode, domain).toBe(400);
      expect(response.json().error).toBe('forbidden_domain');
    }
  });
});

describe('environments', () => {
  it('rejects secret key references', async () => {
    const tenant = (await createTenant()).json();
    const response = await app.inject({
      method: 'PUT',
      url: `/tenants/${tenant.id}/environments`,
      payload: {
        environment: 'prod',
        dataPlaneUrl: 'https://malmo-prod.supabase.co',
        publishableKeyReference: 'service_role_key_ref',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('secret_reference_rejected');
  });

  it('stores publishable key references', async () => {
    const tenant = (await createTenant()).json();
    const response = await app.inject({
      method: 'PUT',
      url: `/tenants/${tenant.id}/environments`,
      payload: {
        environment: 'prod',
        dataPlaneUrl: 'https://malmo-prod.supabase.co',
        publishableKeyReference: 'vault://malmo/prod/publishable',
      },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('provisioning', () => {
  it('starts a 20-step run with the first three steps completed', async () => {
    const tenant = (await createTenant()).json();
    const response = await app.inject({
      method: 'POST',
      url: `/tenants/${tenant.id}/provisioning-runs`,
      payload: {
        targetEnvironments: ['test', 'stage', 'prod'],
        modules: ['ubm_readiness', 'lss', 'payment_control'],
      },
    });
    expect(response.statusCode).toBe(201);
    const run = response.json();
    expect(run.steps).toHaveLength(20);
    expect(run.steps[0].status).toBe('succeeded');
    expect(run.steps[2].status).toBe('succeeded');
    expect(run.steps[3].status).toBe('pending');
  });

  it('refuses prod provisioning for shared demo deployment mode', async () => {
    const tenant = (await createTenant({ deploymentMode: 'local_demo_shared' })).json();
    const response = await app.inject({
      method: 'POST',
      url: `/tenants/${tenant.id}/provisioning-runs`,
      payload: { targetEnvironments: ['prod'], modules: ['ubm_readiness'] },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toContain('cannot be provisioned to prod');
  });

  it('enforces step ordering', async () => {
    const tenant = (await createTenant()).json();
    const run = (
      await app.inject({
        method: 'POST',
        url: `/tenants/${tenant.id}/provisioning-runs`,
        payload: { targetEnvironments: ['test'], modules: ['lss'] },
      })
    ).json();
    const response = await app.inject({
      method: 'POST',
      url: `/tenants/${tenant.id}/provisioning-runs/${run.id}/steps/run_rls_tests/complete`,
      payload: { ok: true },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('Cannot complete step');
  });

  it('completes a full run in order', async () => {
    const tenant = (await createTenant()).json();
    const run = (
      await app.inject({
        method: 'POST',
        url: `/tenants/${tenant.id}/provisioning-runs`,
        payload: { targetEnvironments: ['test'], modules: ['lss'] },
      })
    ).json();
    let latest = run;
    for (const step of run.steps.slice(3)) {
      const response = await app.inject({
        method: 'POST',
        url: `/tenants/${tenant.id}/provisioning-runs/${run.id}/steps/${step.id}/complete`,
        payload: { ok: true },
      });
      latest = response.json();
    }
    expect(latest.status).toBe('succeeded');
  });
});
