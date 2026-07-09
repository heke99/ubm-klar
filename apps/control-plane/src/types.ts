import type {
  DeploymentMode,
  EnvironmentName,
  ModuleId,
  TenantStatus,
} from '@ubm-klar/shared-types';

export type { TenantStatus };

export interface ControlPlaneTenant {
  id: string;
  slug: string;
  municipalityName: string;
  organizationNumber: string;
  deploymentMode: DeploymentMode;
  status: TenantStatus;
  createdAt: string;
}

export type DomainModel = 'model_b_subdomain' | 'model_c_municipality_domain';

export interface TenantDomain {
  id: string;
  tenantId: string;
  domain: string;
  environment: EnvironmentName;
  domainModel: DomainModel;
  verified: boolean;
}

export interface TenantEnvironment {
  id: string;
  tenantId: string;
  environment: EnvironmentName;
  dataPlaneUrl: string;
  /** Reference name of the publishable key in the tenant secret store. Never the key value. */
  publishableKeyReference?: string;
  status: 'provisioning' | 'ready' | 'degraded' | 'disabled';
}

export interface TenantModule {
  tenantId: string;
  moduleId: ModuleId;
  enabled: boolean;
}

export interface TenantAuthProvider {
  tenantId: string;
  environment: EnvironmentName;
  providerKind: 'entra_id' | 'saml' | 'oidc' | 'supabase_auth';
  isPrimary: boolean;
  issuerUrl?: string;
  status: 'configured' | 'tested' | 'failed' | 'disabled';
}

export interface TenantFeatureFlag {
  tenantId: string;
  environment: EnvironmentName;
  flagKey: string;
  enabled: boolean;
}

export interface TenantSupportCase {
  id: string;
  tenantId: string;
  title: string;
  category: 'technical' | 'import' | 'integration' | 'release' | 'access' | 'billing' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'waiting_on_municipality' | 'resolved' | 'closed';
  descriptionNoPii: string;
  errorCode?: string;
}

export interface TenantReadinessGate {
  tenantId: string;
  gateId: string;
  gateName: string;
  required: boolean;
  status: 'not_started' | 'in_progress' | 'passed' | 'failed' | 'waived';
  evidenceReference?: string;
}

export interface TenantHealthCheck {
  tenantId: string;
  environment: EnvironmentName;
  checkId: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  latencyMs?: number;
  errorCode?: string;
  checkedAt: string;
}

export interface TenantReleaseStatus {
  tenantId: string;
  environment: EnvironmentName;
  currentVersion?: string;
  targetVersion?: string;
  status: 'up_to_date' | 'update_available' | 'updating' | 'failed' | 'rolled_back';
}
