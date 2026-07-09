import Fastify, { type FastifyInstance } from 'fastify';
import { PiiLeakError, scanForPii } from '@ubm-klar/config';
import {
  validateTenantDomain,
  type DeploymentMode,
  type EnvironmentName,
  type ModuleId,
} from '@ubm-klar/shared-types';
import type { ControlPlaneStore } from './store';
import type { TenantStatus } from './types';
import {
  ProvisioningNotFoundError,
  ProvisioningOrderError,
  ProvisioningService,
  type ProvisioningPlanInput,
} from './provisioning';

export interface ControlPlaneServerOptions {
  store: ControlPlaneStore;
}

/**
 * No-PII vendor control plane API.
 *
 * Every request body is scanned for PII before any handler runs; anything that looks
 * like personal data is rejected with 422 and never persisted or logged.
 */
export function buildControlPlaneServer(options: ControlPlaneServerOptions): FastifyInstance {
  const { store } = options;
  const app = Fastify({
    logger: false,
    // Never echo request bodies into errors/logs; bodies may be rejected PII attempts.
    disableRequestLogging: true,
  });
  const provisioning = new ProvisioningService(store);

  app.addHook('preValidation', async (request, reply) => {
    if (request.body !== undefined && request.body !== null) {
      const result = scanForPii(request.body, 'request.body');
      if (!result.clean) {
        return reply.status(422).send({
          error: 'pii_rejected',
          message: 'The control plane refuses payloads containing personal data.',
          violations: result.violations,
        });
      }
    }
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof PiiLeakError) {
      return reply.status(422).send({ error: 'pii_rejected', violations: error.violations });
    }
    const message = error instanceof Error ? error.message : 'unknown error';
    return reply.status(500).send({ error: 'internal_error', message });
  });

  app.get('/health', async () => ({ service: 'control-plane', status: 'ok', piiSafe: true }));

  app.post<{
    Body: {
      slug: string;
      municipalityName: string;
      organizationNumber: string;
      deploymentMode: DeploymentMode;
    };
  }>('/tenants', async (request, reply) => {
    const { slug, municipalityName, organizationNumber, deploymentMode } = request.body;
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      return reply.status(400).send({ error: 'invalid_slug' });
    }
    if (!/^\d{6}-\d{4}$/.test(organizationNumber)) {
      return reply.status(400).send({ error: 'invalid_organization_number' });
    }
    const tenant = store.createTenant({
      slug,
      municipalityName,
      organizationNumber,
      deploymentMode,
      status: 'prospect',
    });
    return reply.status(201).send(tenant);
  });

  app.get('/tenants', async () => store.listTenants());

  app.get<{ Params: { tenantId: string } }>('/tenants/:tenantId', async (request, reply) => {
    const tenant = store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    return tenant;
  });

  app.patch<{ Params: { tenantId: string }; Body: { status: TenantStatus } }>(
    '/tenants/:tenantId/status',
    async (request, reply) => {
      const tenant = store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.updateTenantStatus(tenant.id, request.body.status);
    },
  );

  app.post<{
    Params: { tenantId: string };
    Body: { domain: string; environment: EnvironmentName };
  }>('/tenants/:tenantId/domains', async (request, reply) => {
    const tenant = store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    const validation = validateTenantDomain(request.body.domain);
    if (!validation.valid) {
      return reply.status(400).send({ error: 'forbidden_domain', reason: validation.reason });
    }
    const domain = store.addDomain({
      tenantId: tenant.id,
      domain: request.body.domain.toLowerCase(),
      environment: request.body.environment,
      domainModel: validation.domainModel,
      verified: false,
    });
    return reply.status(201).send(domain);
  });

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/domains',
    async (request, reply) => {
      const tenant = store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.listDomains(tenant.id);
    },
  );

  app.put<{
    Params: { tenantId: string };
    Body: { environment: EnvironmentName; dataPlaneUrl: string; publishableKeyReference?: string };
  }>('/tenants/:tenantId/environments', async (request, reply) => {
    const tenant = store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    const body = request.body;
    if (/service_role|secret/i.test(body.publishableKeyReference ?? '')) {
      return reply.status(400).send({
        error: 'secret_reference_rejected',
        message: 'Service-role/secret key references must never be stored in the control plane.',
      });
    }
    const env = store.upsertEnvironment({
      tenantId: tenant.id,
      environment: body.environment,
      dataPlaneUrl: body.dataPlaneUrl,
      status: 'provisioning',
      ...(body.publishableKeyReference !== undefined
        ? { publishableKeyReference: body.publishableKeyReference }
        : {}),
    });
    return reply.status(200).send(env);
  });

  app.put<{ Params: { tenantId: string }; Body: { moduleId: ModuleId; enabled: boolean } }>(
    '/tenants/:tenantId/modules',
    async (request, reply) => {
      const tenant = store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.setModule({
        tenantId: tenant.id,
        moduleId: request.body.moduleId,
        enabled: request.body.enabled,
      });
    },
  );

  app.post<{
    Params: { tenantId: string };
    Body: {
      title: string;
      category: 'technical' | 'import' | 'integration' | 'release' | 'access' | 'billing' | 'other';
      severity: 'low' | 'medium' | 'high' | 'critical';
      descriptionNoPii: string;
      errorCode?: string;
    };
  }>('/tenants/:tenantId/support-cases', async (request, reply) => {
    const tenant = store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    const body = request.body;
    const supportCase = store.createSupportCase({
      tenantId: tenant.id,
      title: body.title,
      category: body.category,
      severity: body.severity,
      status: 'open',
      descriptionNoPii: body.descriptionNoPii,
      ...(body.errorCode !== undefined ? { errorCode: body.errorCode } : {}),
    });
    return reply.status(201).send(supportCase);
  });

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/support-cases',
    async (request, reply) => {
      const tenant = store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.listSupportCases(tenant.id);
    },
  );

  app.put<{
    Params: { tenantId: string };
    Body: {
      gateId: string;
      gateName: string;
      required: boolean;
      status: 'not_started' | 'in_progress' | 'passed' | 'failed' | 'waived';
      evidenceReference?: string;
    };
  }>('/tenants/:tenantId/readiness-gates', async (request, reply) => {
    const tenant = store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    const body = request.body;
    return store.setReadinessGate({
      tenantId: tenant.id,
      gateId: body.gateId,
      gateName: body.gateName,
      required: body.required,
      status: body.status,
      ...(body.evidenceReference !== undefined
        ? { evidenceReference: body.evidenceReference }
        : {}),
    });
  });

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/readiness-gates',
    async (request, reply) => {
      const tenant = store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.listReadinessGates(tenant.id);
    },
  );

  app.put<{
    Params: { tenantId: string };
    Body: { environment: EnvironmentName; flagKey: string; enabled: boolean };
  }>('/tenants/:tenantId/feature-flags', async (request, reply) => {
    const tenant = store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    return store.setFeatureFlag({ tenantId: tenant.id, ...request.body });
  });

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/feature-flags',
    async (request, reply) => {
      const tenant = store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.listFeatureFlags(tenant.id);
    },
  );

  app.post<{ Params: { tenantId: string }; Body: ProvisioningPlanInput }>(
    '/tenants/:tenantId/provisioning-runs',
    async (request, reply) => {
      const tenant = store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      const run = provisioning.startRun(tenant, request.body);
      return reply.status(201).send(run);
    },
  );

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/provisioning-runs',
    async (request, reply) => {
      const tenant = store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return provisioning.listRuns(tenant.id);
    },
  );

  app.post<{
    Params: { tenantId: string; runId: string; stepId: string };
    Body: { ok: boolean; noteNoPii?: string };
  }>(
    '/tenants/:tenantId/provisioning-runs/:runId/steps/:stepId/complete',
    async (request, reply) => {
      try {
        const run = provisioning.completeStep(
          request.params.runId,
          request.params.stepId,
          request.body.ok,
          request.body.noteNoPii,
        );
        return reply.send(run);
      } catch (error) {
        if (error instanceof ProvisioningNotFoundError) {
          return reply.status(404).send({ error: 'not_found', message: error.message });
        }
        if (error instanceof ProvisioningOrderError) {
          return reply.status(409).send({ error: 'step_order_violation', message: error.message });
        }
        throw error;
      }
    },
  );

  return app;
}
