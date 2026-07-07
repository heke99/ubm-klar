import type { SafeTenantConfig } from '@ubm-klar/shared-types';

/**
 * Connection descriptors for the tenant's isolated data plane.
 *
 * The browser only ever receives `BrowserDataPlaneConnection` (publishable key).
 * Service connections require explicit server context and read the secret from the
 * process environment at call time; the secret value never travels through tenant
 * config, the resolver, or the control plane.
 */
export interface BrowserDataPlaneConnection {
  kind: 'browser';
  url: string;
  publishableKey: string;
  tenantId: string;
  environment: string;
}

export interface ServiceDataPlaneConnection {
  kind: 'service';
  url: string;
  /** Secret read from server env; consumer passes it straight to the driver. */
  serviceKey: string;
  tenantId: string;
  environment: string;
}

export class ServiceKeyInBrowserError extends Error {
  constructor() {
    super(
      'Refusing to create a service-role data plane connection in a browser context. ' +
        'Service keys are server-only.',
    );
    this.name = 'ServiceKeyInBrowserError';
  }
}

export class MissingServiceKeyError extends Error {
  constructor(envVar: string) {
    super(`Service key environment variable "${envVar}" is not set for this data plane.`);
    this.name = 'MissingServiceKeyError';
  }
}

export function isBrowserContext(globalObject: object = globalThis): boolean {
  return 'window' in globalObject && 'document' in globalObject;
}

/** Safe for frontend use: only the publishable key from resolved tenant config. */
export function createBrowserConnection(config: SafeTenantConfig): BrowserDataPlaneConnection {
  return {
    kind: 'browser',
    url: config.dataPlaneUrl,
    publishableKey: config.dataPlanePublishableKey,
    tenantId: config.tenantId,
    environment: config.environment,
  };
}

export interface ServiceConnectionOptions {
  config: SafeTenantConfig;
  /**
   * Env var holding the service key for THIS tenant+environment, e.g.
   * `DATA_PLANE_SERVICE_KEY__MALMO__PROD`. One secret per tenant per environment —
   * there is no shared service key across municipalities.
   */
  env?: Record<string, string | undefined>;
  globalObject?: object;
}

export function serviceKeyEnvVarName(tenantSlug: string, environment: string): string {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `DATA_PLANE_SERVICE_KEY__${clean(tenantSlug)}__${clean(environment)}`;
}

export function createServiceConnection(
  options: ServiceConnectionOptions,
): ServiceDataPlaneConnection {
  const { config } = options;
  if (isBrowserContext(options.globalObject ?? globalThis)) {
    throw new ServiceKeyInBrowserError();
  }
  const envVar = serviceKeyEnvVarName(config.tenantSlug, config.environment);
  const env = options.env ?? process.env;
  const serviceKey = env[envVar];
  if (!serviceKey) {
    throw new MissingServiceKeyError(envVar);
  }
  return {
    kind: 'service',
    url: config.dataPlaneUrl,
    serviceKey,
    tenantId: config.tenantId,
    environment: config.environment,
  };
}
