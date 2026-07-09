import { createDbClient, type DbClient } from '@ubm-klar/db';
import type { SafeTenantConfig } from '@ubm-klar/shared-types';

/**
 * Server-side tenant data plane connections.
 *
 * Connection strings are service credentials and therefore live only in this
 * process's environment, never in the control plane and never in any response:
 *   DATA_PLANE_DATABASE_URL__{TENANT_SLUG}__{ENV}   (multi-tenant API host)
 *   DATA_PLANE_DATABASE_URL                          (single-tenant deployment)
 *
 * One pool per tenant+environment; pools are created lazily and reused.
 */
export function dataPlaneUrlEnvVarName(tenantSlug: string, environment: string): string {
  const normalize = (value: string) => value.toUpperCase().replaceAll('-', '_');
  return `DATA_PLANE_DATABASE_URL__${normalize(tenantSlug)}__${normalize(environment)}`;
}

export class TenantDataPlanePool {
  private pools = new Map<string, DbClient>();

  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  /** Returns the tenant's data plane connection, or undefined if none is configured. */
  resolve(tenant: SafeTenantConfig): DbClient | undefined {
    const key = `${tenant.tenantSlug}:${tenant.environment}`;
    const existing = this.pools.get(key);
    if (existing) return existing;

    const url =
      this.env[dataPlaneUrlEnvVarName(tenant.tenantSlug, tenant.environment)] ??
      this.env.DATA_PLANE_DATABASE_URL;
    if (!url) return undefined;

    const client = createDbClient({
      connectionString: url,
      applicationName: `ubm-klar-api:${tenant.tenantSlug}`,
    });
    this.pools.set(key, client);
    return client;
  }

  async end(): Promise<void> {
    await Promise.all([...this.pools.values()].map((pool) => pool.end()));
    this.pools.clear();
  }
}
