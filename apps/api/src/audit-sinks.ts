import {
  AuditLogger,
  type AuditEvent,
  type AuditEventInput,
  type AuditSink,
} from '@ubm-klar/audit';
import {
  DataAccessLogger,
  type DataAccessEvent,
  type DataAccessSink,
} from '@ubm-klar/data-access-log';
import type { Repositories } from './repositories';

/**
 * Persistent audit and data access sinks writing into the tenant's own data
 * plane. The in-memory sinks remain for local/demo/test only; production
 * requests without a data plane are refused before any sensitive route runs.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Structural logger interfaces so per-tenant wrappers can normalize actor ids. */
export interface AuditRecorder {
  record(input: AuditEventInput): Promise<AuditEvent>;
}
export interface AccessRecorder {
  record(input: Omit<DataAccessEvent, 'occurredAt'>): Promise<DataAccessEvent>;
}

export class PostgresAuditSink implements AuditSink {
  constructor(private readonly repos: Repositories) {}

  async append(event: AuditEvent): Promise<void> {
    await this.repos.audit.insert({
      eventKey: event.eventKey,
      ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
      ...(event.actorRole ? { actorRole: event.actorRole } : {}),
      ...(event.subjectKind ? { subjectKind: event.subjectKind } : {}),
      ...(event.subjectId ? { subjectId: event.subjectId } : {}),
      action: event.action,
      outcome: event.outcome,
      ...(event.reason ? { reason: event.reason } : {}),
      context: event.context ?? {},
      ...(event.correlationId && UUID_PATTERN.test(event.correlationId)
        ? { correlationId: event.correlationId }
        : {}),
      occurredAt: event.occurredAt,
      ...(event.previousHash ? { previousHash: event.previousHash } : {}),
      eventHash: event.eventHash,
    });
  }

  async latestHash(): Promise<string | null> {
    const last = await this.repos.audit.lastEvent();
    return last?.eventHash ?? null;
  }
}

export class PostgresDataAccessSink implements DataAccessSink {
  constructor(private readonly repos: Repositories) {}

  async append(event: DataAccessEvent): Promise<void> {
    await this.repos.dataAccess.insert({
      actorUserId: event.actorUserId,
      ...(event.actorRole ? { actorRole: event.actorRole } : {}),
      accessKind: event.accessKind,
      ...(event.personId ? { personId: event.personId } : {}),
      ...(event.caseKind ? { caseKind: event.caseKind } : {}),
      ...(event.caseId ? { caseId: event.caseId } : {}),
      ...(event.documentId ? { documentId: event.documentId } : {}),
      ...(event.fieldKey ? { fieldKey: event.fieldKey } : {}),
      ...(event.reason ? { reason: event.reason } : {}),
      ...(event.purpose ? { purpose: event.purpose } : {}),
      sessionKind: event.sessionKind,
    });
  }
}

export interface TenantLoggers {
  auditLogger: AuditRecorder;
  accessLogger: AccessRecorder;
}

/**
 * Per-tenant persistent loggers. Actor ids from the SSO subject are resolved to
 * data-plane user profile UUIDs BEFORE the event is hashed, so the stored event
 * is exactly what the hash chain covers. Non-UUID subject ids move into context.
 */
export function createTenantLoggers(repos: Repositories): TenantLoggers {
  const innerAudit = new AuditLogger(new PostgresAuditSink(repos));
  const innerAccess = new DataAccessLogger(new PostgresDataAccessSink(repos));

  const auditLogger: AuditRecorder = {
    record: async (input) => {
      const normalized: AuditEventInput = { ...input };
      if (normalized.actorUserId && !UUID_PATTERN.test(normalized.actorUserId)) {
        const profileId = await repos.users.ensureUserProfile(normalized.actorUserId);
        normalized.context = { ...normalized.context, actorSubjectId: normalized.actorUserId };
        normalized.actorUserId = profileId;
      }
      if (normalized.subjectId && !UUID_PATTERN.test(normalized.subjectId)) {
        normalized.context = { ...normalized.context, subjectRef: normalized.subjectId };
        delete normalized.subjectId;
      }
      return innerAudit.record(normalized);
    },
  };

  const accessLogger: AccessRecorder = {
    record: async (input) => {
      const actorUserId = UUID_PATTERN.test(input.actorUserId)
        ? input.actorUserId
        : await repos.users.ensureUserProfile(input.actorUserId);
      return innerAccess.record({ ...input, actorUserId });
    },
  };

  return { auditLogger, accessLogger };
}
