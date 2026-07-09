import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ControlPlaneTenantDirectory,
  publishableKeyEnvVarName,
  TenantDirectoryUnavailableError,
} from './control-plane-directory';
import {
  TenantResolver,
  UnknownTenantDomainError,
  UnverifiedTenantDomainError,
  TenantConfigLeakError,
} from './resolver';

/**
 * Stub control plane: serves /directory/domains/:domain like the real server,
 * including 404 for unknown/unverified domains and bearer-token auth.
 */
let server: Server;
let baseUrl: string;
let requestCount = 0;

const RECORDS: Record<string, object> = {
  'pilot.ubmklar.se': {
    tenantId: 'tenant-1',
    tenantSlug: 'pilotkommun',
    municipalityName: 'Pilotkommun',
    deploymentMode: 'model_b_vendor_hosted_isolated',
    tenantStatus: 'pilot',
    domain: 'pilot.ubmklar.se',
    environment: 'prod',
    verified: true,
    dataPlaneUrl: 'https://pilot-prod.supabase.co',
    publishableKeyReference: 'vault://pilotkommun/prod/publishable',
    activeModules: ['lss', 'ubm_readiness'],
    authProvider: 'entra_id',
    featureFlags: { pilot_mode: true },
  },
  'wrong.ubmklar.se': {
    tenantId: 'tenant-2',
    tenantSlug: 'annan',
    municipalityName: 'Annan kommun',
    deploymentMode: 'model_b_vendor_hosted_isolated',
    tenantStatus: 'live',
    // Directory bug simulation: record for a different domain.
    domain: 'other.ubmklar.se',
    environment: 'prod',
    verified: true,
    dataPlaneUrl: 'https://annan-prod.supabase.co',
    publishableKeyReference: '',
    activeModules: [],
    authProvider: 'entra_id',
    featureFlags: {},
  },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    requestCount++;
    if ((req.headers.authorization ?? '') !== 'Bearer dir-token') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const match = req.url?.match(/^\/directory\/domains\/(.+)$/);
    const domain = match ? decodeURIComponent(match[1]!) : '';
    const record = RECORDS[domain];
    if (!record) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'domain_not_found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(record));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
});

function makeDirectory(env: Record<string, string | undefined> = {}) {
  return new ControlPlaneTenantDirectory({ baseUrl, directoryToken: 'dir-token', env });
}

describe('ControlPlaneTenantDirectory', () => {
  it('resolves a verified domain to a safe tenant config', async () => {
    const env = {
      [publishableKeyEnvVarName('pilotkommun', 'prod')]: 'sb_publishable_pilot',
    };
    const resolver = new TenantResolver({ directory: makeDirectory(env) });
    const config = await resolver.resolve('pilot.ubmklar.se');
    expect(config.tenantSlug).toBe('pilotkommun');
    expect(config.tenantStatus).toBe('pilot');
    expect(config.dataPlanePublishableKey).toBe('sb_publishable_pilot');
    expect(config.featureFlags['pilot_mode']).toBe(true);
  });

  it('unknown domains fail closed', async () => {
    const resolver = new TenantResolver({ directory: makeDirectory() });
    await expect(resolver.resolve('okand.ubmklar.se')).rejects.toThrow(UnknownTenantDomainError);
  });

  it('unverified domains fail closed (control plane answers 404)', async () => {
    // The stub only returns verified records; the real control plane returns 404
    // for unverified domains, which surfaces as UnknownTenantDomainError here.
    const resolver = new TenantResolver({ directory: makeDirectory() });
    await expect(resolver.resolve('overifierad.ubmklar.se')).rejects.toThrow(
      UnknownTenantDomainError,
    );
  });

  it('a record with domainVerified=false is rejected by the resolver', async () => {
    const directory = {
      lookupByDomain: async () => ({
        ...(RECORDS['pilot.ubmklar.se'] as Record<string, never>),
        domainVerified: false,
        dataPlanePublishableKey: '',
      }),
    };
    // @ts-expect-error minimal stub record
    const resolver = new TenantResolver({ directory });
    await expect(resolver.resolve('pilot.ubmklar.se')).rejects.toThrow(UnverifiedTenantDomainError);
  });

  it('rejects a directory response for the wrong domain', async () => {
    const resolver = new TenantResolver({ directory: makeDirectory() });
    await expect(resolver.resolve('wrong.ubmklar.se')).rejects.toThrow(TenantConfigLeakError);
  });

  it('rejects service-role-looking publishable keys', async () => {
    const env = {
      [publishableKeyEnvVarName('pilotkommun', 'prod')]: 'sb_secret_leaked_service_key',
    };
    const resolver = new TenantResolver({ directory: makeDirectory(env) });
    await expect(resolver.resolve('pilot.ubmklar.se')).rejects.toThrow(TenantConfigLeakError);
  });

  it('caches positive lookups but never failures', async () => {
    const env = { [publishableKeyEnvVarName('pilotkommun', 'prod')]: 'sb_publishable_pilot' };
    const resolver = new TenantResolver({ directory: makeDirectory(env), cacheTtlMs: 60_000 });

    const before = requestCount;
    await resolver.resolve('pilot.ubmklar.se');
    await resolver.resolve('pilot.ubmklar.se');
    expect(requestCount - before).toBe(1); // second hit served from cache

    const failBefore = requestCount;
    await expect(resolver.resolve('okand.ubmklar.se')).rejects.toThrow(UnknownTenantDomainError);
    await expect(resolver.resolve('okand.ubmklar.se')).rejects.toThrow(UnknownTenantDomainError);
    expect(requestCount - failBefore).toBe(2); // failures re-checked every time
  });

  it('throws when the control plane is unreachable (no fallback tenant)', async () => {
    const directory = new ControlPlaneTenantDirectory({
      baseUrl: 'http://127.0.0.1:1',
      directoryToken: 'dir-token',
    });
    await expect(directory.lookupByDomain('pilot.ubmklar.se')).rejects.toThrow(
      TenantDirectoryUnavailableError,
    );
  });
});
