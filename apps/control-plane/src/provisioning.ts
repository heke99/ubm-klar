import { randomUUID } from 'node:crypto';
import { assertNoPii } from '@ubm-klar/config';
import {
  isProductionCapableDeploymentMode,
  type EnvironmentName,
  type ModuleId,
} from '@ubm-klar/shared-types';
import type { ControlPlaneStore } from './store';
import type { ControlPlaneTenant } from './types';

/** The canonical 20-step provisioning flow for Model B and Model C tenants. */
export const PROVISIONING_STEP_DEFINITIONS = [
  { id: 'create_tenant', name: 'Create tenant in control plane' },
  { id: 'choose_deployment_mode', name: 'Choose deployment mode (Model B, C1, C2, C3)' },
  { id: 'choose_modules', name: 'Choose modules' },
  { id: 'create_or_connect_data_plane', name: 'Create or connect data plane' },
  { id: 'create_environments', name: 'Create test/stage/prod environments' },
  { id: 'configure_domains', name: 'Configure domains' },
  { id: 'verify_domains', name: 'Verify domains' },
  { id: 'configure_sso', name: 'Configure SSO' },
  { id: 'configure_storage_buckets', name: 'Configure storage buckets' },
  { id: 'apply_migrations', name: 'Apply migrations' },
  { id: 'seed_default_roles_rules', name: 'Seed default roles/rules only' },
  { id: 'create_demo_data', name: 'Create synthetic demo data (demo/test only, no real PII)' },
  { id: 'run_rls_tests', name: 'Run RLS tests' },
  { id: 'run_smoke_tests', name: 'Run smoke tests' },
  { id: 'configure_backups', name: 'Configure backups' },
  { id: 'run_restore_test', name: 'Run restore test' },
  { id: 'configure_siem_export', name: 'Configure SIEM export' },
  { id: 'configure_support_mode', name: 'Configure support mode (no PII)' },
  { id: 'run_readiness_gates', name: 'Run production readiness gates' },
  { id: 'approve_go_live', name: 'Approve go-live (maker-checker)' },
] as const;

export type ProvisioningStepId = (typeof PROVISIONING_STEP_DEFINITIONS)[number]['id'];

export interface ProvisioningStep {
  id: ProvisioningStepId;
  name: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  noteNoPii?: string;
  finishedAt?: string;
}

export interface ProvisioningRun {
  id: string;
  tenantId: string;
  targetEnvironments: EnvironmentName[];
  modules: ModuleId[];
  status: 'running' | 'succeeded' | 'failed';
  steps: ProvisioningStep[];
  startedAt: string;
  finishedAt?: string;
}

export interface ProvisioningPlanInput {
  targetEnvironments: EnvironmentName[];
  modules: ModuleId[];
}

export class ProvisioningNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningNotFoundError';
  }
}

export class ProvisioningOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningOrderError';
  }
}

export class ProvisioningService {
  constructor(private readonly store: ControlPlaneStore) {}

  async startRun(
    tenant: ControlPlaneTenant,
    input: ProvisioningPlanInput,
  ): Promise<ProvisioningRun> {
    assertNoPii(input, 'control-plane.provisioning');
    if (
      input.targetEnvironments.includes('prod') &&
      !isProductionCapableDeploymentMode(tenant.deploymentMode)
    ) {
      throw new Error(
        `Deployment mode ${tenant.deploymentMode} cannot be provisioned to prod. ` +
          'Shared databases are allowed only for local development and demo.',
      );
    }
    const run: ProvisioningRun = {
      id: randomUUID(),
      tenantId: tenant.id,
      targetEnvironments: input.targetEnvironments,
      modules: input.modules,
      status: 'running',
      steps: PROVISIONING_STEP_DEFINITIONS.map((def) => ({
        id: def.id,
        name: def.name,
        status: 'pending',
      })),
      startedAt: new Date().toISOString(),
    };
    // Step 1 is completed by definition: the tenant exists in the control plane.
    this.markStep(run, 'create_tenant', 'succeeded');
    this.markStep(run, 'choose_deployment_mode', 'succeeded');
    for (const moduleId of input.modules) {
      await this.store.setModule({ tenantId: tenant.id, moduleId, enabled: true });
    }
    this.markStep(run, 'choose_modules', 'succeeded');
    await this.store.saveProvisioningRun(run);
    return run;
  }

  async getRun(runId: string): Promise<ProvisioningRun | undefined> {
    return this.store.getProvisioningRun(runId);
  }

  async listRuns(tenantId: string): Promise<ProvisioningRun[]> {
    return this.store.listProvisioningRuns(tenantId);
  }

  /**
   * Steps are completed by their executors (migration runner, smoke tests, humans for
   * go-live approval) and must be completed strictly in order.
   */
  async completeStep(
    runId: string,
    stepId: string,
    ok: boolean,
    noteNoPii?: string,
  ): Promise<ProvisioningRun> {
    const run = await this.store.getProvisioningRun(runId);
    if (!run) throw new ProvisioningNotFoundError(`Unknown provisioning run: ${runId}`);
    if (noteNoPii) assertNoPii({ noteNoPii }, 'control-plane.provisioning.step_note');

    const stepIndex = run.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) {
      throw new ProvisioningNotFoundError(`Unknown provisioning step: ${stepId}`);
    }
    const priorIncomplete = run.steps
      .slice(0, stepIndex)
      .find((s) => s.status !== 'succeeded' && s.status !== 'skipped');
    if (priorIncomplete) {
      throw new ProvisioningOrderError(
        `Cannot complete step "${stepId}" before "${priorIncomplete.id}" has succeeded`,
      );
    }

    const step = run.steps[stepIndex]!;
    step.status = ok ? 'succeeded' : 'failed';
    if (noteNoPii !== undefined) step.noteNoPii = noteNoPii;
    step.finishedAt = new Date().toISOString();

    if (!ok) {
      run.status = 'failed';
      run.finishedAt = new Date().toISOString();
    } else if (run.steps.every((s) => s.status === 'succeeded' || s.status === 'skipped')) {
      run.status = 'succeeded';
      run.finishedAt = new Date().toISOString();
    }
    await this.store.saveProvisioningRun(run);
    return run;
  }

  private markStep(
    run: ProvisioningRun,
    stepId: ProvisioningStepId,
    status: ProvisioningStep['status'],
  ) {
    const step = run.steps.find((s) => s.id === stepId);
    if (step) {
      step.status = status;
      step.finishedAt = new Date().toISOString();
    }
  }
}
