import { assertNoPii } from '@ubm-klar/config';
import type { DbClient } from '@ubm-klar/db';
import type { EnvironmentName, ModuleId } from '@ubm-klar/shared-types';
import type { ControlPlaneStore } from './store';
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
import type { ProvisioningRun, ProvisioningStep, ProvisioningStepId } from './provisioning';

interface TenantRow {
  id: string;
  slug: string;
  municipality_name: string;
  organization_number: string;
  deployment_mode: ControlPlaneTenant['deploymentMode'];
  status: ControlPlaneTenant['status'];
  created_at: Date;
}

function toTenant(row: TenantRow): ControlPlaneTenant {
  return {
    id: row.id,
    slug: row.slug,
    municipalityName: row.municipality_name,
    organizationNumber: row.organization_number,
    deploymentMode: row.deployment_mode,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

interface DomainRow {
  id: string;
  tenant_id: string;
  domain: string;
  environment: EnvironmentName;
  domain_model: TenantDomain['domainModel'];
  verified: boolean;
}

function toDomain(row: DomainRow): TenantDomain {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    domain: row.domain,
    environment: row.environment,
    domainModel: row.domain_model,
    verified: row.verified,
  };
}

/**
 * Postgres-backed control plane store against apps/control-plane/migrations.
 *
 * No municipal personal data is ever stored: every write re-runs the no-PII
 * scanner (defence in depth on top of the API boundary scan), and the schema
 * itself only models tenant/operations metadata and secret *references*.
 */
export class PostgresControlPlaneStore implements ControlPlaneStore {
  constructor(private readonly db: DbClient) {}

  async createTenant(
    input: Omit<ControlPlaneTenant, 'id' | 'createdAt'>,
  ): Promise<ControlPlaneTenant> {
    assertNoPii(input, 'control-plane.tenants');
    const existing = await this.getTenantBySlug(input.slug);
    if (existing) throw new Error(`Tenant slug already exists: ${input.slug}`);
    const result = await this.db.query<TenantRow>(
      `insert into tenants (slug, municipality_name, organization_number, deployment_mode, status)
       values ($1, $2, $3, $4, $5) returning *`,
      [
        input.slug,
        input.municipalityName,
        input.organizationNumber,
        input.deploymentMode,
        input.status,
      ],
    );
    return toTenant(result.rows[0]!);
  }

  async getTenant(id: string): Promise<ControlPlaneTenant | undefined> {
    const result = await this.db.query<TenantRow>('select * from tenants where id = $1::uuid', [
      id,
    ]);
    const row = result.rows[0];
    return row ? toTenant(row) : undefined;
  }

  async getTenantBySlug(slug: string): Promise<ControlPlaneTenant | undefined> {
    const result = await this.db.query<TenantRow>('select * from tenants where slug = $1', [slug]);
    const row = result.rows[0];
    return row ? toTenant(row) : undefined;
  }

  async listTenants(): Promise<ControlPlaneTenant[]> {
    const result = await this.db.query<TenantRow>('select * from tenants order by created_at');
    return result.rows.map(toTenant);
  }

  async updateTenantStatus(
    id: string,
    status: ControlPlaneTenant['status'],
  ): Promise<ControlPlaneTenant> {
    const result = await this.db.query<TenantRow>(
      'update tenants set status = $2, updated_at = now() where id = $1::uuid returning *',
      [id, status],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown tenant: ${id}`);
    return toTenant(row);
  }

  async addDomain(input: Omit<TenantDomain, 'id'>): Promise<TenantDomain> {
    assertNoPii(input, 'control-plane.tenant_domains');
    const existing = await this.findDomain(input.domain);
    if (existing) throw new Error(`Domain already registered: ${input.domain}`);
    const result = await this.db.query<DomainRow>(
      `insert into tenant_domains (tenant_id, domain, environment, domain_model, verified)
       values ($1::uuid, $2, $3, $4, $5) returning *`,
      [
        input.tenantId,
        input.domain.toLowerCase(),
        input.environment,
        input.domainModel,
        input.verified,
      ],
    );
    return toDomain(result.rows[0]!);
  }

  async findDomain(domain: string): Promise<TenantDomain | undefined> {
    const result = await this.db.query<DomainRow>(
      'select * from tenant_domains where domain = $1',
      [domain.toLowerCase()],
    );
    const row = result.rows[0];
    return row ? toDomain(row) : undefined;
  }

  async listDomains(tenantId: string): Promise<TenantDomain[]> {
    const result = await this.db.query<DomainRow>(
      'select * from tenant_domains where tenant_id = $1::uuid order by created_at',
      [tenantId],
    );
    return result.rows.map(toDomain);
  }

  async verifyDomain(domainId: string): Promise<TenantDomain> {
    const result = await this.db.query<DomainRow>(
      `update tenant_domains set verified = true, verified_at = now()
       where id = $1::uuid returning *`,
      [domainId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown domain id: ${domainId}`);
    return toDomain(row);
  }

  async upsertEnvironment(input: Omit<TenantEnvironment, 'id'>): Promise<TenantEnvironment> {
    assertNoPii(input, 'control-plane.tenant_environments');
    const result = await this.db.query<{
      id: string;
      tenant_id: string;
      environment: EnvironmentName;
      data_plane_url: string;
      publishable_key_reference: string | null;
      status: TenantEnvironment['status'];
    }>(
      `insert into tenant_environments (tenant_id, environment, data_plane_url, publishable_key_reference, status)
       values ($1::uuid, $2, $3, $4, $5)
       on conflict (tenant_id, environment) do update
         set data_plane_url = excluded.data_plane_url,
             publishable_key_reference = excluded.publishable_key_reference,
             status = excluded.status
       returning *`,
      [
        input.tenantId,
        input.environment,
        input.dataPlaneUrl,
        input.publishableKeyReference ?? null,
        input.status,
      ],
    );
    const row = result.rows[0]!;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      environment: row.environment,
      dataPlaneUrl: row.data_plane_url,
      ...(row.publishable_key_reference !== null
        ? { publishableKeyReference: row.publishable_key_reference }
        : {}),
      status: row.status,
    };
  }

  async listEnvironments(tenantId: string): Promise<TenantEnvironment[]> {
    const result = await this.db.query<{
      id: string;
      tenant_id: string;
      environment: EnvironmentName;
      data_plane_url: string;
      publishable_key_reference: string | null;
      status: TenantEnvironment['status'];
    }>('select * from tenant_environments where tenant_id = $1::uuid order by environment', [
      tenantId,
    ]);
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      environment: row.environment,
      dataPlaneUrl: row.data_plane_url,
      ...(row.publishable_key_reference !== null
        ? { publishableKeyReference: row.publishable_key_reference }
        : {}),
      status: row.status,
    }));
  }

  async setModule(input: TenantModule): Promise<TenantModule> {
    await this.db.query(
      `insert into tenant_modules (tenant_id, module_id, enabled, enabled_at)
       values ($1::uuid, $2, $3, case when $3 then now() else null end)
       on conflict (tenant_id, module_id) do update
         set enabled = excluded.enabled,
             enabled_at = case when excluded.enabled then now() else null end`,
      [input.tenantId, input.moduleId, input.enabled],
    );
    return input;
  }

  async listModules(tenantId: string): Promise<TenantModule[]> {
    const result = await this.db.query<{
      tenant_id: string;
      module_id: ModuleId;
      enabled: boolean;
    }>('select * from tenant_modules where tenant_id = $1::uuid order by module_id', [tenantId]);
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      moduleId: row.module_id,
      enabled: row.enabled,
    }));
  }

  async setAuthProvider(input: TenantAuthProvider): Promise<TenantAuthProvider> {
    assertNoPii(input, 'control-plane.tenant_auth_providers');
    await this.db.query(
      `insert into tenant_auth_providers (tenant_id, environment, provider_kind, is_primary, issuer_url, status)
       values ($1::uuid, $2, $3, $4, $5, $6)`,
      [
        input.tenantId,
        input.environment,
        input.providerKind,
        input.isPrimary,
        input.issuerUrl ?? null,
        input.status,
      ],
    );
    return input;
  }

  async listAuthProviders(tenantId: string): Promise<TenantAuthProvider[]> {
    const result = await this.db.query<{
      tenant_id: string;
      environment: EnvironmentName;
      provider_kind: TenantAuthProvider['providerKind'];
      is_primary: boolean;
      issuer_url: string | null;
      status: TenantAuthProvider['status'];
    }>('select * from tenant_auth_providers where tenant_id = $1::uuid order by created_at', [
      tenantId,
    ]);
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      environment: row.environment,
      providerKind: row.provider_kind,
      isPrimary: row.is_primary,
      ...(row.issuer_url !== null ? { issuerUrl: row.issuer_url } : {}),
      status: row.status,
    }));
  }

  async setFeatureFlag(input: TenantFeatureFlag): Promise<TenantFeatureFlag> {
    await this.db.query(
      `insert into tenant_feature_flags (tenant_id, environment, flag_key, enabled)
       values ($1::uuid, $2, $3, $4)
       on conflict (tenant_id, environment, flag_key) do update
         set enabled = excluded.enabled, updated_at = now()`,
      [input.tenantId, input.environment, input.flagKey, input.enabled],
    );
    return input;
  }

  async listFeatureFlags(tenantId: string, environment?: string): Promise<TenantFeatureFlag[]> {
    const result = await this.db.query<{
      tenant_id: string;
      environment: EnvironmentName;
      flag_key: string;
      enabled: boolean;
    }>(
      environment
        ? 'select * from tenant_feature_flags where tenant_id = $1::uuid and environment = $2'
        : 'select * from tenant_feature_flags where tenant_id = $1::uuid',
      environment ? [tenantId, environment] : [tenantId],
    );
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      environment: row.environment,
      flagKey: row.flag_key,
      enabled: row.enabled,
    }));
  }

  async createSupportCase(input: Omit<TenantSupportCase, 'id'>): Promise<TenantSupportCase> {
    assertNoPii(input, 'control-plane.tenant_support_cases');
    const result = await this.db.query<{ id: string }>(
      `insert into tenant_support_cases (tenant_id, title, category, severity, status, description_no_pii, error_code)
       values ($1::uuid, $2, $3, $4, $5, $6, $7) returning id`,
      [
        input.tenantId,
        input.title,
        input.category,
        input.severity,
        input.status,
        input.descriptionNoPii,
        input.errorCode ?? null,
      ],
    );
    return { ...input, id: result.rows[0]!.id };
  }

  async listSupportCases(tenantId: string): Promise<TenantSupportCase[]> {
    const result = await this.db.query<{
      id: string;
      tenant_id: string;
      title: string;
      category: TenantSupportCase['category'];
      severity: TenantSupportCase['severity'];
      status: TenantSupportCase['status'];
      description_no_pii: string;
      error_code: string | null;
    }>('select * from tenant_support_cases where tenant_id = $1::uuid order by created_at', [
      tenantId,
    ]);
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      category: row.category,
      severity: row.severity,
      status: row.status,
      descriptionNoPii: row.description_no_pii,
      ...(row.error_code !== null ? { errorCode: row.error_code } : {}),
    }));
  }

  async setReadinessGate(input: TenantReadinessGate): Promise<TenantReadinessGate> {
    assertNoPii(input, 'control-plane.tenant_production_readiness');
    await this.db.query(
      `insert into tenant_production_readiness (tenant_id, gate_id, gate_name, required, status, evidence_reference)
       values ($1::uuid, $2, $3, $4, $5, $6)
       on conflict (tenant_id, gate_id) do update
         set gate_name = excluded.gate_name,
             required = excluded.required,
             status = excluded.status,
             evidence_reference = excluded.evidence_reference,
             updated_at = now()`,
      [
        input.tenantId,
        input.gateId,
        input.gateName,
        input.required,
        input.status,
        input.evidenceReference ?? null,
      ],
    );
    return input;
  }

  async listReadinessGates(tenantId: string): Promise<TenantReadinessGate[]> {
    const result = await this.db.query<{
      tenant_id: string;
      gate_id: string;
      gate_name: string;
      required: boolean;
      status: TenantReadinessGate['status'];
      evidence_reference: string | null;
    }>('select * from tenant_production_readiness where tenant_id = $1::uuid order by gate_id', [
      tenantId,
    ]);
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      gateId: row.gate_id,
      gateName: row.gate_name,
      required: row.required,
      status: row.status,
      ...(row.evidence_reference !== null ? { evidenceReference: row.evidence_reference } : {}),
    }));
  }

  async recordHealthCheck(input: TenantHealthCheck): Promise<TenantHealthCheck> {
    assertNoPii(input, 'control-plane.tenant_health_checks');
    await this.db.query(
      `insert into tenant_health_checks (tenant_id, environment, check_id, status, latency_ms, error_code, checked_at)
       values ($1::uuid, $2, $3, $4, $5, $6, $7)`,
      [
        input.tenantId,
        input.environment,
        input.checkId,
        input.status,
        input.latencyMs ?? null,
        input.errorCode ?? null,
        input.checkedAt,
      ],
    );
    return input;
  }

  async listHealthChecks(tenantId: string): Promise<TenantHealthCheck[]> {
    const result = await this.db.query<{
      tenant_id: string;
      environment: EnvironmentName;
      check_id: string;
      status: TenantHealthCheck['status'];
      latency_ms: number | null;
      error_code: string | null;
      checked_at: Date;
    }>('select * from tenant_health_checks where tenant_id = $1::uuid order by checked_at', [
      tenantId,
    ]);
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      environment: row.environment,
      checkId: row.check_id,
      status: row.status,
      ...(row.latency_ms !== null ? { latencyMs: row.latency_ms } : {}),
      ...(row.error_code !== null ? { errorCode: row.error_code } : {}),
      checkedAt: row.checked_at.toISOString(),
    }));
  }

  async setReleaseStatus(input: TenantReleaseStatus): Promise<TenantReleaseStatus> {
    assertNoPii(input, 'control-plane.tenant_release_status');
    await this.db.query(
      `insert into tenant_release_status (tenant_id, environment, current_version, target_version, status)
       values ($1::uuid, $2, $3, $4, $5)
       on conflict (tenant_id, environment) do update
         set current_version = excluded.current_version,
             target_version = excluded.target_version,
             status = excluded.status,
             updated_at = now()`,
      [
        input.tenantId,
        input.environment,
        input.currentVersion ?? null,
        input.targetVersion ?? null,
        input.status,
      ],
    );
    return input;
  }

  async listReleaseStatuses(tenantId: string): Promise<TenantReleaseStatus[]> {
    const result = await this.db.query<{
      tenant_id: string;
      environment: EnvironmentName;
      current_version: string | null;
      target_version: string | null;
      status: TenantReleaseStatus['status'];
    }>('select * from tenant_release_status where tenant_id = $1::uuid order by environment', [
      tenantId,
    ]);
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      environment: row.environment,
      ...(row.current_version !== null ? { currentVersion: row.current_version } : {}),
      ...(row.target_version !== null ? { targetVersion: row.target_version } : {}),
      status: row.status,
    }));
  }

  async saveProvisioningRun(run: ProvisioningRun): Promise<ProvisioningRun> {
    assertNoPii(run, 'control-plane.tenant_provisioning_runs');
    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `insert into tenant_provisioning_runs (id, tenant_id, target_environments, modules, status, started_at, finished_at)
         values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
         on conflict (id) do update
           set status = excluded.status, finished_at = excluded.finished_at`,
        [
          run.id,
          run.tenantId,
          run.targetEnvironments,
          run.modules,
          run.status,
          run.startedAt,
          run.finishedAt ?? null,
        ],
      );
      for (const [index, step] of run.steps.entries()) {
        await tx.query(
          `insert into tenant_provisioning_steps (run_id, step_id, step_name, step_order, status, note_no_pii, finished_at)
           values ($1::uuid, $2, $3, $4, $5, $6, $7)
           on conflict (run_id, step_id) do update
             set status = excluded.status,
                 note_no_pii = excluded.note_no_pii,
                 finished_at = excluded.finished_at`,
          [
            run.id,
            step.id,
            step.name,
            index,
            step.status,
            step.noteNoPii ?? null,
            step.finishedAt ?? null,
          ],
        );
      }
    });
    return run;
  }

  async getProvisioningRun(runId: string): Promise<ProvisioningRun | undefined> {
    const runs = await this.loadRuns('r.id = $1::uuid', [runId]);
    return runs[0];
  }

  async listProvisioningRuns(tenantId: string): Promise<ProvisioningRun[]> {
    return this.loadRuns('r.tenant_id = $1::uuid', [tenantId]);
  }

  private async loadRuns(where: string, params: unknown[]): Promise<ProvisioningRun[]> {
    const runResult = await this.db.query<{
      id: string;
      tenant_id: string;
      target_environments: EnvironmentName[];
      modules: ModuleId[];
      status: ProvisioningRun['status'];
      started_at: Date;
      finished_at: Date | null;
    }>(`select * from tenant_provisioning_runs r where ${where} order by started_at`, params);
    if (runResult.rows.length === 0) return [];

    const runIds = runResult.rows.map((r) => r.id);
    const stepResult = await this.db.query<{
      run_id: string;
      step_id: ProvisioningStepId;
      step_name: string;
      step_order: number;
      status: ProvisioningStep['status'];
      note_no_pii: string | null;
      finished_at: Date | null;
    }>(
      `select * from tenant_provisioning_steps where run_id = any($1::uuid[]) order by step_order`,
      [runIds],
    );

    return runResult.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      targetEnvironments: row.target_environments,
      modules: row.modules,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      ...(row.finished_at !== null ? { finishedAt: row.finished_at.toISOString() } : {}),
      steps: stepResult.rows
        .filter((s) => s.run_id === row.id)
        .map((s) => ({
          id: s.step_id,
          name: s.step_name,
          status: s.status,
          ...(s.note_no_pii !== null ? { noteNoPii: s.note_no_pii } : {}),
          ...(s.finished_at !== null ? { finishedAt: s.finished_at.toISOString() } : {}),
        })),
    }));
  }
}
