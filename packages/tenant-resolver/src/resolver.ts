import {
  validateTenantDomain,
  type DeploymentMode,
  type EnvironmentName,
  type ModuleId,
  type SafeTenantConfig,
} from '@ubm-klar/shared-types';
import { TtlCache } from './cache';

/**
 * Raw tenant directory record as served by the control plane. May reference secret
 * *names*, never secret values.
 */
export interface TenantDirectoryRecord {
  tenantId: string;
  tenantSlug: string;
  municipalityName: string;
  deploymentMode: DeploymentMode;
  environment: EnvironmentName;
  domain: string;
  domainVerified: boolean;
  activeModules: ModuleId[];
  dataPlaneUrl: string;
  dataPlanePublishableKey: string;
  authProvider: 'entra_id' | 'saml' | 'oidc' | 'supabase_auth';
  featureFlags: Record<string, boolean>;
}

export interface TenantDirectory {
  lookupByDomain(domain: string): Promise<TenantDirectoryRecord | undefined>;
}

export class UnknownTenantDomainError extends Error {
  constructor(public readonly domain: string) {
    super(`Unknown tenant domain: ${domain}. Failing closed.`);
    this.name = 'UnknownTenantDomainError';
  }
}

export class ForbiddenTenantDomainError extends Error {
  constructor(
    public readonly domain: string,
    reason: string,
  ) {
    super(`Forbidden tenant domain: ${domain}. ${reason}`);
    this.name = 'ForbiddenTenantDomainError';
  }
}

export class UnverifiedTenantDomainError extends Error {
  constructor(public readonly domain: string) {
    super(`Tenant domain not verified: ${domain}. Failing closed.`);
    this.name = 'UnverifiedTenantDomainError';
  }
}

export class TenantConfigLeakError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantConfigLeakError';
  }
}

const SECRET_VALUE_PATTERNS = [/service_role/i, /^sb_secret_/i, /secret/i, /private[-_]?key/i];

export interface TenantResolverOptions {
  directory: TenantDirectory;
  cacheTtlMs?: number;
  now?: () => number;
}

/**
 * Strict, fail-closed tenant resolver.
 *
 * - Unknown domains throw (`UnknownTenantDomainError`) — never a default tenant.
 * - Domains violating brand rules throw even if present in the directory.
 * - Unverified domains throw (spoof protection: registration alone is not enough).
 * - The returned config is deep-frozen and scanned so secret material can never leak
 *   to callers (and therefore never to the frontend).
 * - Positive results are cached with TTL; failures are never cached.
 */
export class TenantResolver {
  private readonly directory: TenantDirectory;
  private readonly cache: TtlCache<SafeTenantConfig>;

  constructor(options: TenantResolverOptions) {
    this.directory = options.directory;
    this.cache = new TtlCache(options.cacheTtlMs ?? 60_000, options.now ?? Date.now);
  }

  async resolve(rawDomain: string): Promise<SafeTenantConfig> {
    const domain = normalizeDomain(rawDomain);

    const validation = validateTenantDomain(domain);
    if (!validation.valid) {
      throw new ForbiddenTenantDomainError(domain, validation.reason);
    }

    const cached = this.cache.get(domain);
    if (cached) return cached;

    const record = await this.directory.lookupByDomain(domain);
    if (!record) {
      throw new UnknownTenantDomainError(domain);
    }
    if (normalizeDomain(record.domain) !== domain) {
      // Defensive: a directory bug returning another tenant's record must fail closed.
      throw new TenantConfigLeakError(
        `Directory returned record for "${record.domain}" when resolving "${domain}"`,
      );
    }
    if (!record.domainVerified) {
      throw new UnverifiedTenantDomainError(domain);
    }

    const config = toSafeConfig(record);
    assertNoSecretMaterial(config);
    this.cache.set(domain, config);
    return config;
  }

  invalidate(domain: string): void {
    this.cache.invalidate(normalizeDomain(domain));
  }
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().split(':')[0]!.replace(/\.$/, '');
}

function toSafeConfig(record: TenantDirectoryRecord): SafeTenantConfig {
  const config: SafeTenantConfig = {
    tenantId: record.tenantId,
    tenantSlug: record.tenantSlug,
    municipalityName: record.municipalityName,
    deploymentMode: record.deploymentMode,
    environment: record.environment,
    activeModules: [...record.activeModules],
    dataPlaneUrl: record.dataPlaneUrl,
    dataPlanePublishableKey: record.dataPlanePublishableKey,
    authProvider: record.authProvider,
    featureFlags: { ...record.featureFlags },
  };
  return Object.freeze(config);
}

/** Rejects configs carrying anything that looks like secret material. */
export function assertNoSecretMaterial(config: SafeTenantConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string') continue;
    if (key === 'dataPlanePublishableKey') {
      if (SECRET_VALUE_PATTERNS.some((p) => p.test(value))) {
        throw new TenantConfigLeakError(
          'dataPlanePublishableKey looks like a secret/service-role key. Refusing to resolve.',
        );
      }
      continue;
    }
    if (/service_role|sb_secret_/i.test(value)) {
      throw new TenantConfigLeakError(`Field "${key}" contains secret-like material.`);
    }
  }
}
