import { describe, expect, it } from 'vitest';
import type { SafeTenantConfig } from '@ubm-klar/shared-types';
import {
  createBrowserConnection,
  createServiceConnection,
  MissingServiceKeyError,
  ServiceKeyInBrowserError,
  serviceKeyEnvVarName,
} from './client-factory';

const config: SafeTenantConfig = {
  tenantId: 'tenant-malmo',
  tenantSlug: 'malmo',
  municipalityName: 'Malmö stad',
  deploymentMode: 'model_b_vendor_hosted_isolated',
  environment: 'prod',
  activeModules: ['lss'],
  dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
  dataPlanePublishableKey: 'sb_publishable_abc',
  authProvider: 'entra_id',
  featureFlags: {},
};

describe('browser connections', () => {
  it('exposes only the publishable key', () => {
    const conn = createBrowserConnection(config);
    expect(conn.kind).toBe('browser');
    expect(conn.publishableKey).toBe('sb_publishable_abc');
    expect(JSON.stringify(conn)).not.toContain('service');
  });
});

describe('service connections', () => {
  it('derives a per-tenant per-environment env var name', () => {
    expect(serviceKeyEnvVarName('malmo', 'prod')).toBe('DATA_PLANE_SERVICE_KEY__MALMO__PROD');
    expect(serviceKeyEnvVarName('malmo', 'stage')).toBe('DATA_PLANE_SERVICE_KEY__MALMO__STAGE');
  });

  it('reads the service key from server env', () => {
    const conn = createServiceConnection({
      config,
      env: { DATA_PLANE_SERVICE_KEY__MALMO__PROD: 'sb_secret_service' },
      globalObject: {},
    });
    expect(conn.serviceKey).toBe('sb_secret_service');
  });

  it('throws in browser contexts', () => {
    expect(() =>
      createServiceConnection({
        config,
        env: { DATA_PLANE_SERVICE_KEY__MALMO__PROD: 'x' },
        globalObject: { window: {}, document: {} },
      }),
    ).toThrow(ServiceKeyInBrowserError);
  });

  it('throws when the tenant service key is missing', () => {
    expect(() => createServiceConnection({ config, env: {}, globalObject: {} })).toThrow(
      MissingServiceKeyError,
    );
  });

  it('never falls back to another tenant service key', () => {
    expect(() =>
      createServiceConnection({
        config,
        env: { DATA_PLANE_SERVICE_KEY__HELSINGBORG__PROD: 'other-tenant-key' },
        globalObject: {},
      }),
    ).toThrow(MissingServiceKeyError);
  });
});
