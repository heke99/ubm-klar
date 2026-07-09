import type { DbClient } from '@ubm-klar/db';

export interface AuditEventRow {
  id: string;
  eventKey: string;
  actorUserId: string | undefined;
  actorRole: string | undefined;
  subjectKind: string | undefined;
  subjectId: string | undefined;
  action: string;
  outcome: 'success' | 'denied' | 'failed';
  reason: string | undefined;
  context: Record<string, unknown>;
  correlationId: string | undefined;
  occurredAt: string;
  previousHash: string | undefined;
  eventHash: string | undefined;
}

export interface AuditQueryFilter {
  from?: string;
  to?: string;
  actorUserId?: string;
  eventKey?: string;
  action?: string;
  subjectId?: string;
  outcome?: 'success' | 'denied' | 'failed';
  limit?: number;
}

interface Row {
  id: string;
  event_key: string;
  actor_user_id: string | null;
  actor_role: string | null;
  subject_kind: string | null;
  subject_id: string | null;
  action: string;
  outcome: 'success' | 'denied' | 'failed';
  reason: string | null;
  context: Record<string, unknown>;
  correlation_id: string | null;
  occurred_at: Date;
  previous_hash: string | null;
  event_hash: string | null;
}

function toRecord(row: Row): AuditEventRow {
  return {
    id: row.id,
    eventKey: row.event_key,
    actorUserId: row.actor_user_id ?? undefined,
    actorRole: row.actor_role ?? undefined,
    subjectKind: row.subject_kind ?? undefined,
    subjectId: row.subject_id ?? undefined,
    action: row.action,
    outcome: row.outcome,
    reason: row.reason ?? undefined,
    context: row.context,
    correlationId: row.correlation_id ?? undefined,
    occurredAt: row.occurred_at.toISOString(),
    previousHash: row.previous_hash ?? undefined,
    eventHash: row.event_hash ?? undefined,
  };
}

export class AuditRepository {
  constructor(private readonly db: DbClient) {}

  async insert(event: {
    eventKey: string;
    actorUserId?: string;
    actorRole?: string;
    subjectKind?: string;
    subjectId?: string;
    action: string;
    outcome?: 'success' | 'denied' | 'failed';
    reason?: string;
    context?: Record<string, unknown>;
    correlationId?: string;
    /** Hash-chained events must store the exact timestamp that was hashed. */
    occurredAt?: string;
    previousHash?: string;
    eventHash?: string;
  }): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into audit_events
         (event_key, actor_user_id, actor_role, subject_kind, subject_id, action, outcome,
          reason, context, correlation_id, occurred_at, previous_hash, event_hash)
       values ($1, $2::uuid, $3, $4, $5::uuid, $6, $7, $8, $9::jsonb, $10::uuid,
               coalesce($11::timestamptz, now()), $12, $13)
       returning id`,
      [
        event.eventKey,
        event.actorUserId ?? null,
        event.actorRole ?? null,
        event.subjectKind ?? null,
        event.subjectId ?? null,
        event.action,
        event.outcome ?? 'success',
        event.reason ?? null,
        JSON.stringify(event.context ?? {}),
        event.correlationId ?? null,
        event.occurredAt ?? null,
        event.previousHash ?? null,
        event.eventHash ?? null,
      ],
    );
    return result.rows[0]!.id;
  }

  async query(filter: AuditQueryFilter = {}): Promise<AuditEventRow[]> {
    const clauses: string[] = ['true'];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      clauses.push(clause.replace('?', `$${params.length}`));
    };
    if (filter.from) add('occurred_at >= ?', filter.from);
    if (filter.to) add('occurred_at <= ?', filter.to);
    if (filter.actorUserId) add('actor_user_id = ?::uuid', filter.actorUserId);
    if (filter.eventKey) add('event_key = ?', filter.eventKey);
    if (filter.action) add('action = ?', filter.action);
    if (filter.subjectId) add('subject_id = ?::uuid', filter.subjectId);
    if (filter.outcome) add('outcome = ?', filter.outcome);
    params.push(filter.limit ?? 200);
    const result = await this.db.query<Row>(
      `select * from audit_events where ${clauses.join(' and ')}
       order by occurred_at desc limit $${params.length}`,
      params,
    );
    return result.rows.map(toRecord);
  }

  /** Events in insertion order for hash-chain verification. */
  async chain(limit = 10_000): Promise<AuditEventRow[]> {
    const result = await this.db.query<Row>(
      'select * from audit_events order by occurred_at asc, id asc limit $1',
      [limit],
    );
    return result.rows.map(toRecord);
  }

  async lastEvent(): Promise<AuditEventRow | undefined> {
    const result = await this.db.query<Row>(
      'select * from audit_events order by occurred_at desc, id desc limit 1',
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }
}
