/**
 * Typed application configuration with strict, fail-closed validation.
 *
 * Environment modes:
 *   local — developer machine, everything optional, unsafe providers allowed
 *   demo  — synthetic-data demo deployments, unsafe providers allowed but marked
 *   test  — CI/test runs, unsafe providers allowed
 *   stage — production-like; all production rules enforced
 *   prod  — production; all production rules enforced
 *
 * In stage/prod the loader refuses to produce a config (throws
 * UnsafeProductionConfigError) if any required setting is missing or any
 * forbidden provider is selected. Apps must call this at startup and exit on
 * error — never "fall back" to a demo/in-memory mode in production.
 */

export type EnvMode = 'local' | 'demo' | 'test' | 'stage' | 'prod';
export type AppName = 'api' | 'web' | 'control-plane' | 'worker';

export const PRODUCTION_LIKE_MODES: readonly EnvMode[] = ['stage', 'prod'] as const;

export type ControlPlaneStoreProvider = 'postgres' | 'in-memory';
export type AuditSinkProvider = 'postgres' | 'in-memory';
export type DataAccessSinkProvider = 'postgres' | 'in-memory';
export type TenantDirectoryProvider = 'control-plane' | 'empty';
export type AuthProviderId = 'entra_id' | 'oidc' | 'saml' | 'supabase_auth' | 'header-proxy';
export type DocumentStorageProvider = 'supabase' | 's3' | 'local';
export type MalwareScannerProvider = 'clamav' | 'external-api' | 'disabled-local';
export type QueueProvider = 'postgres' | 'redis' | 'in-memory';

/** Auth providers acceptable as the primary provider in stage/prod. */
export const PRODUCTION_AUTH_PROVIDERS: readonly AuthProviderId[] = ['entra_id', 'oidc', 'saml'];

export interface AppConfig {
  app: AppName;
  mode: EnvMode;
  /** true for stage and prod — every production rule applies. */
  isProductionLike: boolean;
  appBaseUrl: string | undefined;
  apiBaseUrl: string | undefined;
  controlPlane: {
    /** Postgres connection for the control plane service itself. */
    databaseUrl: string | undefined;
    /** HTTP base URL of the control plane (used by api/web/worker). */
    url: string | undefined;
    store: ControlPlaneStoreProvider;
    /** Reference name of the admin token env var — never the value. */
    adminTokenConfigured: boolean;
  };
  tenantResolver: {
    failClosed: boolean;
    cacheTtlSeconds: number;
    allowDemoTenant: boolean;
  };
  auth: {
    provider: AuthProviderId;
    issuer: string | undefined;
    audience: string | undefined;
    clientId: string | undefined;
    jwksUri: string | undefined;
    headerProxy: {
      trusted: boolean;
      /** Whether the shared internal header secret is configured (value never exposed). */
      secretConfigured: boolean;
    };
    /** Session cookie signing secret is configured (web only; value never exposed). */
    sessionSecretConfigured: boolean;
  };
  dataPlane: {
    /**
     * Service keys are read per tenant/environment from
     * DATA_PLANE_SERVICE_KEY__{TENANT}__{ENV} (see @ubm-klar/supabase-client).
     * In stage/prod at least the naming convention must be acknowledged via
     * DATA_PLANE_SERVICE_KEY_SOURCE=env.
     */
    serviceKeySource: 'env';
    /** Direct database URL for the tenant data plane (single-tenant deployments). */
    databaseUrl: string | undefined;
  };
  documents: {
    storageProvider: DocumentStorageProvider;
    malwareScannerProvider: MalwareScannerProvider;
    maxUploadBytes: number;
  };
  audit: { sink: AuditSinkProvider };
  dataAccess: { sink: DataAccessSinkProvider };
  queue: { provider: QueueProvider; url: string | undefined };
  release: {
    signingPublicKeyConfigured: boolean;
    /** stage/prod always require signed releases. */
    requireSigned: boolean;
  };
  backup: {
    provider: string | undefined;
    configured: boolean;
  };
  demo: {
    /** Demo data may only ever be true in local/demo/test. */
    demoDataEnabled: boolean;
  };
  worker: {
    /** 'queue' is the only production mode. 'noop' exists for local experiments only. */
    mode: 'queue' | 'noop';
  };
  ubm: {
    /**
     * Official UBM transport is not implemented. It stays false until real
     * specifications, credentials and security approval exist. Setting
     * UBM_OFFICIAL_TRANSPORT=enabled is a validation error in every mode.
     */
    officialTransportEnabled: false;
  };
}

export class UnsafeProductionConfigError extends Error {
  constructor(
    public readonly app: AppName,
    public readonly mode: EnvMode,
    public readonly violations: string[],
  ) {
    super(
      `production start refused for ${app} (${mode}): ${violations.length} configuration violation(s):\n` +
        violations.map((v) => `  - ${v}`).join('\n'),
    );
    this.name = 'UnsafeProductionConfigError';
  }
}

export class InvalidEnvModeError extends Error {
  constructor(public readonly value: string) {
    super(`Invalid APP_ENV "${value}". Use one of: local, demo, test, stage, prod.`);
    this.name = 'InvalidEnvModeError';
  }
}

const ENV_MODES: readonly EnvMode[] = ['local', 'demo', 'test', 'stage', 'prod'];

export type EnvSource = Record<string, string | undefined>;

/**
 * Resolves the environment mode. APP_ENV wins; NODE_ENV=production maps to prod,
 * NODE_ENV=test maps to test; everything else is local.
 */
export function resolveEnvMode(source: EnvSource = process.env): EnvMode {
  const raw = (source.APP_ENV ?? '').trim().toLowerCase();
  if (raw) {
    if (raw === 'production') return 'prod';
    if (raw === 'staging') return 'stage';
    if ((ENV_MODES as readonly string[]).includes(raw)) return raw as EnvMode;
    throw new InvalidEnvModeError(raw);
  }
  const nodeEnv = (source.NODE_ENV ?? '').trim().toLowerCase();
  if (nodeEnv === 'production') return 'prod';
  if (nodeEnv === 'test') return 'test';
  return 'local';
}

function bool(source: EnvSource, name: string, fallback: boolean): boolean {
  const raw = source[name];
  if (raw === undefined || raw === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function pick<T extends string>(
  source: EnvSource,
  name: string,
  allowed: readonly T[],
  fallback: T,
  violations: string[],
): T {
  const raw = (source[name] ?? '').trim();
  if (!raw) return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  violations.push(`${name}="${raw}" is not one of: ${allowed.join(', ')}`);
  return fallback;
}

/**
 * Loads and validates the configuration for one app. Throws
 * UnsafeProductionConfigError in stage/prod when anything required is missing
 * or an unsafe provider is selected. In local/demo/test the defaults keep
 * development easy while still rejecting structurally invalid values.
 */
export function loadAppConfig(app: AppName, source: EnvSource = process.env): AppConfig {
  const mode = resolveEnvMode(source);
  const isProductionLike = PRODUCTION_LIKE_MODES.includes(mode);
  const violations: string[] = [];

  // --- Providers with safe local defaults -----------------------------------
  const controlPlaneStore = pick<ControlPlaneStoreProvider>(
    source,
    'CONTROL_PLANE_STORE',
    ['postgres', 'in-memory'],
    source.CONTROL_PLANE_DATABASE_URL ? 'postgres' : 'in-memory',
    violations,
  );
  const auditSink = pick<AuditSinkProvider>(
    source,
    'AUDIT_SINK',
    ['postgres', 'in-memory'],
    isProductionLike ? 'postgres' : 'in-memory',
    violations,
  );
  const dataAccessSink = pick<DataAccessSinkProvider>(
    source,
    'DATA_ACCESS_SINK',
    ['postgres', 'in-memory'],
    isProductionLike ? 'postgres' : 'in-memory',
    violations,
  );
  const authProvider = pick<AuthProviderId>(
    source,
    'AUTH_PROVIDER',
    ['entra_id', 'oidc', 'saml', 'supabase_auth', 'header-proxy'],
    isProductionLike ? 'entra_id' : 'supabase_auth',
    violations,
  );
  const documentStorage = pick<DocumentStorageProvider>(
    source,
    'DOCUMENT_STORAGE_PROVIDER',
    ['supabase', 's3', 'local'],
    'local',
    violations,
  );
  const malwareScanner = pick<MalwareScannerProvider>(
    source,
    'MALWARE_SCANNER_PROVIDER',
    ['clamav', 'external-api', 'disabled-local'],
    'disabled-local',
    violations,
  );
  const queueProvider = pick<QueueProvider>(
    source,
    'QUEUE_PROVIDER',
    ['postgres', 'redis', 'in-memory'],
    source.WORKER_QUEUE_URL ? 'postgres' : 'in-memory',
    violations,
  );
  const workerMode = pick<'queue' | 'noop'>(
    source,
    'WORKER_MODE',
    ['queue', 'noop'],
    'queue',
    violations,
  );

  const demoDataEnabled = bool(source, 'DEMO_DATA_ENABLED', mode === 'local' || mode === 'demo');
  const allowDemoTenant = bool(source, 'ALLOW_DEMO_TENANT', !isProductionLike);
  const failClosed = bool(source, 'TENANT_RESOLVER_FAIL_CLOSED', true);
  const proxyTrusted = bool(source, 'INTERNAL_AUTH_PROXY_TRUSTED', false);
  const proxySecretConfigured = Boolean(source.INTERNAL_AUTH_PROXY_SECRET);
  const officialTransportRaw = (source.UBM_OFFICIAL_TRANSPORT ?? 'disabled').trim().toLowerCase();

  // --- Universal rules --------------------------------------------------------
  if (officialTransportRaw !== 'disabled' && officialTransportRaw !== '') {
    violations.push(
      'UBM_OFFICIAL_TRANSPORT must remain "disabled": no official specification, credentials ' +
        'or security approval exist. Manual export is the only transport.',
    );
  }

  // --- Production rules (stage/prod) ------------------------------------------
  if (isProductionLike) {
    const require = (name: string, why: string) => {
      if (!source[name]) violations.push(`${name} is required in stage/prod (${why})`);
    };

    require('APP_BASE_URL', 'canonical web origin');
    require('API_BASE_URL', 'canonical API origin');

    if (!source.CONTROL_PLANE_DATABASE_URL && !source.CONTROL_PLANE_URL) {
      violations.push(
        'CONTROL_PLANE_DATABASE_URL or CONTROL_PLANE_URL is required in stage/prod ' +
          '(tenant resolution and control plane persistence)',
      );
    }
    if (app === 'control-plane') {
      require('CONTROL_PLANE_DATABASE_URL', 'persistent control plane store');
      require('CONTROL_PLANE_ADMIN_TOKEN', 'admin API authentication');
      if (controlPlaneStore !== 'postgres') {
        violations.push('CONTROL_PLANE_STORE=in-memory is forbidden in stage/prod');
      }
    }
    if (app === 'api' || app === 'web') {
      require('CONTROL_PLANE_URL', 'tenant resolver directory');
    }

    if (!failClosed) {
      violations.push('TENANT_RESOLVER_FAIL_CLOSED=false is forbidden in stage/prod');
    }
    if (allowDemoTenant) {
      violations.push('ALLOW_DEMO_TENANT=true is forbidden in stage/prod');
    }
    if (demoDataEnabled) {
      violations.push('DEMO_DATA_ENABLED=true is forbidden in stage/prod (synthetic demo data)');
    }
    if ((source.DEPLOYMENT_MODE ?? '') === 'local_demo_shared') {
      violations.push('DEPLOYMENT_MODE=local_demo_shared is forbidden in stage/prod');
    }

    if (auditSink !== 'postgres') {
      violations.push('AUDIT_SINK must be postgres in stage/prod (in-memory audit is forbidden)');
    }
    if (dataAccessSink !== 'postgres') {
      violations.push(
        'DATA_ACCESS_SINK must be postgres in stage/prod (in-memory data access log is forbidden)',
      );
    }

    if (app === 'api' || app === 'web') {
      if (authProvider === 'supabase_auth') {
        violations.push(
          'AUTH_PROVIDER=supabase_auth is not allowed as primary auth in stage/prod ' +
            '(use entra_id/oidc/saml; supabase_auth is a local/demo/pilot fallback only)',
        );
      }
      if (authProvider === 'header-proxy') {
        if (!proxyTrusted) {
          violations.push(
            'AUTH_PROVIDER=header-proxy requires INTERNAL_AUTH_PROXY_TRUSTED=true behind a ' +
              'verified internal auth proxy',
          );
        }
        if (!proxySecretConfigured) {
          violations.push(
            'AUTH_PROVIDER=header-proxy requires INTERNAL_AUTH_PROXY_SECRET (shared internal header secret)',
          );
        }
      }
      if (PRODUCTION_AUTH_PROVIDERS.includes(authProvider)) {
        if (!source.AUTH_ISSUER)
          violations.push('AUTH_ISSUER is required for OIDC/Entra/SAML auth');
        if (!source.AUTH_CLIENT_ID) {
          violations.push('AUTH_CLIENT_ID is required for OIDC/Entra/SAML auth');
        }
      }
    }
    if (app === 'web' && !source.SESSION_SECRET) {
      violations.push('SESSION_SECRET is required in stage/prod (web session cookies)');
    }

    if (app === 'api' || app === 'worker') {
      if ((source.DATA_PLANE_SERVICE_KEY_SOURCE ?? '') !== 'env') {
        violations.push(
          'DATA_PLANE_SERVICE_KEY_SOURCE=env is required in stage/prod ' +
            '(per-tenant service keys via DATA_PLANE_SERVICE_KEY__{TENANT}__{ENV})',
        );
      }
    }

    if (app === 'api' || app === 'worker') {
      if (documentStorage === 'local') {
        violations.push(
          'DOCUMENT_STORAGE_PROVIDER=local is forbidden in stage/prod (use supabase or s3)',
        );
      }
      if (malwareScanner === 'disabled-local') {
        violations.push(
          'MALWARE_SCANNER_PROVIDER=disabled-local is forbidden in stage/prod ' +
            '(configure clamav or external-api)',
        );
      }
    }

    if (app === 'worker' || app === 'api') {
      if (queueProvider === 'in-memory') {
        violations.push('QUEUE_PROVIDER=in-memory is forbidden in stage/prod');
      }
      require('WORKER_QUEUE_URL', 'persistent job queue');
    }
    if (app === 'worker' && workerMode !== 'queue') {
      violations.push('WORKER_MODE=noop is forbidden in stage/prod (fake workers)');
    }

    require('RELEASE_SIGNING_PUBLIC_KEY', 'release signature verification');
    require('BACKUP_PROVIDER', 'backup configuration must be explicit');
  }

  // Structurally invalid values are rejected in every mode; the production
  // require/forbid rules above only accumulate in stage/prod.
  if (violations.length > 0) {
    throw new UnsafeProductionConfigError(app, mode, violations);
  }

  return {
    app,
    mode,
    isProductionLike,
    appBaseUrl: source.APP_BASE_URL,
    apiBaseUrl: source.API_BASE_URL,
    controlPlane: {
      databaseUrl: source.CONTROL_PLANE_DATABASE_URL,
      url: source.CONTROL_PLANE_URL,
      store: controlPlaneStore,
      adminTokenConfigured: Boolean(source.CONTROL_PLANE_ADMIN_TOKEN),
    },
    tenantResolver: {
      failClosed,
      cacheTtlSeconds: Number(source.TENANT_RESOLVER_CACHE_TTL_SECONDS ?? 60),
      allowDemoTenant,
    },
    auth: {
      provider: authProvider,
      issuer: source.AUTH_ISSUER,
      audience: source.AUTH_AUDIENCE,
      clientId: source.AUTH_CLIENT_ID,
      jwksUri: source.AUTH_JWKS_URI,
      headerProxy: { trusted: proxyTrusted, secretConfigured: proxySecretConfigured },
      sessionSecretConfigured: Boolean(source.SESSION_SECRET),
    },
    dataPlane: {
      serviceKeySource: 'env',
      databaseUrl: source.DATA_PLANE_DATABASE_URL,
    },
    documents: {
      storageProvider: documentStorage,
      malwareScannerProvider: malwareScanner,
      maxUploadBytes: Number(source.DOCUMENT_MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024),
    },
    audit: { sink: auditSink },
    dataAccess: { sink: dataAccessSink },
    queue: { provider: queueProvider, url: source.WORKER_QUEUE_URL },
    release: {
      signingPublicKeyConfigured: Boolean(source.RELEASE_SIGNING_PUBLIC_KEY),
      requireSigned: isProductionLike,
    },
    backup: {
      provider: source.BACKUP_PROVIDER,
      configured: Boolean(source.BACKUP_PROVIDER),
    },
    demo: { demoDataEnabled },
    worker: { mode: workerMode },
    ubm: { officialTransportEnabled: false },
  };
}
