import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import { cleanEligibilityInput } from '@ubm-klar/ubm-eligibility-engine';
import { buildApiServer } from './server';

const malmoRecord: TenantDirectoryRecord = {
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
    'ubm_readiness',
    'payment_control',
    'control_cases',
  ],
  dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
  dataPlanePublishableKey: 'sb_publishable_malmo',
  authProvider: 'entra_id',
  featureFlags: {},
};

const directory: TenantDirectory = {
  lookupByDomain: async (domain) => (domain === 'malmo.ubmklar.se' ? malmoRecord : undefined),
};

let app: FastifyInstance;

beforeEach(() => {
  app = buildApiServer({ directory, allowDemoTenant: true });
});

const caseworkerHeaders = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'user-1',
  'x-roles': 'lss_case_worker',
  'x-departments': 'dep-lss',
  'x-assigned-cases': 'case-1',
};

describe('tenant resolution', () => {
  it('fails closed for unknown domains', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tenant',
      headers: { host: 'okand.ubmklar.se' },
    });
    expect(response.statusCode).toBe(421);
  });

  it('rejects authority-implying domains', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tenant',
      headers: { host: 'malmo.ubm.se' },
    });
    expect(response.statusCode).toBe(421);
  });

  it('resolves known tenants and never exposes service keys', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tenant',
      headers: { host: 'malmo.ubmklar.se' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(response.json().municipality).toBe('Malmö stad');
    expect(body).not.toContain('service_role');
    expect(body).not.toContain('sb_secret');
  });

  it('serves the demo tenant on localhost when enabled', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tenant',
      headers: { host: 'localhost:3001' },
    });
    expect(response.json().municipality).toBe('Demokommun');
  });
});

describe('authorization', () => {
  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { host: 'malmo.ubmklar.se' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('denies roles without the permission, with explanation', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { ...caseworkerHeaders, 'x-roles': 'billing_admin_no_pii' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().reasons).toBeDefined();
  });

  it('serves the LSS dashboard to LSS case workers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: caseworkerHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().decidedHoursTotal).toBeGreaterThan(0);
  });

  it('serves the EA dashboard to EA case workers only', async () => {
    const denied = await app.inject({
      method: 'GET',
      url: '/dashboards/economic-assistance',
      headers: caseworkerHeaders,
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'GET',
      url: '/dashboards/economic-assistance',
      headers: { ...caseworkerHeaders, 'x-roles': 'economic_assistance_case_worker' },
    });
    expect(allowed.statusCode).toBe(200);
  });
});

describe('UBM eligibility endpoint', () => {
  it('evaluates eligibility for export managers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ubm/eligibility',
      headers: { ...caseworkerHeaders, 'x-roles': 'ubm_export_manager' },
      payload: cleanEligibilityInput(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe('send_allowed');
  });

  it('denies case workers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ubm/eligibility',
      headers: caseworkerHeaders,
      payload: cleanEligibilityInput(),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('sensitive field reveal', () => {
  it('requires a reason', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/persons/reveal-field',
      headers: caseworkerHeaders,
      payload: {
        entityKind: 'person',
        entityId: 'p1',
        fieldKey: 'personal_identity_number',
        dataClass: 'income_data',
      },
    });
    expect([403, 422]).toContain(response.statusCode);
  });

  it('reveals with reason and logs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/persons/reveal-field',
      headers: caseworkerHeaders,
      payload: {
        entityKind: 'person',
        entityId: 'p1',
        fieldKey: 'income',
        dataClass: 'income_data',
        reason: 'Kontroll av inkomstuppgift i tilldelat ärende case-1',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ revealed: true, logged: true });
  });
});

describe('support without PII', () => {
  const supportHeaders = {
    host: 'malmo.ubmklar.se',
    'x-user-id': 'support-1',
    'x-roles': 'support_technician_no_pii',
  };

  it('serves technical status to support technicians', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/support/technical-status',
      headers: supportHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().context.release).toBe('1.0.0');
  });

  it('rejects unapproved JIT sessions', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/support/jit-sessions',
      headers: supportHeaders,
      payload: {
        supportCaseReference: 'SUP-1',
        scope: 'import_status',
        reason: 'Felsökning av import enligt ärende SUP-1',
        requestedDurationMs: 3600000,
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it('creates approved JIT sessions', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/support/jit-sessions',
      headers: supportHeaders,
      payload: {
        supportCaseReference: 'SUP-1',
        approvedByMunicipalityUser: 'kommun-admin-1',
        scope: 'import_status',
        reason: 'Felsökning av import enligt ärende SUP-1',
        requestedDurationMs: 3600000,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().piiAccess).toBe(false);
  });
});

describe('break-glass', () => {
  it('requires the break-glass role', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/break-glass/sessions',
      headers: caseworkerHeaders,
      payload: {
        reason: 'Incident 42: återställning av felaktig ärendestatus i produktion',
        requestedDurationMs: 3600000,
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it('creates sessions for break-glass admins with substantive reason', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/break-glass/sessions',
      headers: { ...caseworkerHeaders, 'x-roles': 'break_glass_admin' },
      payload: {
        reason: 'Incident 42: återställning av felaktig ärendestatus i produktion',
        incidentReference: 'INC-42',
        requestedDurationMs: 3600000,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().postReviewStatus).toBe('pending');
  });
});
