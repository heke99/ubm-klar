import Fastify, { type FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { PiiLeakError, scanForPii } from '@ubm-klar/config';
import {
  validateTenantDomain,
  type DeploymentMode,
  type EnvironmentName,
  type ModuleId,
} from '@ubm-klar/shared-types';
import type { ControlPlaneStore } from './store';
import type { TenantAuthProvider, TenantStatus } from './types';
import {
  ProvisioningNotFoundError,
  ProvisioningOrderError,
  ProvisioningService,
  type ProvisioningPlanInput,
} from './provisioning';

export interface ControlPlaneServerOptions {
  store: ControlPlaneStore;
  /**
   * Bearer token required on every route except /health. Mandatory in
   * stage/prod (enforced by loadAppConfig); optional for local/test where the
   * API may run open on localhost.
   */
  adminToken?: string;
  /**
   * Scope-limited token for the API/web tenant resolver: grants access to
   * /directory/* lookups only (least privilege — the API never holds the
   * admin token).
   */
  directoryToken?: string;
}

function tokenMatches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * No-PII vendor control plane API.
 *
 * Every request body is scanned for PII before any handler runs; anything that looks
 * like personal data is rejected with 422 and never persisted or logged.
 */
export function buildControlPlaneServer(options: ControlPlaneServerOptions): FastifyInstance {
  const { store, adminToken, directoryToken } = options;
  const app = Fastify({
    logger: false,
    // Never echo request bodies into errors/logs; bodies may be rejected PII attempts.
    disableRequestLogging: true,
  });
  const provisioning = new ProvisioningService(store);

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url === '/ready') return;
    if (!adminToken) return;
    const header = request.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!presented) return reply.status(401).send({ error: 'unauthorized' });
    if (tokenMatches(adminToken, presented)) return;
    // Directory token grants read access to /directory/* lookups only.
    if (
      directoryToken &&
      request.url.startsWith('/directory/') &&
      tokenMatches(directoryToken, presented)
    ) {
      return;
    }
    return reply.status(401).send({ error: 'unauthorized' });
  });

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
    const tenant = await store.createTenant({
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
    const tenant = await store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    return tenant;
  });

  app.patch<{ Params: { tenantId: string }; Body: { status: TenantStatus } }>(
    '/tenants/:tenantId/status',
    async (request, reply) => {
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.updateTenantStatus(tenant.id, request.body.status);
    },
  );

  app.post<{
    Params: { tenantId: string };
    Body: { domain: string; environment: EnvironmentName };
  }>('/tenants/:tenantId/domains', async (request, reply) => {
    const tenant = await store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    const validation = validateTenantDomain(request.body.domain);
    if (!validation.valid) {
      return reply.status(400).send({ error: 'forbidden_domain', reason: validation.reason });
    }
    const domain = await store.addDomain({
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
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.listDomains(tenant.id);
    },
  );

  app.post<{ Params: { tenantId: string; domainId: string } }>(
    '/tenants/:tenantId/domains/:domainId/verify',
    async (request, reply) => {
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      const domains = await store.listDomains(tenant.id);
      if (!domains.some((d) => d.id === request.params.domainId)) {
        return reply.status(404).send({ error: 'domain_not_found' });
      }
      return store.verifyDomain(request.params.domainId);
    },
  );

  /**
   * Tenant directory lookup used by the API's tenant resolver. Returns the safe,
   * non-secret configuration for a VERIFIED domain — unknown or unverified
   * domains return 404 so the resolver fails closed.
   */
  app.get<{ Params: { domain: string } }>('/directory/domains/:domain', async (request, reply) => {
    const domain = await store.findDomain(request.params.domain.toLowerCase());
    if (!domain || !domain.verified) {
      return reply.status(404).send({ error: 'domain_not_found' });
    }
    const tenant = await store.getTenant(domain.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    const environments = await store.listEnvironments(tenant.id);
    const environment = environments.find((e) => e.environment === domain.environment);
    const modules = await store.listModules(tenant.id);
    const authProviders = await store.listAuthProviders(tenant.id);
    const primaryAuth = authProviders.find(
      (p) => p.environment === domain.environment && p.isPrimary,
    );
    const flags = await store.listFeatureFlags(tenant.id, domain.environment);
    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      municipalityName: tenant.municipalityName,
      deploymentMode: tenant.deploymentMode,
      tenantStatus: tenant.status,
      domain: domain.domain,
      environment: domain.environment,
      verified: domain.verified,
      dataPlaneUrl: environment?.dataPlaneUrl ?? '',
      publishableKeyReference: environment?.publishableKeyReference ?? '',
      activeModules: modules.filter((m) => m.enabled).map((m) => m.moduleId),
      authProvider: primaryAuth?.providerKind ?? 'entra_id',
      featureFlags: Object.fromEntries(flags.map((f) => [f.flagKey, f.enabled])),
    };
  });

  app.put<{
    Params: { tenantId: string };
    Body: { environment: EnvironmentName; dataPlaneUrl: string; publishableKeyReference?: string };
  }>('/tenants/:tenantId/environments', async (request, reply) => {
    const tenant = await store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    const body = request.body;
    if (/service_role|secret/i.test(body.publishableKeyReference ?? '')) {
      return reply.status(400).send({
        error: 'secret_reference_rejected',
        message: 'Service-role/secret key references must never be stored in the control plane.',
      });
    }
    const env = await store.upsertEnvironment({
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

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/environments',
    async (request, reply) => {
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.listEnvironments(tenant.id);
    },
  );

  app.put<{ Params: { tenantId: string }; Body: { moduleId: ModuleId; enabled: boolean } }>(
    '/tenants/:tenantId/modules',
    async (request, reply) => {
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.setModule({
        tenantId: tenant.id,
        moduleId: request.body.moduleId,
        enabled: request.body.enabled,
      });
    },
  );

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/modules',
    async (request, reply) => {
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.listModules(tenant.id);
    },
  );

  app.put<{
    Params: { tenantId: string };
    Body: {
      environment: EnvironmentName;
      providerKind: TenantAuthProvider['providerKind'];
      isPrimary: boolean;
      issuerUrl?: string;
      status: TenantAuthProvider['status'];
    };
  }>('/tenants/:tenantId/auth-providers', async (request, reply) => {
    const tenant = await store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    const body = request.body;
    if (/service_role|client_secret|password/i.test(body.issuerUrl ?? '')) {
      return reply.status(400).send({ error: 'secret_reference_rejected' });
    }
    return store.setAuthProvider({
      tenantId: tenant.id,
      environment: body.environment,
      providerKind: body.providerKind,
      isPrimary: body.isPrimary,
      ...(body.issuerUrl !== undefined ? { issuerUrl: body.issuerUrl } : {}),
      status: body.status,
    });
  });

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/auth-providers',
    async (request, reply) => {
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.listAuthProviders(tenant.id);
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
    const tenant = await store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    const body = request.body;
    const supportCase = await store.createSupportCase({
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
      const tenant = await store.getTenant(request.params.tenantId);
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
    const tenant = await store.getTenant(request.params.tenantId);
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
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.listReadinessGates(tenant.id);
    },
  );

  /**
   * Pilot/production approval flags. Approvals are stored as readiness gates so
   * they participate in the same audit/evidence flow as every other gate, and
   * the computed status can never bypass required gates.
   */
  app.put<{
    Params: { tenantId: string };
    Body: { kind: 'pilot' | 'production'; approved: boolean; approverId: string; reason: string };
  }>('/tenants/:tenantId/approvals', async (request, reply) => {
    const tenant = await store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    const { kind, approved, approverId, reason } = request.body;
    if (!approverId || !reason) {
      return reply.status(400).send({ error: 'approver_and_reason_required' });
    }
    const gate = await store.setReadinessGate({
      tenantId: tenant.id,
      gateId: kind === 'pilot' ? 'pilot_approval' : 'production_approval',
      gateName: kind === 'pilot' ? 'Pilot approval' : 'Production approval',
      required: true,
      status: approved ? 'passed' : 'failed',
      evidenceReference: `approver:${approverId} reason:${reason}`,
    });
    if (kind === 'pilot' && approved && tenant.status === 'onboarding') {
      await store.updateTenantStatus(tenant.id, 'pilot');
    }
    return gate;
  });

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/approvals',
    async (request, reply) => {
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      const gates = await store.listReadinessGates(tenant.id);
      const pilotGate = gates.find((g) => g.gateId === 'pilot_approval');
      const productionGate = gates.find((g) => g.gateId === 'production_approval');
      const requiredGates = gates.filter((g) => g.required);
      const openRequired = requiredGates.filter(
        (g) => g.status !== 'passed' && g.status !== 'waived',
      );
      return {
        tenantStatus: tenant.status,
        pilotApproved: pilotGate?.status === 'passed',
        productionApproved: productionGate?.status === 'passed',
        productionAllowed: productionGate?.status === 'passed' && openRequired.length === 0,
        openRequiredGates: openRequired.map((g) => g.gateId),
      };
    },
  );

  app.put<{
    Params: { tenantId: string };
    Body: { environment: EnvironmentName; flagKey: string; enabled: boolean };
  }>('/tenants/:tenantId/feature-flags', async (request, reply) => {
    const tenant = await store.getTenant(request.params.tenantId);
    if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
    return store.setFeatureFlag({ tenantId: tenant.id, ...request.body });
  });

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/feature-flags',
    async (request, reply) => {
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      return store.listFeatureFlags(tenant.id);
    },
  );

  app.post<{ Params: { tenantId: string }; Body: ProvisioningPlanInput }>(
    '/tenants/:tenantId/provisioning-runs',
    async (request, reply) => {
      const tenant = await store.getTenant(request.params.tenantId);
      if (!tenant) return reply.status(404).send({ error: 'tenant_not_found' });
      const run = await provisioning.startRun(tenant, request.body);
      return reply.status(201).send(run);
    },
  );

  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/provisioning-runs',
    async (request, reply) => {
      const tenant = await store.getTenant(request.params.tenantId);
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
        const run = await provisioning.completeStep(
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
