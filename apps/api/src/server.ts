import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  authorize,
  createBreakGlassSession,
  createSupportSession,
  SupportSessionError,
  type AccessSubject,
  type PermissionKey,
} from '@ubm-klar/access-control';
import { AuditLogger, InMemoryAuditSink } from '@ubm-klar/audit';
import {
  DataAccessLogger,
  InMemoryDataAccessSink,
  sanitizeTechnicalLogEvent,
} from '@ubm-klar/data-access-log';
import { evaluateReveal } from '@ubm-klar/internal-secrecy';
import {
  TenantResolver,
  UnknownTenantDomainError,
  ForbiddenTenantDomainError,
  UnverifiedTenantDomainError,
  type TenantDirectory,
} from '@ubm-klar/tenant-resolver';
import { evaluateUbmEligibility, type UbmEligibilityInput } from '@ubm-klar/ubm-eligibility-engine';
import { RuleEngine } from '@ubm-klar/rule-engine';
import { ALL_LSS_RULES, buildLssDashboard, generateLssDemoData, type LssRuleContext } from '@ubm-klar/lss-domain';
import {
  ALL_EA_RULES,
  buildEaDashboard,
  generateEaDemoData,
  type EaRuleContext,
} from '@ubm-klar/economic-assistance-domain';
import type { DataClass, SafeTenantConfig } from '@ubm-klar/shared-types';

/**
 * UBM Klar backend API. All sensitive operations run here, server-side:
 * - every request is tenant-resolved (strict, fail-closed) from the Host header
 * - every domain route authorizes via RBAC+ABAC+need-to-know before touching data
 * - all data access is logged; sensitive reveals require a recorded reason
 * - service-role credentials never leave this process
 */
export interface ApiServerOptions {
  directory: TenantDirectory;
  /** Demo mode allows localhost with a synthetic demo tenant (never in prod). */
  allowDemoTenant?: boolean;
}

export interface AuthenticatedContext {
  subject: AccessSubject;
  tenant: SafeTenantConfig;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: SafeTenantConfig | undefined;
    subject?: AccessSubject | undefined;
  }
}

const DEMO_TENANT: SafeTenantConfig = Object.freeze({
  tenantId: 'demo-tenant',
  tenantSlug: 'demo',
  municipalityName: 'Demokommun',
  deploymentMode: 'local_demo_shared',
  environment: 'demo',
  activeModules: [
    'platform_foundation',
    'municipal_data_plane',
    'ubm_readiness',
    'payment_control',
    'lss',
    'economic_assistance',
    'import_gateway',
    'document_vault',
    'data_quality',
    'control_cases',
    'compliance_legal',
    'cybersecurity',
    'archive',
    'accessibility',
  ],
  dataPlaneUrl: 'http://localhost:54321',
  dataPlanePublishableKey: 'sb_publishable_demo',
  authProvider: 'supabase_auth',
  featureFlags: {},
} satisfies SafeTenantConfig);

function parseSubject(request: FastifyRequest): AccessSubject | undefined {
  // In production the subject is built from the verified SSO token (Entra/SAML/OIDC).
  // For tests/demo the claims arrive via signed headers from the auth proxy.
  const userId = request.headers['x-user-id'];
  if (typeof userId !== 'string' || userId.length === 0) return undefined;
  const roles = String(request.headers['x-roles'] ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  const sessionKind = (request.headers['x-session-kind'] as AccessSubject['sessionKind']) ?? 'normal';
  const expiresHeader = request.headers['x-session-expires-at'];
  return {
    userId,
    roles: roles as AccessSubject['roles'],
    departmentIds: String(request.headers['x-departments'] ?? '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean),
    unitIds: [],
    committeeIds: [],
    assignedCaseIds: String(request.headers['x-assigned-cases'] ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
    sessionKind,
    ...(typeof expiresHeader === 'string' && expiresHeader
      ? { sessionExpiresAt: Number(expiresHeader) }
      : {}),
  };
}

export function buildApiServer(options: ApiServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, disableRequestLogging: true });
  const resolver = new TenantResolver({ directory: options.directory });
  const auditLogger = new AuditLogger(new InMemoryAuditSink());
  const accessLogger = new DataAccessLogger(new InMemoryDataAccessSink());

  // --- Tenant resolution: strict, fail-closed -------------------------------
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    const host = request.headers.host ?? '';
    if (options.allowDemoTenant && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
      request.tenant = DEMO_TENANT;
    } else {
      try {
        request.tenant = await resolver.resolve(host);
      } catch (error) {
        if (
          error instanceof UnknownTenantDomainError ||
          error instanceof ForbiddenTenantDomainError ||
          error instanceof UnverifiedTenantDomainError
        ) {
          return reply.status(421).send({ error: 'unknown_tenant', message: 'Okänd domän.' });
        }
        throw error;
      }
    }
    request.subject = parseSubject(request);
  });

  function requirePermission(
    request: FastifyRequest,
    reply: FastifyReply,
    permission: PermissionKey,
    resource: Parameters<typeof authorize>[2] = { kind: 'api' },
    reason?: string,
  ): boolean {
    if (!request.subject) {
      reply.status(401).send({ error: 'unauthenticated', message: 'Inloggning krävs.' });
      return false;
    }
    const decision = authorize(request.subject, permission, resource, {
      enabledModules: request.tenant?.activeModules ?? [],
      ...(reason !== undefined ? { reason } : {}),
    });
    if (!decision.allowed) {
      void auditLogger.record({
        eventKey: 'case.open',
        actorUserId: request.subject.userId,
        action: `denied:${permission}`,
        outcome: 'denied',
        context: { reasons: decision.reasons },
      });
      reply.status(403).send({
        error: 'forbidden',
        message: 'Du saknar behörighet för den här åtgärden.',
        reasons: decision.reasons,
      });
      return false;
    }
    return true;
  }

  app.get('/health', async () => ({ service: 'api', status: 'ok', piiSafe: true }));

  app.get('/tenant', async (request) => ({
    municipality: request.tenant?.municipalityName,
    environment: request.tenant?.environment,
    modules: request.tenant?.activeModules,
    // publishable key only; service keys never leave the backend process
    dataPlanePublishableKey: request.tenant?.dataPlanePublishableKey,
  }));

  // --- Dashboards ------------------------------------------------------------
  const lssDemo = generateLssDemoData({
    personCount: 100,
    decisionCount: 200,
    providerCount: 20,
    timeReportCount: 400,
    invoiceCount: 300,
    paymentCount: 600,
    recoveryClaimCount: 10,
    ubmRequestCount: 5,
  });
  const eaDemo = generateEaDemoData({
    personCount: 200,
    householdCount: 120,
    applicationCount: 300,
    decisionCount: 300,
    incomeCount: 400,
    housingCount: 150,
    paymentCount: 400,
    recoveryClaimCount: 15,
  });
  const lssEngine = new RuleEngine<LssRuleContext>();
  lssEngine.registerAll(ALL_LSS_RULES);
  const eaEngine = new RuleEngine<EaRuleContext>();
  eaEngine.registerAll(ALL_EA_RULES);

  app.get('/dashboards/lss', async (request, reply) => {
    if (!requirePermission(request, reply, 'case.lss.read', { kind: 'dashboard', module: 'lss' }))
      return;
    const { flags } = lssEngine.run(lssDemo.context);
    return buildLssDashboard(lssDemo.context, flags);
  });

  app.get('/dashboards/economic-assistance', async (request, reply) => {
    if (
      !requirePermission(request, reply, 'case.ea.read', {
        kind: 'dashboard',
        module: 'economic_assistance',
      })
    )
      return;
    const { flags } = eaEngine.run(eaDemo.context);
    return buildEaDashboard(eaDemo.context, flags);
  });

  // --- UBM eligibility -------------------------------------------------------
  app.post<{ Body: UbmEligibilityInput }>('/ubm/eligibility', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.proposal.create', { kind: 'ubm_eligibility' }))
      return;
    const decision = evaluateUbmEligibility(request.body);
    await auditLogger.record({
      eventKey: 'export.proposal_created',
      actorUserId: request.subject!.userId,
      action: 'eligibility_evaluated',
      context: { outcome: decision.outcome },
    });
    return decision;
  });

  // --- Sensitive field reveal (reason-required, always logged) ---------------
  app.post<{
    Body: {
      entityKind: string;
      entityId: string;
      fieldKey: string;
      dataClass: DataClass;
      reason?: string;
    };
  }>('/persons/reveal-field', async (request, reply) => {
    const body = request.body;
    if (
      !requirePermission(
        request,
        reply,
        'person.sensitive_field.reveal',
        { kind: 'person_field', dataClasses: [body.dataClass] },
        body.reason,
      )
    )
      return;
    const decision = evaluateReveal({
      userId: request.subject!.userId,
      entityKind: body.entityKind,
      entityId: body.entityId,
      fieldKey: body.fieldKey,
      dataClass: body.dataClass,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    });
    if (!decision.allowed) {
      return reply.status(422).send({ error: 'reason_required', message: decision.error });
    }
    await accessLogger.record({
      actorUserId: request.subject!.userId,
      accessKind: 'sensitive_field_reveal',
      fieldKey: body.fieldKey,
      reason: body.reason!,
      sessionKind: request.subject!.sessionKind,
    });
    return { revealed: true, logged: true };
  });

  // --- Support without PII ----------------------------------------------------
  app.get('/support/technical-status', async (request, reply) => {
    if (!requirePermission(request, reply, 'support.technical_status.read', { kind: 'support' }))
      return;
    // Only no-PII technical data; sanitize defensively before returning.
    return sanitizeTechnicalLogEvent({
      level: 'info',
      code: 'TECH_STATUS',
      message: 'technical status snapshot',
      context: {
        release: '1.0.0',
        queueDepth: 0,
        lastMigration: '202607070030_recurring_ubm_reporting_2029.sql',
        importBatchesLast24h: 0,
        apiStatus: 'ok',
        workerStatus: 'ok',
      },
    });
  });

  app.post<{
    Body: {
      supportCaseReference: string;
      approvedByMunicipalityUser?: string;
      scope:
        | 'technical_status'
        | 'import_status'
        | 'integration_status'
        | 'queue_status'
        | 'schema_errors'
        | 'logs_no_pii';
      reason: string;
      requestedDurationMs: number;
    };
  }>('/support/jit-sessions', async (request, reply) => {
    if (!request.subject) {
      return reply.status(401).send({ error: 'unauthenticated' });
    }
    try {
      const session = createSupportSession({
        ...request.body,
        requestedBySupportUser: request.subject.userId,
      });
      await auditLogger.record({
        eventKey: 'support.access',
        actorUserId: request.subject.userId,
        action: 'jit_session_created',
        reason: request.body.reason,
      });
      return reply.status(201).send(session);
    } catch (error) {
      if (error instanceof SupportSessionError) {
        return reply.status(422).send({ error: 'support_session_rejected', message: error.message });
      }
      throw error;
    }
  });

  // --- Break-glass -------------------------------------------------------------
  app.post<{
    Body: { reason: string; incidentReference?: string; requestedDurationMs: number };
  }>('/break-glass/sessions', async (request, reply) => {
    if (!request.subject) return reply.status(401).send({ error: 'unauthenticated' });
    try {
      const session = createBreakGlassSession({
        initiatedBy: request.subject.userId,
        hasBreakGlassRole: request.subject.roles.includes('break_glass_admin'),
        reason: request.body.reason,
        ...(request.body.incidentReference !== undefined
          ? { incidentReference: request.body.incidentReference }
          : {}),
        requestedDurationMs: request.body.requestedDurationMs,
      });
      await auditLogger.record({
        eventKey: 'break_glass.session',
        actorUserId: request.subject.userId,
        action: 'session_created',
        reason: request.body.reason,
      });
      return reply.status(201).send(session);
    } catch (error) {
      if (error instanceof SupportSessionError) {
        return reply.status(422).send({ error: 'break_glass_rejected', message: error.message });
      }
      throw error;
    }
  });

  return app;
}
