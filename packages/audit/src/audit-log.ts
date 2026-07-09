import { createHash } from 'node:crypto';

/** Every auditable event key in the platform. */
export type AuditEventKey =
  | 'person.search'
  | 'person.record_open'
  | 'case.open'
  | 'document.open'
  | 'document.download'
  | 'document.redaction'
  | 'medical_data.view'
  | 'protected_identity.view'
  | 'children_data.view'
  | 'income.view'
  | 'bank_account.view'
  | 'sensitive_field.reveal'
  | 'export.proposal_created'
  | 'export.approved'
  | 'ubm.export_sent'
  | 'ubm.request_registered'
  | 'ubm.notification_handled'
  | 'risk_rule.flag_created'
  | 'decision_link.changed'
  | 'support.access'
  | 'break_glass.session'
  | 'migration.executed'
  | 'public_record.disclosure'
  | 'e_archive.export'
  | 'exit.export'
  | 'retention.deletion'
  | 'role_mapping.changed'
  | 'rule_configuration.changed'
  | 'payment_recipient.changed'
  | 'ai.suggestion_generated'
  | 'ai.suggestion_approved'
  | 'ai.suggestion_rejected';

export interface AuditEventInput {
  eventKey: AuditEventKey;
  actorUserId?: string;
  actorRole?: string;
  subjectKind?: string;
  subjectId?: string;
  action: string;
  outcome?: 'success' | 'denied' | 'failed';
  reason?: string;
  context?: Record<string, unknown>;
  correlationId?: string;
}

export interface AuditEvent extends AuditEventInput {
  outcome: 'success' | 'denied' | 'failed';
  occurredAt: string;
  previousHash: string | null;
  eventHash: string;
}

export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
  latestHash(): Promise<string | null>;
}

export function computeEventHash(event: Omit<AuditEvent, 'eventHash'>): string {
  const canonical = JSON.stringify({
    eventKey: event.eventKey,
    actorUserId: event.actorUserId ?? null,
    subjectKind: event.subjectKind ?? null,
    subjectId: event.subjectId ?? null,
    action: event.action,
    outcome: event.outcome,
    occurredAt: event.occurredAt,
    previousHash: event.previousHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Hash-chained audit logger. Each event embeds the hash of the previous event,
 * so tampering with any historical record breaks the chain (verifiable with
 * `verifyChain`). Storage stays in the municipality's own data plane.
 */
export class AuditLogger {
  constructor(
    private readonly sink: AuditSink,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async record(input: AuditEventInput): Promise<AuditEvent> {
    const previousHash = await this.sink.latestHash();
    const withoutHash: Omit<AuditEvent, 'eventHash'> = {
      ...input,
      outcome: input.outcome ?? 'success',
      occurredAt: this.clock().toISOString(),
      previousHash,
    };
    const event: AuditEvent = { ...withoutHash, eventHash: computeEventHash(withoutHash) };
    await this.sink.append(event);
    return event;
  }
}

export interface ChainVerification {
  valid: boolean;
  brokenAtIndex?: number;
  reason?: string;
}

export function verifyChain(events: AuditEvent[]): ChainVerification {
  let previousHash: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.previousHash !== previousHash) {
      return { valid: false, brokenAtIndex: i, reason: 'previous hash mismatch' };
    }
    const { eventHash: _ignored, ...rest } = event;
    const expected = computeEventHash(rest);
    if (expected !== event.eventHash) {
      return { valid: false, brokenAtIndex: i, reason: 'event hash mismatch' };
    }
    previousHash = event.eventHash;
  }
  return { valid: true };
}

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async latestHash(): Promise<string | null> {
    return this.events.at(-1)?.eventHash ?? null;
  }
}
