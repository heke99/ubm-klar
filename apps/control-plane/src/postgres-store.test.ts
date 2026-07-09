import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrationsFromDir, createDbClient, type DbClient } from '@ubm-klar/db';
import { PostgresControlPlaneStore } from './postgres-store';
import { PiiLeakError } from '@ubm-klar/config';

/**
 * Repository-level tests against a real Postgres database.
 * Set CONTROL_PLANE_TEST_DATABASE_URL to run (CI database job and local dev).
 */
const databaseUrl = process.env.CONTROL_PLANE_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgresControlPlaneStore', () => {
  let db: DbClient;
  let store: PostgresControlPlaneStore;

  beforeAll(async () => {
    db = createDbClient({ connectionString: databaseUrl!, applicationName: 'cp-store-test' });
    await db.query('drop schema public cascade; create schema public;');
    const migrationsDir = new URL('../migrations', import.meta.url).pathname;
    await applyMigrationsFromDir(db, migrationsDir, 'control_plane_schema_migrations');
    store = new PostgresControlPlaneStore(db);
  });

  afterAll(async () => {
    await db?.end();
  });

  it('creates and reads back a tenant (persists across store instances)', async () => {
    const tenant = await store.createTenant({
      slug: 'goteborg',
      municipalityName: 'Göteborgs stad',
      organizationNumber: '212000-1355',
      deploymentMode: 'model_b_vendor_hosted_isolated',
      status: 'onboarding',
    });
    expect(tenant.id).toBeTruthy();

    const secondInstance = new PostgresControlPlaneStore(db);
    const fetched = await secondInstance.getTenantBySlug('goteborg');
    expect(fetched?.municipalityName).toBe('Göteborgs stad');
    expect(fetched?.status).toBe('onboarding');
  });

  it('adds verified and unverified domains', async () => {
    const tenant = (await store.getTenantBySlug('goteborg'))!;
    const domain = await store.addDomain({
      tenantId: tenant.id,
      domain: 'goteborg.ubmklar.se',
      environment: 'prod',
      domainModel: 'model_b_subdomain',
      verified: false,
    });
    expect(domain.verified).toBe(false);

    const verified = await store.verifyDomain(domain.id);
    expect(verified.verified).toBe(true);

    const found = await store.findDomain('GOTEBORG.UBMKLAR.SE');
    expect(found?.verified).toBe(true);
  });

  it('enables modules idempotently', async () => {
    const tenant = (await store.getTenantBySlug('goteborg'))!;
    await store.setModule({ tenantId: tenant.id, moduleId: 'lss', enabled: true });
    await store.setModule({ tenantId: tenant.id, moduleId: 'lss', enabled: true });
    await store.setModule({ tenantId: tenant.id, moduleId: 'payment_control', enabled: false });
    const modules = await store.listModules(tenant.id);
    expect(modules.find((m) => m.moduleId === 'lss')?.enabled).toBe(true);
    expect(modules.find((m) => m.moduleId === 'payment_control')?.enabled).toBe(false);
  });

  it('sets readiness gates with upsert semantics', async () => {
    const tenant = (await store.getTenantBySlug('goteborg'))!;
    await store.setReadinessGate({
      tenantId: tenant.id,
      gateId: 'rls_tests',
      gateName: 'RLS-tester',
      required: true,
      status: 'in_progress',
    });
    await store.setReadinessGate({
      tenantId: tenant.id,
      gateId: 'rls_tests',
      gateName: 'RLS-tester',
      required: true,
      status: 'passed',
      evidenceReference: 'run:2026-07-09',
    });
    const gates = await store.listReadinessGates(tenant.id);
    const gate = gates.find((g) => g.gateId === 'rls_tests');
    expect(gate?.status).toBe('passed');
    expect(gate?.evidenceReference).toBe('run:2026-07-09');
  });

  it('creates no-PII support cases and rejects PII payloads', async () => {
    const tenant = (await store.getTenantBySlug('goteborg'))!;
    const supportCase = await store.createSupportCase({
      tenantId: tenant.id,
      title: 'Import fastnar',
      category: 'import',
      severity: 'high',
      status: 'open',
      descriptionNoPii: 'batch 42 fastnar i valideringssteget, felkod E_TIMEOUT',
    });
    expect(supportCase.id).toBeTruthy();

    await expect(
      store.createSupportCase({
        tenantId: tenant.id,
        title: 'Person 19811218-9876 saknas',
        category: 'technical',
        severity: 'low',
        status: 'open',
        descriptionNoPii: 'contains a personnummer in the title',
      }),
    ).rejects.toThrow(PiiLeakError);
  });

  it('stores environments with key references only', async () => {
    const tenant = (await store.getTenantBySlug('goteborg'))!;
    const env = await store.upsertEnvironment({
      tenantId: tenant.id,
      environment: 'prod',
      dataPlaneUrl: 'https://goteborg-prod.supabase.co',
      publishableKeyReference: 'vault://goteborg/prod/publishable',
      status: 'ready',
    });
    expect(env.publishableKeyReference).toBe('vault://goteborg/prod/publishable');
    const listed = await store.listEnvironments(tenant.id);
    expect(listed).toHaveLength(1);
  });

  it('persists provisioning runs with steps', async () => {
    const tenant = (await store.getTenantBySlug('goteborg'))!;
    await store.saveProvisioningRun({
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: tenant.id,
      targetEnvironments: ['test', 'prod'],
      modules: ['lss'],
      status: 'running',
      startedAt: new Date().toISOString(),
      steps: [
        { id: 'create_tenant', name: 'Create tenant in control plane', status: 'succeeded' },
        { id: 'choose_deployment_mode', name: 'Choose deployment mode', status: 'pending' },
      ],
    });
    const run = await store.getProvisioningRun('00000000-0000-4000-8000-000000000001');
    expect(run?.steps).toHaveLength(2);
    expect(run?.steps[0]?.status).toBe('succeeded');
  });
});
