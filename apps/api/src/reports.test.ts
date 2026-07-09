import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { xlsxToCsv } from '@ubm-klar/import-engine';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';
import { TenantDataPlanePool } from './data-plane';

/** Reports over real data with permission gating and CSV/XLSX/JSON export. */
const databaseUrl = process.env.DATA_PLANE_TEST_DATABASE_URL;

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

const controller = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'report-user',
  'x-roles': 'controller',
};
const admin = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'report-admin',
  'x-roles': 'municipality_admin',
};

describe.skipIf(!databaseUrl)('reports', () => {
  let app: FastifyInstance;

  beforeAll(() => {
    app = buildApiServer({
      directory,
      allowDemoTenant: false,
      auth: { allowInsecureHeaderAuth: true },
      dataPlane: new TenantDataPlanePool({ DATA_PLANE_DATABASE_URL: databaseUrl! }),
      demoDataEnabled: false,
    });
  });

  it('lists the report catalog (14 reports)', async () => {
    const response = await app.inject({ method: 'GET', url: '/reports', headers: controller });
    expect(response.statusCode).toBe(200);
    expect(response.json().reports.length).toBe(14);
  });

  it('runs a risk report over real data as JSON', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/reports/lss-risk',
      headers: controller,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().columns.length).toBeGreaterThan(0);
    // Payment control test seeded flags earlier — rows reflect real data.
    expect(Array.isArray(response.json().rows)).toBe(true);
  });

  it('exports CSV and XLSX', async () => {
    const csv = await app.inject({
      method: 'GET',
      url: '/reports/kontrollarenden?format=csv',
      headers: controller,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\n')[0]).toContain('Ärendenummer');

    const xlsx = await app.inject({
      method: 'GET',
      url: '/reports/go-live?format=xlsx',
      headers: admin,
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    // Round-trip: our own XLSX reader can parse the export.
    const parsed = xlsxToCsv(xlsx.rawPayload);
    expect(parsed).toContain('Pilot');
    expect(parsed).toContain('Produktion');
  });

  it('permission-gates each report (controller cannot read audit reports)', async () => {
    const denied = await app.inject({
      method: 'GET',
      url: '/reports/revisionsatkomst',
      headers: controller,
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'GET',
      url: '/reports/revisionsatkomst',
      headers: { ...controller, 'x-roles': 'internal_auditor' },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('unknown reports 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/reports/finns-inte',
      headers: controller,
    });
    expect(response.statusCode).toBe(404);
  });
});
