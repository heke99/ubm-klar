import { describe, expect, it } from 'vitest';
import {
  InvalidEnvModeError,
  loadAppConfig,
  resolveEnvMode,
  UnsafeProductionConfigError,
} from './app-config';

/** A complete, valid stage/prod environment for the API app. */
function validProdEnv(): Record<string, string> {
  return {
    APP_ENV: 'prod',
    APP_BASE_URL: 'https://kommun.ubmklar.se',
    API_BASE_URL: 'https://api.kommun.ubmklar.se',
    CONTROL_PLANE_URL: 'https://control.ubmklar.se',
    CONTROL_PLANE_DATABASE_URL: 'postgresql://cp',
    CONTROL_PLANE_ADMIN_TOKEN: 'ref-only',
    TENANT_RESOLVER_FAIL_CLOSED: 'true',
    AUTH_PROVIDER: 'entra_id',
    AUTH_ISSUER: 'https://login.microsoftonline.com/tenant/v2.0',
    AUTH_CLIENT_ID: 'client-id',
    SESSION_SECRET: 'session-secret-ref',
    DATA_PLANE_SERVICE_KEY_SOURCE: 'env',
    DOCUMENT_STORAGE_PROVIDER: 'supabase',
    MALWARE_SCANNER_PROVIDER: 'clamav',
    AUDIT_SINK: 'postgres',
    DATA_ACCESS_SINK: 'postgres',
    QUEUE_PROVIDER: 'postgres',
    WORKER_QUEUE_URL: 'postgresql://queue',
    RELEASE_SIGNING_PUBLIC_KEY: 'pem',
    BACKUP_PROVIDER: 'supabase-pitr',
  };
}

describe('resolveEnvMode', () => {
  it('maps APP_ENV values including aliases', () => {
    expect(resolveEnvMode({ APP_ENV: 'prod' })).toBe('prod');
    expect(resolveEnvMode({ APP_ENV: 'production' })).toBe('prod');
    expect(resolveEnvMode({ APP_ENV: 'staging' })).toBe('stage');
    expect(resolveEnvMode({ APP_ENV: 'demo' })).toBe('demo');
  });

  it('falls back to NODE_ENV and defaults to local', () => {
    expect(resolveEnvMode({ NODE_ENV: 'production' })).toBe('prod');
    expect(resolveEnvMode({ NODE_ENV: 'test' })).toBe('test');
    expect(resolveEnvMode({})).toBe('local');
  });

  it('rejects unknown APP_ENV values', () => {
    expect(() => resolveEnvMode({ APP_ENV: 'produktion' })).toThrow(InvalidEnvModeError);
  });
});

describe('loadAppConfig — local/demo/test stay easy', () => {
  it('loads with an empty environment in local mode', () => {
    const config = loadAppConfig('api', {});
    expect(config.mode).toBe('local');
    expect(config.isProductionLike).toBe(false);
    expect(config.audit.sink).toBe('in-memory');
    expect(config.demo.demoDataEnabled).toBe(true);
    expect(config.tenantResolver.allowDemoTenant).toBe(true);
  });

  it('test mode disables demo data by default but allows in-memory providers', () => {
    const config = loadAppConfig('api', { APP_ENV: 'test' });
    expect(config.demo.demoDataEnabled).toBe(false);
    expect(config.audit.sink).toBe('in-memory');
  });

  it('rejects structurally invalid provider values in every mode', () => {
    expect(() => loadAppConfig('api', { MALWARE_SCANNER_PROVIDER: 'nope' })).toThrow(
      UnsafeProductionConfigError,
    );
  });

  it('official UBM transport cannot be enabled in any mode', () => {
    expect(() => loadAppConfig('api', { UBM_OFFICIAL_TRANSPORT: 'enabled' })).toThrow(
      /official specification/i,
    );
    expect(() =>
      loadAppConfig('api', { ...validProdEnv(), UBM_OFFICIAL_TRANSPORT: 'enabled' }),
    ).toThrow(/official specification/i);
  });
});

describe('loadAppConfig — stage/prod fail closed', () => {
  it('accepts a complete production environment', () => {
    const config = loadAppConfig('api', validProdEnv());
    expect(config.mode).toBe('prod');
    expect(config.isProductionLike).toBe(true);
    expect(config.audit.sink).toBe('postgres');
    expect(config.release.requireSigned).toBe(true);
    expect(config.demo.demoDataEnabled).toBe(false);
  });

  it('fails with an empty environment in prod', () => {
    expect(() => loadAppConfig('api', { APP_ENV: 'prod' })).toThrow(UnsafeProductionConfigError);
  });

  it('reports every missing requirement', () => {
    try {
      loadAppConfig('api', { APP_ENV: 'prod' });
      expect.unreachable();
    } catch (error) {
      const e = error as UnsafeProductionConfigError;
      expect(e.violations.join('\n')).toContain('APP_BASE_URL');
      expect(e.violations.join('\n')).toContain('CONTROL_PLANE_DATABASE_URL or CONTROL_PLANE_URL');
      expect(e.violations.join('\n')).toContain('RELEASE_SIGNING_PUBLIC_KEY');
      expect(e.violations.join('\n')).toContain('BACKUP_PROVIDER');
    }
  });

  it('rejects demo data providers in prod', () => {
    expect(() => loadAppConfig('api', { ...validProdEnv(), DEMO_DATA_ENABLED: 'true' })).toThrow(
      /DEMO_DATA_ENABLED/,
    );
  });

  it('rejects the demo tenant in prod', () => {
    expect(() => loadAppConfig('api', { ...validProdEnv(), ALLOW_DEMO_TENANT: 'true' })).toThrow(
      /ALLOW_DEMO_TENANT/,
    );
  });

  it('rejects local_demo_shared deployment in prod', () => {
    expect(() =>
      loadAppConfig('api', { ...validProdEnv(), DEPLOYMENT_MODE: 'local_demo_shared' }),
    ).toThrow(/local_demo_shared/);
  });

  it('rejects in-memory audit and data access sinks in prod', () => {
    expect(() => loadAppConfig('api', { ...validProdEnv(), AUDIT_SINK: 'in-memory' })).toThrow(
      /AUDIT_SINK/,
    );
    expect(() =>
      loadAppConfig('api', { ...validProdEnv(), DATA_ACCESS_SINK: 'in-memory' }),
    ).toThrow(/DATA_ACCESS_SINK/);
  });

  it('rejects the disabled-local malware scanner in prod', () => {
    expect(() =>
      loadAppConfig('api', { ...validProdEnv(), MALWARE_SCANNER_PROVIDER: 'disabled-local' }),
    ).toThrow(/disabled-local/);
  });

  it('rejects local document storage in prod', () => {
    expect(() =>
      loadAppConfig('api', { ...validProdEnv(), DOCUMENT_STORAGE_PROVIDER: 'local' }),
    ).toThrow(/DOCUMENT_STORAGE_PROVIDER=local/);
  });

  it('rejects supabase_auth as primary auth in prod', () => {
    expect(() =>
      loadAppConfig('api', { ...validProdEnv(), AUTH_PROVIDER: 'supabase_auth' }),
    ).toThrow(/supabase_auth/);
  });

  it('rejects header-proxy auth without trusted proxy and secret', () => {
    expect(() =>
      loadAppConfig('api', { ...validProdEnv(), AUTH_PROVIDER: 'header-proxy' }),
    ).toThrow(/INTERNAL_AUTH_PROXY/);

    const withProxy = {
      ...validProdEnv(),
      AUTH_PROVIDER: 'header-proxy',
      INTERNAL_AUTH_PROXY_TRUSTED: 'true',
      INTERNAL_AUTH_PROXY_SECRET: 'shared-secret-ref',
    };
    const config = loadAppConfig('api', withProxy);
    expect(config.auth.provider).toBe('header-proxy');
    expect(config.auth.headerProxy.trusted).toBe(true);
  });

  it('requires OIDC issuer and client id for entra/oidc auth', () => {
    const env = validProdEnv();
    delete (env as Record<string, string | undefined>).AUTH_ISSUER;
    expect(() => loadAppConfig('api', env)).toThrow(/AUTH_ISSUER/);
  });

  it('rejects a fail-open tenant resolver in prod', () => {
    expect(() =>
      loadAppConfig('api', { ...validProdEnv(), TENANT_RESOLVER_FAIL_CLOSED: 'false' }),
    ).toThrow(/TENANT_RESOLVER_FAIL_CLOSED/);
  });

  it('rejects an in-memory queue and missing queue URL in prod', () => {
    expect(() => loadAppConfig('api', { ...validProdEnv(), QUEUE_PROVIDER: 'in-memory' })).toThrow(
      /QUEUE_PROVIDER/,
    );
    const env = validProdEnv();
    delete (env as Record<string, string | undefined>).WORKER_QUEUE_URL;
    expect(() => loadAppConfig('worker', env)).toThrow(/WORKER_QUEUE_URL/);
  });

  it('worker refuses noop mode in prod', () => {
    expect(() => loadAppConfig('worker', { ...validProdEnv(), WORKER_MODE: 'noop' })).toThrow(
      /WORKER_MODE=noop/,
    );
  });

  it('control plane requires a database and admin token in prod', () => {
    const env = validProdEnv();
    delete (env as Record<string, string | undefined>).CONTROL_PLANE_DATABASE_URL;
    expect(() => loadAppConfig('control-plane', env)).toThrow(/CONTROL_PLANE_DATABASE_URL/);

    const env2 = validProdEnv();
    delete (env2 as Record<string, string | undefined>).CONTROL_PLANE_ADMIN_TOKEN;
    expect(() => loadAppConfig('control-plane', env2)).toThrow(/CONTROL_PLANE_ADMIN_TOKEN/);
  });

  it('rejects missing release signature config in prod', () => {
    const env = validProdEnv();
    delete (env as Record<string, string | undefined>).RELEASE_SIGNING_PUBLIC_KEY;
    expect(() => loadAppConfig('api', env)).toThrow(/RELEASE_SIGNING_PUBLIC_KEY/);
  });

  it('web requires a session secret in prod', () => {
    const env = validProdEnv();
    delete (env as Record<string, string | undefined>).SESSION_SECRET;
    expect(() => loadAppConfig('web', env)).toThrow(/SESSION_SECRET/);
  });

  it('stage applies the same rules as prod', () => {
    expect(() => loadAppConfig('api', { APP_ENV: 'stage' })).toThrow(UnsafeProductionConfigError);
    const config = loadAppConfig('api', { ...validProdEnv(), APP_ENV: 'stage' });
    expect(config.mode).toBe('stage');
    expect(config.isProductionLike).toBe(true);
  });
});
