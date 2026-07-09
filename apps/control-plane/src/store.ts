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
import type { ProvisioningRun } from './provisioning';

/**
 * Control-plane persistence boundary. Every write passes through the no-PII guard,
 * so even a programming error upstream cannot land personal data in the control plane.
 *
 * The in-memory implementation backs unit tests and local development only;
 * production uses PostgresControlPlaneStore against apps/control-plane/migrations
 * (enforced at startup — see main.ts and @ubm-klar/config).
 */
export interface ControlPlaneStore {
  createTenant(input: Omit<ControlPlaneTenant, 'id' | 'createdAt'>): Promise<ControlPlaneTenant>;
  getTenant(id: string): Promise<ControlPlaneTenant | undefined>;
  getTenantBySlug(slug: string): Promise<ControlPlaneTenant | undefined>;
  listTenants(): Promise<ControlPlaneTenant[]>;
  updateTenantStatus(id: string, status: ControlPlaneTenant['status']): Promise<ControlPlaneTenant>;

  addDomain(input: Omit<TenantDomain, 'id'>): Promise<TenantDomain>;
  findDomain(domain: string): Promise<TenantDomain | undefined>;
  listDomains(tenantId: string): Promise<TenantDomain[]>;
  verifyDomain(domainId: string): Promise<TenantDomain>;

  upsertEnvironment(input: Omit<TenantEnvironment, 'id'>): Promise<TenantEnvironment>;
  listEnvironments(tenantId: string): Promise<TenantEnvironment[]>;

  setModule(input: TenantModule): Promise<TenantModule>;
  listModules(tenantId: string): Promise<TenantModule[]>;

  setAuthProvider(input: TenantAuthProvider): Promise<TenantAuthProvider>;
  listAuthProviders(tenantId: string): Promise<TenantAuthProvider[]>;

  setFeatureFlag(input: TenantFeatureFlag): Promise<TenantFeatureFlag>;
  listFeatureFlags(tenantId: string, environment?: string): Promise<TenantFeatureFlag[]>;

  createSupportCase(input: Omit<TenantSupportCase, 'id'>): Promise<TenantSupportCase>;
  listSupportCases(tenantId: string): Promise<TenantSupportCase[]>;

  setReadinessGate(input: TenantReadinessGate): Promise<TenantReadinessGate>;
  listReadinessGates(tenantId: string): Promise<TenantReadinessGate[]>;

  recordHealthCheck(input: TenantHealthCheck): Promise<TenantHealthCheck>;
  listHealthChecks(tenantId: string): Promise<TenantHealthCheck[]>;

  setReleaseStatus(input: TenantReleaseStatus): Promise<TenantReleaseStatus>;
  listReleaseStatuses(tenantId: string): Promise<TenantReleaseStatus[]>;

  saveProvisioningRun(run: ProvisioningRun): Promise<ProvisioningRun>;
  getProvisioningRun(runId: string): Promise<ProvisioningRun | undefined>;
  listProvisioningRuns(tenantId: string): Promise<ProvisioningRun[]>;
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
  private provisioningRuns = new Map<string, ProvisioningRun>();

  async createTenant(
    input: Omit<ControlPlaneTenant, 'id' | 'createdAt'>,
  ): Promise<ControlPlaneTenant> {
    assertNoPii(input, 'control-plane.tenants');
    if (await this.getTenantBySlug(input.slug)) {
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

  async getTenant(id: string): Promise<ControlPlaneTenant | undefined> {
    return this.tenants.get(id);
  }

  async getTenantBySlug(slug: string): Promise<ControlPlaneTenant | undefined> {
    return [...this.tenants.values()].find((t) => t.slug === slug);
  }

  async listTenants(): Promise<ControlPlaneTenant[]> {
    return [...this.tenants.values()];
  }

  async updateTenantStatus(
    id: string,
    status: ControlPlaneTenant['status'],
  ): Promise<ControlPlaneTenant> {
    const tenant = this.tenants.get(id);
    if (!tenant) throw new Error(`Unknown tenant: ${id}`);
    const updated = { ...tenant, status };
    this.tenants.set(id, updated);
    return updated;
  }

  async addDomain(input: Omit<TenantDomain, 'id'>): Promise<TenantDomain> {
    assertNoPii(input, 'control-plane.tenant_domains');
    const existing = await this.findDomain(input.domain);
    if (existing) throw new Error(`Domain already registered: ${input.domain}`);
    const domain: TenantDomain = { ...input, id: randomUUID() };
    this.domains.set(domain.id, domain);
    return domain;
  }

  async findDomain(domain: string): Promise<TenantDomain | undefined> {
    return [...this.domains.values()].find((d) => d.domain === domain.toLowerCase());
  }

  async listDomains(tenantId: string): Promise<TenantDomain[]> {
    return [...this.domains.values()].filter((d) => d.tenantId === tenantId);
  }

  async verifyDomain(domainId: string): Promise<TenantDomain> {
    const domain = this.domains.get(domainId);
    if (!domain) throw new Error(`Unknown domain id: ${domainId}`);
    const updated = { ...domain, verified: true };
    this.domains.set(domainId, updated);
    return updated;
  }

  async upsertEnvironment(input: Omit<TenantEnvironment, 'id'>): Promise<TenantEnvironment> {
    assertNoPii(input, 'control-plane.tenant_environments');
    const key = `${input.tenantId}:${input.environment}`;
    const existing = [...this.environments.values()].find(
      (e) => `${e.tenantId}:${e.environment}` === key,
    );
    const env: TenantEnvironment = { ...input, id: existing?.id ?? randomUUID() };
    this.environments.set(env.id, env);
    return env;
  }

  async listEnvironments(tenantId: string): Promise<TenantEnvironment[]> {
    return [...this.environments.values()].filter((e) => e.tenantId === tenantId);
  }

  async setModule(input: TenantModule): Promise<TenantModule> {
    this.modules.set(`${input.tenantId}:${input.moduleId}`, input);
    return input;
  }

  async listModules(tenantId: string): Promise<TenantModule[]> {
    return [...this.modules.values()].filter((m) => m.tenantId === tenantId);
  }

  async setAuthProvider(input: TenantAuthProvider): Promise<TenantAuthProvider> {
    assertNoPii(input, 'control-plane.tenant_auth_providers');
    this.authProviders.set(`${input.tenantId}:${input.environment}:${input.providerKind}`, input);
    return input;
  }

  async listAuthProviders(tenantId: string): Promise<TenantAuthProvider[]> {
    return [...this.authProviders.values()].filter((p) => p.tenantId === tenantId);
  }

  async setFeatureFlag(input: TenantFeatureFlag): Promise<TenantFeatureFlag> {
    this.featureFlags.set(`${input.tenantId}:${input.environment}:${input.flagKey}`, input);
    return input;
  }

  async listFeatureFlags(tenantId: string, environment?: string): Promise<TenantFeatureFlag[]> {
    return [...this.featureFlags.values()].filter(
      (f) => f.tenantId === tenantId && (!environment || f.environment === environment),
    );
  }

  async createSupportCase(input: Omit<TenantSupportCase, 'id'>): Promise<TenantSupportCase> {
    assertNoPii(input, 'control-plane.tenant_support_cases');
    const supportCase: TenantSupportCase = { ...input, id: randomUUID() };
    this.supportCases.set(supportCase.id, supportCase);
    return supportCase;
  }

  async listSupportCases(tenantId: string): Promise<TenantSupportCase[]> {
    return [...this.supportCases.values()].filter((c) => c.tenantId === tenantId);
  }

  async setReadinessGate(input: TenantReadinessGate): Promise<TenantReadinessGate> {
    assertNoPii(input, 'control-plane.tenant_production_readiness');
    this.readinessGates.set(`${input.tenantId}:${input.gateId}`, input);
    return input;
  }

  async listReadinessGates(tenantId: string): Promise<TenantReadinessGate[]> {
    return [...this.readinessGates.values()].filter((g) => g.tenantId === tenantId);
  }

  async recordHealthCheck(input: TenantHealthCheck): Promise<TenantHealthCheck> {
    assertNoPii(input, 'control-plane.tenant_health_checks');
    this.healthChecks.push(input);
    return input;
  }

  async listHealthChecks(tenantId: string): Promise<TenantHealthCheck[]> {
    return this.healthChecks.filter((h) => h.tenantId === tenantId);
  }

  async setReleaseStatus(input: TenantReleaseStatus): Promise<TenantReleaseStatus> {
    assertNoPii(input, 'control-plane.tenant_release_status');
    this.releaseStatuses.set(`${input.tenantId}:${input.environment}`, input);
    return input;
  }

  async listReleaseStatuses(tenantId: string): Promise<TenantReleaseStatus[]> {
    return [...this.releaseStatuses.values()].filter((r) => r.tenantId === tenantId);
  }

  async saveProvisioningRun(run: ProvisioningRun): Promise<ProvisioningRun> {
    assertNoPii(run, 'control-plane.tenant_provisioning_runs');
    this.provisioningRuns.set(run.id, structuredClone(run));
    return run;
  }

  async getProvisioningRun(runId: string): Promise<ProvisioningRun | undefined> {
    const run = this.provisioningRuns.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async listProvisioningRuns(tenantId: string): Promise<ProvisioningRun[]> {
    return [...this.provisioningRuns.values()]
      .filter((r) => r.tenantId === tenantId)
      .map((r) => structuredClone(r));
  }
}
