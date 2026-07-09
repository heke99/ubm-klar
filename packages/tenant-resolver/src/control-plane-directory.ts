import type {
  DeploymentMode,
  EnvironmentName,
  ModuleId,
  TenantStatus,
} from '@ubm-klar/shared-types';
import type { TenantDirectory, TenantDirectoryRecord } from './resolver';

/**
 * Tenant directory backed by the control plane HTTP API
 * (`GET /directory/domains/:domain`).
 *
 * - Unknown/unverified domains: the control plane answers 404 and the lookup
 *   returns undefined, so the resolver fails closed.
 * - Control plane unavailable/errors: the lookup throws — never a fallback
 *   tenant, and the resolver never caches failures.
 * - The control plane stores publishable key *references* only. The actual
 *   publishable (non-secret) key is resolved from this process's environment
 *   using the convention DATA_PLANE_PUBLISHABLE_KEY__{TENANT_SLUG}__{ENV}
 *   (uppercased, dashes to underscores). Service keys are never handled here.
 */
export interface ControlPlaneTenantDirectoryOptions {
  baseUrl: string;
  /** Token with directory-only scope (or the admin token in dev). */
  directoryToken?: string;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

export class TenantDirectoryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantDirectoryUnavailableError';
  }
}

interface DirectoryResponse {
  tenantId: string;
  tenantSlug: string;
  municipalityName: string;
  deploymentMode: DeploymentMode;
  tenantStatus: TenantStatus;
  domain: string;
  environment: EnvironmentName;
  verified: boolean;
  dataPlaneUrl: string;
  publishableKeyReference: string;
  activeModules: ModuleId[];
  authProvider: 'entra_id' | 'saml' | 'oidc' | 'supabase_auth';
  featureFlags: Record<string, boolean>;
}

export function publishableKeyEnvVarName(tenantSlug: string, environment: string): string {
  const normalize = (value: string) => value.toUpperCase().replaceAll('-', '_');
  return `DATA_PLANE_PUBLISHABLE_KEY__${normalize(tenantSlug)}__${normalize(environment)}`;
}

export class ControlPlaneTenantDirectory implements TenantDirectory {
  private readonly baseUrl: string;
  private readonly directoryToken: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly env: Record<string, string | undefined>;

  constructor(options: ControlPlaneTenantDirectoryOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.directoryToken = options.directoryToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.env = options.env ?? process.env;
  }

  async lookupByDomain(domain: string): Promise<TenantDirectoryRecord | undefined> {
    const url = `${this.baseUrl}/directory/domains/${encodeURIComponent(domain.toLowerCase())}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: this.directoryToken ? { authorization: `Bearer ${this.directoryToken}` } : {},
      });
    } catch (error) {
      throw new TenantDirectoryUnavailableError(
        `Control plane directory unreachable: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new TenantDirectoryUnavailableError(
        `Control plane directory returned ${response.status}`,
      );
    }
    const record = (await response.json()) as DirectoryResponse;

    // Publishable keys are non-secret, but references must still never contain
    // secret-looking material — the resolver re-checks with assertNoSecretMaterial.
    const keyFromEnv =
      this.env[publishableKeyEnvVarName(record.tenantSlug, record.environment)] ?? '';

    return {
      tenantId: record.tenantId,
      tenantSlug: record.tenantSlug,
      municipalityName: record.municipalityName,
      deploymentMode: record.deploymentMode,
      tenantStatus: record.tenantStatus,
      environment: record.environment,
      domain: record.domain,
      domainVerified: record.verified === true,
      activeModules: record.activeModules,
      dataPlaneUrl: record.dataPlaneUrl,
      dataPlanePublishableKey: keyFromEnv,
      authProvider: record.authProvider,
      featureFlags: record.featureFlags,
    };
  }
}
