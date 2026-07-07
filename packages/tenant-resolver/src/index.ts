export type TenantResolution = {
  tenantSlug: string;
  environment: 'test' | 'stage' | 'prod';
  deploymentMode: 'model_b_vendor_hosted_isolated' | 'model_c1_municipality_supabase' | 'model_c2_self_hosted_supabase' | 'model_c3_postgres_separate_storage';
  modules: string[];
  safePublicConfig: {
    supabaseUrl?: string;
    publishableKey?: string;
    apiBaseUrl: string;
  };
};

export class UnknownTenantDomainError extends Error {
  constructor(host: string) {
    super(`Unknown tenant domain: ${host}`);
    this.name = 'UnknownTenantDomainError';
  }
}

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}

export function resolveTenantFromStaticMap(host: string, map: Record<string, TenantResolution>): TenantResolution {
  const normalized = normalizeHost(host);
  const resolution = map[normalized];

  if (!resolution) {
    throw new UnknownTenantDomainError(normalized);
  }

  return {
    ...resolution,
    safePublicConfig: {
      ...resolution.safePublicConfig,
    },
  };
}
