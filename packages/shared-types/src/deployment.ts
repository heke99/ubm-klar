import type { ModuleId } from './modules';

/**
 * Deployment models for municipal data planes.
 *
 * Production is NEVER a shared multi-tenant database. Every municipality gets an
 * isolated data plane, either vendor-hosted (Model B) or municipality-owned (Model C).
 * Shared databases are allowed only for local development, demo and fake-data prototypes.
 */
export type DeploymentMode =
  | 'model_b_vendor_hosted_isolated'
  | 'model_c1_municipality_managed_supabase'
  | 'model_c2_self_hosted_supabase'
  | 'model_c3_postgres_separate_storage'
  | 'local_demo_shared';

export const PRODUCTION_DEPLOYMENT_MODES: readonly DeploymentMode[] = [
  'model_b_vendor_hosted_isolated',
  'model_c1_municipality_managed_supabase',
  'model_c2_self_hosted_supabase',
  'model_c3_postgres_separate_storage',
] as const;

export function isProductionCapableDeploymentMode(mode: DeploymentMode): boolean {
  return PRODUCTION_DEPLOYMENT_MODES.includes(mode);
}

export type EnvironmentName = 'test' | 'stage' | 'prod' | 'demo' | 'local';

export const PRODUCTION_ENVIRONMENT: EnvironmentName = 'prod';

/** Tenant lifecycle status in the control plane. */
export type TenantStatus =
  'prospect' | 'onboarding' | 'pilot' | 'live' | 'suspended' | 'offboarding' | 'exited';

export interface TenantEnvironmentRef {
  tenantId: string;
  environment: EnvironmentName;
}

/**
 * Safe, non-secret tenant configuration that may be handed to application code
 * after tenant resolution. Never contains service-role keys or PII.
 */
export interface SafeTenantConfig {
  tenantId: string;
  tenantSlug: string;
  municipalityName: string;
  deploymentMode: DeploymentMode;
  environment: EnvironmentName;
  /** Lifecycle status (pilot tenants get the pilot banner and pilot limits). */
  tenantStatus?: TenantStatus;
  activeModules: ModuleId[];
  /** Public URL of the tenant's own data plane API (Model B or C). */
  dataPlaneUrl: string;
  /** Publishable/anon key only. Service-role keys must never appear here. */
  dataPlanePublishableKey: string;
  authProvider: 'entra_id' | 'saml' | 'oidc' | 'supabase_auth';
  featureFlags: Record<string, boolean>;
}
