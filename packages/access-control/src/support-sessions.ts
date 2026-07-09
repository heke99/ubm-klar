/**
 * Support JIT access sessions (no PII) and break-glass emergency sessions.
 * Municipality approves; access is scoped, reason-required and time-limited;
 * everything is logged; sessions expire automatically.
 */
export type SupportScope =
  | 'technical_status'
  | 'import_status'
  | 'integration_status'
  | 'queue_status'
  | 'schema_errors'
  | 'logs_no_pii';

export const MAX_SUPPORT_SESSION_MS = 8 * 60 * 60 * 1000;
export const MAX_BREAK_GLASS_SESSION_MS = 4 * 60 * 60 * 1000;

export interface SupportSessionRequest {
  supportCaseReference: string;
  requestedBySupportUser: string;
  approvedByMunicipalityUser?: string;
  scope: SupportScope;
  reason: string;
  requestedDurationMs: number;
}

export interface SupportSession {
  supportCaseReference: string;
  supportUser: string;
  approvedBy: string;
  scope: SupportScope;
  reason: string;
  startsAt: number;
  expiresAt: number;
  piiAccess: false;
}

export class SupportSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupportSessionError';
  }
}

export function createSupportSession(
  request: SupportSessionRequest,
  now: number = Date.now(),
): SupportSession {
  if (!request.approvedByMunicipalityUser) {
    throw new SupportSessionError('Support access requires municipality approval (JIT).');
  }
  if (request.approvedByMunicipalityUser === request.requestedBySupportUser) {
    throw new SupportSessionError('Support access cannot be self-approved.');
  }
  if (request.reason.trim().length < 10) {
    throw new SupportSessionError('Support access requires a reason (min 10 characters).');
  }
  if (request.requestedDurationMs <= 0 || request.requestedDurationMs > MAX_SUPPORT_SESSION_MS) {
    throw new SupportSessionError(
      `Support sessions are limited to ${MAX_SUPPORT_SESSION_MS / 3_600_000} hours.`,
    );
  }
  return {
    supportCaseReference: request.supportCaseReference,
    supportUser: request.requestedBySupportUser,
    approvedBy: request.approvedByMunicipalityUser,
    scope: request.scope,
    reason: request.reason,
    startsAt: now,
    expiresAt: now + request.requestedDurationMs,
    piiAccess: false,
  };
}

export function isSessionActive(
  session: { startsAt: number; expiresAt: number },
  now: number = Date.now(),
): boolean {
  return session.startsAt <= now && now < session.expiresAt;
}

export interface BreakGlassRequest {
  initiatedBy: string;
  hasBreakGlassRole: boolean;
  reason: string;
  incidentReference?: string;
  requestedDurationMs: number;
}

export interface BreakGlassSession {
  initiatedBy: string;
  reason: string;
  incidentReference?: string;
  startsAt: number;
  expiresAt: number;
  postReviewStatus: 'pending';
}

export function createBreakGlassSession(
  request: BreakGlassRequest,
  now: number = Date.now(),
): BreakGlassSession {
  if (!request.hasBreakGlassRole) {
    throw new SupportSessionError('Break-glass requires the break_glass_admin role.');
  }
  if (request.reason.trim().length < 20) {
    throw new SupportSessionError('Break-glass requires a substantive reason (min 20 characters).');
  }
  if (
    request.requestedDurationMs <= 0 ||
    request.requestedDurationMs > MAX_BREAK_GLASS_SESSION_MS
  ) {
    throw new SupportSessionError(
      `Break-glass sessions are limited to ${MAX_BREAK_GLASS_SESSION_MS / 3_600_000} hours.`,
    );
  }
  return {
    initiatedBy: request.initiatedBy,
    reason: request.reason,
    ...(request.incidentReference !== undefined
      ? { incidentReference: request.incidentReference }
      : {}),
    startsAt: now,
    expiresAt: now + request.requestedDurationMs,
    postReviewStatus: 'pending',
  };
}
