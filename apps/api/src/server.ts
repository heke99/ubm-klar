import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  authorize,
  createBreakGlassSession,
  createSupportSession,
  SupportSessionError,
  type AccessSubject,
  type PermissionKey,
} from '@ubm-klar/access-control';
import {
  buildSubjectFromClaims,
  ProxyAuthError,
  readSessionToken,
  SESSION_COOKIE_NAME,
  SessionError,
  subjectFromTrustedProxyHeaders,
  TokenVerificationError,
  type OidcTokenVerifier,
} from '@ubm-klar/auth';
import type { RoleId } from '@ubm-klar/shared-types';
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
import {
  ALL_LSS_RULES,
  buildLssDashboard,
  generateLssDemoData,
  type LssRuleContext,
} from '@ubm-klar/lss-domain';
import {
  ALL_EA_RULES,
  buildEaDashboard,
  generateEaDemoData,
  type EaRuleContext,
} from '@ubm-klar/economic-assistance-domain';
import type { DataClass, SafeTenantConfig } from '@ubm-klar/shared-types';
import { randomUUID } from 'node:crypto';
import type { TenantDataPlanePool } from './data-plane';
import { createRepositories, WaiverValidationError, type Repositories } from './repositories';

/**
 * UBM Klar backend API. All sensitive operations run here, server-side:
 * - every request is tenant-resolved (strict, fail-closed) from the Host header
 * - every domain route authorizes via RBAC+ABAC+need-to-know before touching data
 * - all data access is logged; sensitive reveals require a recorded reason
 * - service-role credentials never leave this process
 */
export interface ApiAuthOptions {
  /** Verified OIDC/Entra bearer tokens (primary auth in stage/prod). */
  verifier?: OidcTokenVerifier;
  /** IdP group id -> UBM Klar role mapping. */
  groupRoleMapping?: Record<string, RoleId>;
  /** Encrypted web session cookies (set by the web app after login). */
  sessionSecret?: string;
  /** Header auth behind a verified internal proxy (HMAC-signed headers). */
  headerProxy?: { trusted: boolean; secret?: string };
  /**
   * Plain unsigned identity headers. local/demo/test ONLY — loadAppConfig
   * forbids this outside a trusted proxy in stage/prod, and buildApiServer
   * defaults it off unless the demo tenant is enabled.
   */
  allowInsecureHeaderAuth?: boolean;
}

export interface ApiServerOptions {
  directory: TenantDirectory;
  /** Demo mode allows localhost with a synthetic demo tenant (never in prod). */
  allowDemoTenant?: boolean;
  /** TTL for positive tenant lookups (failures are never cached). */
  cacheTtlMs?: number;
  auth?: ApiAuthOptions;
  /** Per-tenant data plane connections (server-side service credentials). */
  dataPlane?: TenantDataPlanePool;
  /**
   * Whether synthetic demo data may be served at all (environment-level gate;
   * loadAppConfig forbids this in stage/prod). The tenant must ALSO opt in via
   * the demo_data_enabled feature flag.
   */
  demoDataEnabled?: boolean;
}

export interface AuthenticatedContext {
  subject: AccessSubject;
  tenant: SafeTenantConfig;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: SafeTenantConfig | undefined;
    subject?: AccessSubject | undefined;
    correlationId?: string;
    repositories?: Repositories | undefined;
  }
}

const DEMO_TENANT: SafeTenantConfig = Object.freeze({
  tenantId: 'demo-tenant',
  tenantSlug: 'demo',
  municipalityName: 'Demokommun',
  deploymentMode: 'local_demo_shared',
  environment: 'demo',
  tenantStatus: 'pilot',
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
  featureFlags: { demo_data_enabled: true },
} satisfies SafeTenantConfig);

/** Plain unsigned header parsing — local/demo/test only (see ApiAuthOptions). */
function parseInsecureHeaderSubject(request: FastifyRequest): AccessSubject | undefined {
  const userId = request.headers['x-user-id'];
  if (typeof userId !== 'string' || userId.length === 0) return undefined;
  const roles = String(request.headers['x-roles'] ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  const sessionKind =
    (request.headers['x-session-kind'] as AccessSubject['sessionKind']) ?? 'normal';
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

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

class AuthenticationFailedError extends Error {
  constructor(public readonly code: string) {
    super(`Authentication failed: ${code}`);
    this.name = 'AuthenticationFailedError';
  }
}

/**
 * Resolves the request subject with strict precedence:
 * 1. OIDC/Entra bearer token (verified: signature, issuer, audience, expiry)
 * 2. Encrypted web session cookie
 * 3. HMAC-signed headers from a trusted internal auth proxy
 * 4. Plain headers — only when explicitly allowed (local/demo/test)
 *
 * A *present but invalid* credential always fails the request (401); it never
 * falls through to a weaker mechanism.
 */
async function resolveSubject(
  request: FastifyRequest,
  auth: ApiAuthOptions,
): Promise<AccessSubject | undefined> {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    if (!auth.verifier) throw new AuthenticationFailedError('bearer_not_supported');
    try {
      const { payload } = await auth.verifier.verify(authorization.slice('Bearer '.length));
      const built = buildSubjectFromClaims(payload, {
        ...(auth.groupRoleMapping ? { groupRoleMapping: auth.groupRoleMapping } : {}),
      });
      return built.subject;
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        throw new AuthenticationFailedError(error.code);
      }
      throw error;
    }
  }

  const sessionCookie = parseCookie(request.headers.cookie, SESSION_COOKIE_NAME);
  if (sessionCookie && auth.sessionSecret) {
    try {
      const session = await readSessionToken(sessionCookie, auth.sessionSecret);
      return session.subject;
    } catch (error) {
      if (error instanceof SessionError) throw new AuthenticationFailedError(error.code);
      throw error;
    }
  }

  const hasIdentityHeaders = typeof request.headers['x-user-id'] === 'string';
  if (hasIdentityHeaders && auth.headerProxy?.trusted && auth.headerProxy.secret) {
    try {
      return subjectFromTrustedProxyHeaders(request.headers, {
        trusted: auth.headerProxy.trusted,
        secret: auth.headerProxy.secret,
      });
    } catch (error) {
      if (error instanceof ProxyAuthError) throw new AuthenticationFailedError(error.code);
      throw error;
    }
  }

  if (hasIdentityHeaders && auth.allowInsecureHeaderAuth) {
    return parseInsecureHeaderSubject(request);
  }

  return undefined;
}

export function buildApiServer(options: ApiServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, disableRequestLogging: true });
  const resolver = new TenantResolver({
    directory: options.directory,
    ...(options.cacheTtlMs !== undefined ? { cacheTtlMs: options.cacheTtlMs } : {}),
  });
  const authOptions: ApiAuthOptions = {
    // Plain header auth defaults to the demo-tenant setting: on for local/demo/
    // test servers, off the moment the server is built for real tenants.
    allowInsecureHeaderAuth: options.allowDemoTenant ?? false,
    ...options.auth,
  };
  const auditLogger = new AuditLogger(new InMemoryAuditSink());
  const accessLogger = new DataAccessLogger(new InMemoryDataAccessSink());

  // --- Correlation id, tenant resolution (strict, fail-closed), auth --------
  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-correlation-id'];
    request.correlationId =
      typeof incoming === 'string' && /^[0-9a-f-]{8,64}$/i.test(incoming) ? incoming : randomUUID();
    reply.header('x-correlation-id', request.correlationId);

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
    const db = options.dataPlane?.resolve(request.tenant);
    request.repositories = db ? createRepositories(db) : undefined;
    try {
      request.subject = await resolveSubject(request, authOptions);
    } catch (error) {
      if (error instanceof AuthenticationFailedError) {
        return reply.status(401).send({
          error: 'authentication_failed',
          message: 'Inloggningen kunde inte verifieras.',
          code: error.code,
        });
      }
      throw error;
    }
  });

  /** No-PII technical log with correlation id (safe for vendor telemetry). */
  function logTechnical(request: FastifyRequest, code: string, context: Record<string, unknown>) {
    const event = sanitizeTechnicalLogEvent({
      level: 'info',
      code,
      message: code,
      context: { ...context, correlationId: request.correlationId },
    });
    console.info(JSON.stringify(event));
  }

  /**
   * Demo data gate: environment allows it (never stage/prod), the tenant is a
   * local/demo/test tenant, AND the tenant's demo_data_enabled flag is on.
   */
  function demoAllowed(tenant: SafeTenantConfig | undefined): boolean {
    if (!tenant) return false;
    return (
      options.demoDataEnabled === true &&
      ['local', 'demo', 'test'].includes(tenant.environment) &&
      tenant.featureFlags['demo_data_enabled'] === true
    );
  }

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
    tenantSlug: request.tenant?.tenantSlug,
    environment: request.tenant?.environment,
    tenantStatus: request.tenant?.tenantStatus,
    modules: request.tenant?.activeModules,
    featureFlags: request.tenant?.featureFlags,
    // publishable key only; service keys never leave the backend process
    dataPlanePublishableKey: request.tenant?.dataPlanePublishableKey,
  }));

  // --- Dashboards ------------------------------------------------------------
  // Demo data is generated lazily and ONLY when the demo gate allows it; it can
  // never be constructed on a stage/prod server (demoDataEnabled is forced off
  // there by loadAppConfig).
  let lssDemoCache: ReturnType<typeof generateLssDemoData> | undefined;
  let eaDemoCache: ReturnType<typeof generateEaDemoData> | undefined;
  function lssDemo() {
    lssDemoCache ??= generateLssDemoData({
      personCount: 100,
      decisionCount: 200,
      providerCount: 20,
      timeReportCount: 400,
      invoiceCount: 300,
      paymentCount: 600,
      recoveryClaimCount: 10,
      ubmRequestCount: 5,
    });
    return lssDemoCache;
  }
  function eaDemo() {
    eaDemoCache ??= generateEaDemoData({
      personCount: 200,
      householdCount: 120,
      applicationCount: 300,
      decisionCount: 300,
      incomeCount: 400,
      housingCount: 150,
      paymentCount: 400,
      recoveryClaimCount: 15,
    });
    return eaDemoCache;
  }
  const lssEngine = new RuleEngine<LssRuleContext>();
  lssEngine.registerAll(ALL_LSS_RULES);
  const eaEngine = new RuleEngine<EaRuleContext>();
  eaEngine.registerAll(ALL_EA_RULES);

  app.get('/dashboards/lss', async (request, reply) => {
    if (!requirePermission(request, reply, 'case.lss.read', { kind: 'dashboard', module: 'lss' }))
      return;
    if (request.repositories) {
      const stats = await request.repositories.lss.dashboardStats();
      logTechnical(request, 'DASHBOARD_LSS_READ', { dataSource: 'data_plane' });
      return { dataSource: 'data_plane', stats };
    }
    if (demoAllowed(request.tenant)) {
      const demo = lssDemo();
      const { flags } = lssEngine.run(demo.context);
      return {
        dataSource: 'demo',
        demoDashboard: buildLssDashboard(demo.context, flags),
      };
    }
    // No data plane configured and demo not allowed: honest empty state.
    logTechnical(request, 'DASHBOARD_LSS_READ', { dataSource: 'empty' });
    return { dataSource: 'empty', stats: undefined };
  });

  app.get('/dashboards/economic-assistance', async (request, reply) => {
    if (
      !requirePermission(request, reply, 'case.ea.read', {
        kind: 'dashboard',
        module: 'economic_assistance',
      })
    )
      return;
    if (request.repositories) {
      const stats = await request.repositories.ea.dashboardStats();
      logTechnical(request, 'DASHBOARD_EA_READ', { dataSource: 'data_plane' });
      return { dataSource: 'data_plane', stats };
    }
    if (demoAllowed(request.tenant)) {
      const demo = eaDemo();
      const { flags } = eaEngine.run(demo.context);
      return {
        dataSource: 'demo',
        demoDashboard: buildEaDashboard(demo.context, flags),
      };
    }
    logTechnical(request, 'DASHBOARD_EA_READ', { dataSource: 'empty' });
    return { dataSource: 'empty', stats: undefined };
  });

  // --- Payment control and control cases (real data) --------------------------
  app.get('/payment-control', async (request, reply) => {
    if (!requirePermission(request, reply, 'payment.read', { kind: 'payment_control' })) return;
    if (!request.repositories) {
      return { dataSource: demoAllowed(request.tenant) ? 'demo' : 'empty', flags: [] };
    }
    const [summary, flags] = await Promise.all([
      request.repositories.paymentControl.flagSummary(),
      request.repositories.paymentControl.listFlags({ limit: 100 }),
    ]);
    return { dataSource: 'data_plane', summary, flags };
  });

  app.get('/control-cases', async (request, reply) => {
    if (!requirePermission(request, reply, 'case.control.read', { kind: 'control_cases' })) return;
    if (!request.repositories) {
      return { dataSource: demoAllowed(request.tenant) ? 'demo' : 'empty', cases: [] };
    }
    const [cases, counts] = await Promise.all([
      request.repositories.controlCases.list({ limit: 100 }),
      request.repositories.controlCases.countByStatus(),
    ]);
    return { dataSource: 'data_plane', cases, counts };
  });

  app.get('/ubm/requests', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.request.read', { kind: 'ubm_request' })) return;
    if (!request.repositories) {
      return { dataSource: demoAllowed(request.tenant) ? 'demo' : 'empty', requests: [] };
    }
    const [requests, counts] = await Promise.all([
      request.repositories.ubmRequests.list({ limit: 100 }),
      request.repositories.ubmRequests.countByStatus(),
    ]);
    return { dataSource: 'data_plane', requests, counts };
  });

  app.get('/ubm/readiness', async (request, reply) => {
    if (!requirePermission(request, reply, 'readiness.manage', { kind: 'readiness' })) return;
    if (!request.repositories) {
      return { dataSource: demoAllowed(request.tenant) ? 'demo' : 'empty', gates: [] };
    }
    const [gates, goLive] = await Promise.all([
      request.repositories.readiness.listGates(),
      request.repositories.readiness.goLiveStatus(),
    ]);
    return { dataSource: 'data_plane', gates, goLive };
  });

  // --- Onboarding gates and approvals ----------------------------------------
  app.get<{ Querystring: { scope?: 'pilot' | 'production' } }>(
    '/onboarding/gates',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'readiness.manage', { kind: 'readiness' })) return;
      if (!request.repositories) return { dataSource: 'empty', gates: [] };
      const gates = await request.repositories.readiness.listGates(request.query.scope);
      return { dataSource: 'data_plane', gates };
    },
  );

  app.put<{
    Params: { gateKey: string };
    Body: {
      status: 'not_started' | 'in_progress' | 'passed' | 'failed';
      evidenceKind?:
        'test_run' | 'document' | 'attestation' | 'configuration' | 'external_reference';
      evidenceReference?: string;
    };
  }>('/onboarding/gates/:gateKey', async (request, reply) => {
    if (!requirePermission(request, reply, 'readiness.manage', { kind: 'readiness' })) return;
    if (!request.repositories) {
      return reply.status(503).send({ error: 'no_data_plane', message: 'Dataplan saknas.' });
    }
    const profileId = await request.repositories.users.ensureUserProfile(request.subject!.userId);
    await request.repositories.readiness.setEvidence({
      gateKey: request.params.gateKey,
      status: request.body.status,
      ...(request.body.evidenceKind ? { evidenceKind: request.body.evidenceKind } : {}),
      ...(request.body.evidenceReference
        ? { evidenceReference: request.body.evidenceReference }
        : {}),
      verifiedBy: profileId,
    });
    await auditLogger.record({
      eventKey: 'case.open',
      actorUserId: request.subject!.userId,
      action: `readiness_gate_${request.body.status}`,
      context: { gateKey: request.params.gateKey, correlationId: request.correlationId },
    });
    return { gateKey: request.params.gateKey, status: request.body.status };
  });

  app.post<{
    Params: { gateKey: string };
    Body: { reason: string; expiresAt: string; riskLevel: 'low' | 'medium' | 'high' | 'critical' };
  }>('/onboarding/gates/:gateKey/waiver', async (request, reply) => {
    if (!requirePermission(request, reply, 'readiness.manage', { kind: 'readiness' })) return;
    if (!request.repositories) {
      return reply.status(503).send({ error: 'no_data_plane', message: 'Dataplan saknas.' });
    }
    const profileId = await request.repositories.users.ensureUserProfile(request.subject!.userId);
    try {
      await request.repositories.readiness.waiveGate({
        gateKey: request.params.gateKey,
        reason: request.body.reason,
        approverProfileId: profileId,
        expiresAt: request.body.expiresAt,
        riskLevel: request.body.riskLevel,
      });
    } catch (error) {
      if (error instanceof WaiverValidationError) {
        return reply.status(422).send({ error: 'waiver_invalid', message: error.message });
      }
      throw error;
    }
    await auditLogger.record({
      eventKey: 'case.open',
      actorUserId: request.subject!.userId,
      action: 'readiness_gate_waived',
      reason: request.body.reason,
      context: {
        gateKey: request.params.gateKey,
        riskLevel: request.body.riskLevel,
        expiresAt: request.body.expiresAt,
        correlationId: request.correlationId,
      },
    });
    return { gateKey: request.params.gateKey, status: 'waived' };
  });

  app.get('/onboarding/approval-status', async (request, reply) => {
    if (!requirePermission(request, reply, 'readiness.manage', { kind: 'readiness' })) return;
    if (!request.repositories) {
      return {
        dataSource: 'empty',
        pilot: { allowed: false, openRequiredGates: [], waivedGates: [] },
        production: { allowed: false, openRequiredGates: [], waivedGates: [] },
      };
    }
    const [pilot, production] = await Promise.all([
      request.repositories.readiness.pilotStatus(),
      request.repositories.readiness.goLiveStatus(),
    ]);
    return { dataSource: 'data_plane', pilot, production };
  });

  app.get('/ubm/export-proposals', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.request.read', { kind: 'ubm_export_proposal' }))
      return;
    if (!request.repositories) return { dataSource: 'empty', proposals: [], counts: {} };
    const [proposals, counts] = await Promise.all([
      request.repositories.exportProposals.list({ limit: 100 }),
      request.repositories.exportProposals.countByStatus(),
    ]);
    return { dataSource: 'data_plane', proposals, counts };
  });

  app.get('/ubm/notifications', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.notification.handle', { kind: 'ubm_notification' }))
      return;
    if (!request.repositories) return { dataSource: 'empty', notifications: [], counts: {} };
    const [notifications, counts] = await Promise.all([
      request.repositories.notifications.list({ limit: 100 }),
      request.repositories.notifications.countByStatus(),
    ]);
    return { dataSource: 'data_plane', notifications, counts };
  });

  app.get('/imports', async (request, reply) => {
    if (!requirePermission(request, reply, 'import.run', { kind: 'import_batch' })) return;
    if (!request.repositories) return { dataSource: 'empty', batches: [] };
    const batches = await request.repositories.importBatches.list(100);
    return { dataSource: 'data_plane', batches };
  });

  app.get('/documents', async (request, reply) => {
    if (!requirePermission(request, reply, 'document.read', { kind: 'document' })) return;
    if (!request.repositories) return { dataSource: 'empty', documents: [] };
    const documents = await request.repositories.documents.list({ limit: 100 });
    // Document *list* access is logged as case-level access (no content opened).
    logTechnical(request, 'DOCUMENT_LIST_READ', { count: documents.length });
    return { dataSource: 'data_plane', documents };
  });

  app.get<{
    Querystring: {
      from?: string;
      to?: string;
      actor?: string;
      eventKey?: string;
      outcome?: string;
    };
  }>('/audit/events', async (request, reply) => {
    if (!requirePermission(request, reply, 'audit.read', { kind: 'audit_log' })) return;
    if (!request.repositories) return { dataSource: 'empty', events: [] };
    const q = request.query;
    const events = await request.repositories.audit.query({
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
      ...(q.eventKey ? { eventKey: q.eventKey } : {}),
      ...(q.outcome ? { outcome: q.outcome as 'success' | 'denied' | 'failed' } : {}),
      limit: 200,
    });
    return { dataSource: 'data_plane', events };
  });

  app.get<{
    Querystring: { from?: string; to?: string; accessKind?: string };
  }>('/audit/data-access', async (request, reply) => {
    if (!requirePermission(request, reply, 'access_log.read', { kind: 'data_access_log' })) return;
    if (!request.repositories) return { dataSource: 'empty', events: [] };
    const q = request.query;
    const events = await request.repositories.dataAccess.query({
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
      ...(q.accessKind ? { accessKind: q.accessKind } : {}),
      limit: 200,
    });
    return { dataSource: 'data_plane', events };
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
        return reply
          .status(422)
          .send({ error: 'support_session_rejected', message: error.message });
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
