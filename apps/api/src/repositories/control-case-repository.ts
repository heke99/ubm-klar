import type { DbClient } from '@ubm-klar/db';

export type ControlCaseDbStatus =
  'open' | 'assigned' | 'investigating' | 'awaiting_decision' | 'decided' | 'closed' | 'reopened';

export interface ControlCaseRecord {
  id: string;
  caseNumber: string;
  sourceKind: string;
  sourceReference: string;
  domain: string;
  title: string;
  severity: string;
  status: ControlCaseDbStatus;
  personId: string | undefined;
  amountAtRiskSek: number | undefined;
  assignedTo: string | undefined;
  outcome: string | undefined;
  outcomeNote: string | undefined;
  createdAt: string;
  closedAt: string | undefined;
}

interface Row {
  id: string;
  case_number: string;
  source_kind: string;
  source_reference: string;
  domain: string;
  title: string;
  severity: string;
  status: ControlCaseDbStatus;
  person_id: string | null;
  amount_at_risk_sek: string | null;
  assigned_to: string | null;
  outcome: string | null;
  outcome_note: string | null;
  created_at: Date;
  closed_at: Date | null;
}

function toRecord(row: Row): ControlCaseRecord {
  return {
    id: row.id,
    caseNumber: row.case_number,
    sourceKind: row.source_kind,
    sourceReference: row.source_reference,
    domain: row.domain,
    title: row.title,
    severity: row.severity,
    status: row.status,
    personId: row.person_id ?? undefined,
    amountAtRiskSek: row.amount_at_risk_sek !== null ? Number(row.amount_at_risk_sek) : undefined,
    assignedTo: row.assigned_to ?? undefined,
    outcome: row.outcome ?? undefined,
    outcomeNote: row.outcome_note ?? undefined,
    createdAt: row.created_at.toISOString(),
    closedAt: row.closed_at ? row.closed_at.toISOString() : undefined,
  };
}

export class ControlCaseRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: {
    caseNumber: string;
    sourceKind:
      | 'risk_flag'
      | 'ubm_notification'
      | 'manual'
      | 'import_error'
      | 'payment_anomaly'
      | 'access_anomaly';
    sourceReference: string;
    domain: 'lss' | 'economic_assistance' | 'payment_control' | 'security' | 'common';
    title: string;
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    personId?: string;
    amountAtRiskSek?: number;
  }): Promise<ControlCaseRecord> {
    const result = await this.db.query<Row>(
      `insert into control_cases
         (case_number, source_kind, source_reference, domain, title, severity, status, person_id, amount_at_risk_sek)
       values ($1, $2, $3, $4, $5, $6, 'open', $7::uuid, $8) returning *`,
      [
        input.caseNumber,
        input.sourceKind,
        input.sourceReference,
        input.domain,
        input.title,
        input.severity,
        input.personId ?? null,
        input.amountAtRiskSek ?? null,
      ],
    );
    return toRecord(result.rows[0]!);
  }

  async getById(id: string): Promise<ControlCaseRecord | undefined> {
    const result = await this.db.query<Row>('select * from control_cases where id = $1::uuid', [
      id,
    ]);
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async list(
    filter: {
      status?: ControlCaseDbStatus;
      domain?: string;
      severity?: string;
      limit?: number;
    } = {},
  ): Promise<ControlCaseRecord[]> {
    const clauses: string[] = ['true'];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      clauses.push(clause.replace('?', `$${params.length}`));
    };
    if (filter.status) add('status = ?', filter.status);
    if (filter.domain) add('domain = ?', filter.domain);
    if (filter.severity) add('severity = ?', filter.severity);
    params.push(filter.limit ?? 200);
    const result = await this.db.query<Row>(
      `select * from control_cases where ${clauses.join(' and ')}
       order by created_at desc limit $${params.length}`,
      params,
    );
    return result.rows.map(toRecord);
  }

  async updateStatus(
    id: string,
    status: ControlCaseDbStatus,
    actorProfileId: string,
    detail?: string,
  ): Promise<ControlCaseRecord> {
    return this.db.withTransaction(async (tx) => {
      const result = await tx.query<Row>(
        `update control_cases
         set status = $2, closed_at = case when $2 = 'closed' then now() else closed_at end
         where id = $1::uuid returning *`,
        [id, status],
      );
      const row = result.rows[0];
      if (!row) throw new Error(`Unknown control case: ${id}`);
      await tx.query(
        `insert into control_case_events (case_id, event_kind, actor_user_id, detail)
         values ($1::uuid, $2, $3::uuid, $4)`,
        [id, `status_${status}`, actorProfileId, detail ?? null],
      );
      await tx.query(
        `insert into control_case_status_history (case_id, old_status, new_status, changed_by)
         values ($1::uuid, null, $2, $3::uuid)`,
        [id, status, actorProfileId],
      );
      return toRecord(row);
    });
  }

  async assign(id: string, assigneeProfileId: string, actorProfileId: string): Promise<void> {
    await this.db.withTransaction(async (tx) => {
      await tx.query(
        'update control_cases set assigned_to = $2::uuid, status = $3 where id = $1::uuid',
        [id, assigneeProfileId, 'assigned'],
      );
      await tx.query(
        `insert into control_case_assignments (case_id, assigned_to, assigned_by)
         values ($1::uuid, $2::uuid, $3::uuid)`,
        [id, assigneeProfileId, actorProfileId],
      );
      await tx.query(
        `insert into control_case_events (case_id, event_kind, actor_user_id, detail)
         values ($1::uuid, 'assigned', $2::uuid, null)`,
        [id, actorProfileId],
      );
    });
  }

  async addNote(id: string, authorProfileId: string, note: string): Promise<void> {
    await this.db.query(
      'insert into control_case_notes (case_id, author_user_id, note) values ($1::uuid, $2::uuid, $3)',
      [id, authorProfileId, note],
    );
  }

  async listNotes(
    id: string,
  ): Promise<Array<{ authorUserId: string; note: string; createdAt: string }>> {
    const result = await this.db.query<{ author_user_id: string; note: string; created_at: Date }>(
      'select * from control_case_notes where case_id = $1::uuid order by created_at',
      [id],
    );
    return result.rows.map((row) => ({
      authorUserId: row.author_user_id,
      note: row.note,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async listEvents(id: string): Promise<
    Array<{
      eventKind: string;
      actorUserId: string | undefined;
      detail: string | undefined;
      occurredAt: string;
    }>
  > {
    const result = await this.db.query<{
      event_kind: string;
      actor_user_id: string | null;
      detail: string | null;
      occurred_at: Date;
    }>('select * from control_case_events where case_id = $1::uuid order by occurred_at', [id]);
    return result.rows.map((row) => ({
      eventKind: row.event_kind,
      actorUserId: row.actor_user_id ?? undefined,
      detail: row.detail ?? undefined,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }

  async registerOutcome(
    id: string,
    outcome:
      | 'recovery_claim'
      | 'payment_stopped'
      | 'no_action'
      | 'police_report'
      | 'corrected_source_data'
      | 'other_action',
    outcomeNote: string | undefined,
    actorProfileId: string,
  ): Promise<void> {
    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `update control_cases set outcome = $2, outcome_note = $3, status = 'decided' where id = $1::uuid`,
        [id, outcome, outcomeNote ?? null],
      );
      await tx.query(
        `insert into control_case_events (case_id, event_kind, actor_user_id, detail)
         values ($1::uuid, 'outcome_registered', $2::uuid, $3)`,
        [id, actorProfileId, outcome],
      );
    });
  }

  async countByStatus(): Promise<Record<string, number>> {
    const result = await this.db.query<{ status: string; count: string }>(
      'select status, count(*) as count from control_cases group by status',
    );
    return Object.fromEntries(result.rows.map((r) => [r.status, Number(r.count)]));
  }
}
