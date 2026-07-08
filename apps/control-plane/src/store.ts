import { randomUUID } from 'node:crypto';
import { assertNoPii } from '@ubm-klar/config';
import type {
  ControlPlaneTenant,
  TenantAuthProvider,
  TenantDomain,
  TenantEnvironment,
  TenantFeatureFlag,
  TenantHealthCheck,
  TenantModule,
  TenantReadinessGate,
  TenantReleaseStatus,
  TenantSupportCase,
} from './types';

/**
 * Control-plane persistence boundary. Every write passes through the no-PII guard,
 * so even a programming error upstream cannot land personal data in the control plane.
 *
 * The in-memory implementation backs unit tests and local development; production
 * deployments use the identical interface backed by the control-plane Postgres
 * schema in apps/control-plane/migrations.
 */
export interface ControlPlaneStore {
  createTenant(input: Omit<ControlPlaneTenant, 'id' | 'createdAt'>): ControlPlaneTenant;
  getTenant(id: string): ControlPlaneTenant | undefined;
  getTenantBySlug(slug: string): ControlPlaneTenant | undefined;
  listTenants(): ControlPlaneTenant[];
  updateTenantStatus(id: string, status: ControlPlaneTenant['status']): ControlPlaneTenant;

  addDomain(input: Omit<TenantDomain, 'id'>): TenantDomain;
  findDomain(domain: string): TenantDomain | undefined;
  listDomains(tenantId: string): TenantDomain[];
  verifyDomain(domainId: string): TenantDomain;

  upsertEnvironment(input: Omit<TenantEnvironment, 'id'>): TenantEnvironment;
  listEnvironments(tenantId: string): TenantEnvironment[];

  setModule(input: TenantModule): TenantModule;
  listModules(tenantId: string): TenantModule[];

  setAuthProvider(input: TenantAuthProvider): TenantAuthProvider;
  listAuthProviders(tenantId: string): TenantAuthProvider[];

  setFeatureFlag(input: TenantFeatureFlag): TenantFeatureFlag;
  listFeatureFlags(tenantId: string, environment?: string): TenantFeatureFlag[];

  createSupportCase(input: Omit<TenantSupportCase, 'id'>): TenantSupportCase;
  listSupportCases(tenantId: string): TenantSupportCase[];

  setReadinessGate(input: TenantReadinessGate): TenantReadinessGate;
  listReadinessGates(tenantId: string): TenantReadinessGate[];

  recordHealthCheck(input: TenantHealthCheck): TenantHealthCheck;
  listHealthChecks(tenantId: string): TenantHealthCheck[];

  setReleaseStatus(input: TenantReleaseStatus): TenantReleaseStatus;
  listReleaseStatuses(tenantId: string): TenantReleaseStatus[];
}

export class InMemoryControlPlaneStore implements ControlPlaneStore {
  private tenants = new Map<string, ControlPlaneTenant>();
  private domains = new Map<string, TenantDomain>();
  private environments = new Map<string, TenantEnvironment>();
  private modules = new Map<string, TenantModule>();
  private authProviders = new Map<string, TenantAuthProvider>();
  private featureFlags = new Map<string, TenantFeatureFlag>();
  private supportCases = new Map<string, TenantSupportCase>();
  private readinessGates = new Map<string, TenantReadinessGate>();
  private healthChecks: TenantHealthCheck[] = [];
  private releaseStatuses = new Map<string, TenantReleaseStatus>();

  createTenant(input: Omit<ControlPlaneTenant, 'id' | 'createdAt'>): ControlPlaneTenant {
    assertNoPii(input, 'control-plane.tenants');
    if (this.getTenantBySlug(input.slug)) {
      throw new Error(`Tenant slug already exists: ${input.slug}`);
    }
    const tenant: ControlPlaneTenant = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  getTenant(id: string): ControlPlaneTenant | undefined {
    return this.tenants.get(id);
  }

  getTenantBySlug(slug: string): ControlPlaneTenant | undefined {
    return [...this.tenants.values()].find((t) => t.slug === slug);
  }

  listTenants(): ControlPlaneTenant[] {
    return [...this.tenants.values()];
  }

  updateTenantStatus(id: string, status: ControlPlaneTenant['status']): ControlPlaneTenant {
    const tenant = this.tenants.get(id);
    if (!tenant) throw new Error(`Unknown tenant: ${id}`);
    const updated = { ...tenant, status };
    this.tenants.set(id, updated);
    return updated;
  }

  addDomain(input: Omit<TenantDomain, 'id'>): TenantDomain {
    assertNoPii(input, 'control-plane.tenant_domains');
    const existing = this.findDomain(input.domain);
    if (existing) throw new Error(`Domain already registered: ${input.domain}`);
    const domain: TenantDomain = { ...input, id: randomUUID() };
    this.domains.set(domain.id, domain);
    return domain;
  }

  findDomain(domain: string): TenantDomain | undefined {
    return [...this.domains.values()].find((d) => d.domain === domain.toLowerCase());
  }

  listDomains(tenantId: string): TenantDomain[] {
    return [...this.domains.values()].filter((d) => d.tenantId === tenantId);
  }

  verifyDomain(domainId: string): TenantDomain {
    const domain = this.domains.get(domainId);
    if (!domain) throw new Error(`Unknown domain id: ${domainId}`);
    const updated = { ...domain, verified: true };
    this.domains.set(domainId, updated);
    return updated;
  }

  upsertEnvironment(input: Omit<TenantEnvironment, 'id'>): TenantEnvironment {
    assertNoPii(input, 'control-plane.tenant_environments');
    const key = `${input.tenantId}:${input.environment}`;
    const existing = [...this.environments.values()].find(
      (e) => `${e.tenantId}:${e.environment}` === key,
    );
    const env: TenantEnvironment = { ...input, id: existing?.id ?? randomUUID() };
    this.environments.set(env.id, env);
    return env;
  }

  listEnvironments(tenantId: string): TenantEnvironment[] {
    return [...this.environments.values()].filter((e) => e.tenantId === tenantId);
  }

  setModule(input: TenantModule): TenantModule {
    this.modules.set(`${input.tenantId}:${input.moduleId}`, input);
    return input;
  }

  listModules(tenantId: string): TenantModule[] {
    return [...this.modules.values()].filter((m) => m.tenantId === tenantId);
  }

  setAuthProvider(input: TenantAuthProvider): TenantAuthProvider {
    assertNoPii(input, 'control-plane.tenant_auth_providers');
    this.authProviders.set(`${input.tenantId}:${input.environment}:${input.providerKind}`, input);
    return input;
  }

  listAuthProviders(tenantId: string): TenantAuthProvider[] {
    return [...this.authProviders.values()].filter((p) => p.tenantId === tenantId);
  }

  setFeatureFlag(input: TenantFeatureFlag): TenantFeatureFlag {
    this.featureFlags.set(`${input.tenantId}:${input.environment}:${input.flagKey}`, input);
    return input;
  }

  listFeatureFlags(tenantId: string, environment?: string): TenantFeatureFlag[] {
    return [...this.featureFlags.values()].filter(
      (f) => f.tenantId === tenantId && (!environment || f.environment === environment),
    );
  }

  createSupportCase(input: Omit<TenantSupportCase, 'id'>): TenantSupportCase {
    assertNoPii(input, 'control-plane.tenant_support_cases');
    const supportCase: TenantSupportCase = { ...input, id: randomUUID() };
    this.supportCases.set(supportCase.id, supportCase);
    return supportCase;
  }

  listSupportCases(tenantId: string): TenantSupportCase[] {
    return [...this.supportCases.values()].filter((c) => c.tenantId === tenantId);
  }

  setReadinessGate(input: TenantReadinessGate): TenantReadinessGate {
    assertNoPii(input, 'control-plane.tenant_production_readiness');
    this.readinessGates.set(`${input.tenantId}:${input.gateId}`, input);
    return input;
  }

  listReadinessGates(tenantId: string): TenantReadinessGate[] {
    return [...this.readinessGates.values()].filter((g) => g.tenantId === tenantId);
  }

  recordHealthCheck(input: TenantHealthCheck): TenantHealthCheck {
    assertNoPii(input, 'control-plane.tenant_health_checks');
    this.healthChecks.push(input);
    return input;
  }

  listHealthChecks(tenantId: string): TenantHealthCheck[] {
    return this.healthChecks.filter((h) => h.tenantId === tenantId);
  }

  setReleaseStatus(input: TenantReleaseStatus): TenantReleaseStatus {
    assertNoPii(input, 'control-plane.tenant_release_status');
    this.releaseStatuses.set(`${input.tenantId}:${input.environment}`, input);
    return input;
  }

  listReleaseStatuses(tenantId: string): TenantReleaseStatus[] {
    return [...this.releaseStatuses.values()].filter((r) => r.tenantId === tenantId);
  }
}
