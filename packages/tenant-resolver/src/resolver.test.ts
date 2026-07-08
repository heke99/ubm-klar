import { describe, expect, it, vi } from 'vitest';
import {
  ForbiddenTenantDomainError,
  TenantConfigLeakError,
  TenantResolver,
  UnknownTenantDomainError,
  UnverifiedTenantDomainError,
  type TenantDirectory,
  type TenantDirectoryRecord,
} from './resolver';

function record(overrides: Partial<TenantDirectoryRecord> = {}): TenantDirectoryRecord {
  return {
    tenantId: 'tenant-malmo',
    tenantSlug: 'malmo',
    municipalityName: 'Malmö stad',
    deploymentMode: 'model_b_vendor_hosted_isolated',
    environment: 'prod',
    domain: 'malmo.ubmklar.se',
    domainVerified: true,
    activeModules: ['ubm_readiness', 'lss'],
    dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
    dataPlanePublishableKey: 'sb_publishable_abc123',
    authProvider: 'entra_id',
    featureFlags: { ubm_recurring_reporting_2029: false },
    ...overrides,
  };
}

function directoryWith(records: TenantDirectoryRecord[]): TenantDirectory {
  return {
    lookupByDomain: async (domain) => records.find((r) => r.domain === domain),
  };
}

describe('TenantResolver', () => {
  it('resolves a known verified Model B domain', async () => {
    const resolver = new TenantResolver({ directory: directoryWith([record()]) });
    const config = await resolver.resolve('malmo.ubmklar.se');
    expect(config.tenantId).toBe('tenant-malmo');
    expect(config.environment).toBe('prod');
    expect(config.activeModules).toContain('lss');
  });

  it('resolves Model C municipality domains', async () => {
    const resolver = new TenantResolver({
      directory: directoryWith([
        record({ domain: 'ubm-klar.malmo.se', deploymentMode: 'model_c2_self_hosted_supabase' }),
      ]),
    });
    const config = await resolver.resolve('ubm-klar.malmo.se');
    expect(config.deploymentMode).toBe('model_c2_self_hosted_supabase');
  });

  it('fails closed on unknown domains', async () => {
    const resolver = new TenantResolver({ directory: directoryWith([record()]) });
    await expect(resolver.resolve('unknown.ubmklar.se')).rejects.toThrow(UnknownTenantDomainError);
  });

  it('rejects authority-implying domains even when the directory knows them', async () => {
    const resolver = new TenantResolver({
      directory: directoryWith([record({ domain: 'malmo.ubm.se' })]),
    });
    await expect(resolver.resolve('malmo.ubm.se')).rejects.toThrow(ForbiddenTenantDomainError);
  });

  it('rejects unverified domains (spoofing protection)', async () => {
    const resolver = new TenantResolver({
      directory: directoryWith([record({ domainVerified: false })]),
    });
    await expect(resolver.resolve('malmo.ubmklar.se')).rejects.toThrow(
      UnverifiedTenantDomainError,
    );
  });

  it('normalizes case, ports and trailing dots', async () => {
    const resolver = new TenantResolver({ directory: directoryWith([record()]) });
    const config = await resolver.resolve('MALMO.ubmklar.se.:443');
    expect(config.tenantSlug).toBe('malmo');
  });

  it('never leaks another tenant config (directory mismatch fails closed)', async () => {
    const evilDirectory: TenantDirectory = {
      lookupByDomain: async () => record({ domain: 'helsingborg.ubmklar.se' }),
    };
    const resolver = new TenantResolver({ directory: evilDirectory });
    await expect(resolver.resolve('malmo.ubmklar.se')).rejects.toThrow(TenantConfigLeakError);
  });

  it('keeps tenants separate when both exist', async () => {
    const resolver = new TenantResolver({
      directory: directoryWith([
        record(),
        record({
          tenantId: 'tenant-helsingborg',
          tenantSlug: 'helsingborg',
          domain: 'helsingborg.ubmklar.se',
          dataPlaneUrl: 'https://helsingborg-prod.example.supabase.co',
        }),
      ]),
    });
    const malmo = await resolver.resolve('malmo.ubmklar.se');
    const helsingborg = await resolver.resolve('helsingborg.ubmklar.se');
    expect(malmo.tenantId).not.toBe(helsingborg.tenantId);
    expect(malmo.dataPlaneUrl).not.toBe(helsingborg.dataPlaneUrl);
  });

  it('refuses configs where the publishable key looks like a service-role secret', async () => {
    const resolver = new TenantResolver({
      directory: directoryWith([record({ dataPlanePublishableKey: 'sb_secret_service_role_x' })]),
    });
    await expect(resolver.resolve('malmo.ubmklar.se')).rejects.toThrow(TenantConfigLeakError);
  });

  it('returns frozen configs so callers cannot mutate shared state', async () => {
    const resolver = new TenantResolver({ directory: directoryWith([record()]) });
    const config = await resolver.resolve('malmo.ubmklar.se');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('caches positive results within TTL', async () => {
    const lookup = vi.fn(async () => record());
    const resolver = new TenantResolver({
      directory: { lookupByDomain: lookup },
      cacheTtlMs: 60_000,
    });
    await resolver.resolve('malmo.ubmklar.se');
    await resolver.resolve('malmo.ubmklar.se');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    const lookup = vi.fn(async () => undefined);
    const resolver = new TenantResolver({ directory: { lookupByDomain: lookup } });
    await expect(resolver.resolve('missing.ubmklar.se')).rejects.toThrow();
    await expect(resolver.resolve('missing.ubmklar.se')).rejects.toThrow();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('expires cache after TTL', async () => {
    let clock = 0;
    const lookup = vi.fn(async () => record());
    const resolver = new TenantResolver({
      directory: { lookupByDomain: lookup },
      cacheTtlMs: 1000,
      now: () => clock,
    });
    await resolver.resolve('malmo.ubmklar.se');
    clock = 2000;
    await resolver.resolve('malmo.ubmklar.se');
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
