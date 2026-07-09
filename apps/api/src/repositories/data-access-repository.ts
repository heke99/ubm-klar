import type { DbClient } from '@ubm-klar/db';

export interface DataAccessEventRow {
  id: string;
  actorUserId: string;
  actorRole: string | undefined;
  accessKind: string;
  personId: string | undefined;
  caseKind: string | undefined;
  caseId: string | undefined;
  documentId: string | undefined;
  fieldKey: string | undefined;
  reason: string | undefined;
  purpose: string | undefined;
  sessionKind: string;
  occurredAt: string;
}

interface Row {
  id: string;
  actor_user_id: string;
  actor_role: string | null;
  access_kind: string;
  person_id: string | null;
  case_kind: string | null;
  case_id: string | null;
  document_id: string | null;
  field_key: string | null;
  reason: string | null;
  purpose: string | null;
  session_kind: string;
  occurred_at: Date;
}

function toRecord(row: Row): DataAccessEventRow {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role ?? undefined,
    accessKind: row.access_kind,
    personId: row.person_id ?? undefined,
    caseKind: row.case_kind ?? undefined,
    caseId: row.case_id ?? undefined,
    documentId: row.document_id ?? undefined,
    fieldKey: row.field_key ?? undefined,
    reason: row.reason ?? undefined,
    purpose: row.purpose ?? undefined,
    sessionKind: row.session_kind,
    occurredAt: row.occurred_at.toISOString(),
  };
}

export class DataAccessRepository {
  constructor(private readonly db: DbClient) {}

  async insert(event: {
    actorUserId: string;
    actorRole?: string;
    accessKind: string;
    personId?: string;
    caseKind?: string;
    caseId?: string;
    documentId?: string;
    fieldKey?: string;
    reason?: string;
    purpose?: string;
    sessionKind?: string;
  }): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into data_access_events
         (actor_user_id, actor_role, access_kind, person_id, case_kind, case_id,
          document_id, field_key, reason, purpose, session_kind)
       values ($1::uuid, $2, $3, $4::uuid, $5, $6::uuid, $7::uuid, $8, $9, $10, $11)
       returning id`,
      [
        event.actorUserId,
        event.actorRole ?? null,
        event.accessKind,
        event.personId ?? null,
        event.caseKind ?? null,
        event.caseId ?? null,
        event.documentId ?? null,
        event.fieldKey ?? null,
        event.reason ?? null,
        event.purpose ?? null,
        event.sessionKind ?? 'normal',
      ],
    );
    return result.rows[0]!.id;
  }

  async query(
    filter: {
      from?: string;
      to?: string;
      actorUserId?: string;
      accessKind?: string;
      personId?: string;
      caseId?: string;
      limit?: number;
    } = {},
  ): Promise<DataAccessEventRow[]> {
    const clauses: string[] = ['true'];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      clauses.push(clause.replace('?', `$${params.length}`));
    };
    if (filter.from) add('occurred_at >= ?', filter.from);
    if (filter.to) add('occurred_at <= ?', filter.to);
    if (filter.actorUserId) add('actor_user_id = ?::uuid', filter.actorUserId);
    if (filter.accessKind) add('access_kind = ?', filter.accessKind);
    if (filter.personId) add('person_id = ?::uuid', filter.personId);
    if (filter.caseId) add('case_id = ?::uuid', filter.caseId);
    params.push(filter.limit ?? 200);
    const result = await this.db.query<Row>(
      `select * from data_access_events where ${clauses.join(' and ')}
       order by occurred_at desc limit $${params.length}`,
      params,
    );
    return result.rows.map(toRecord);
  }
}
