import type { DbClient } from '@ubm-klar/db';

export type NotificationDbStatus =
  | 'received'
  | 'matching'
  | 'manual_review'
  | 'matched'
  | 'case_created'
  | 'investigating'
  | 'outcome_registered'
  | 'feedback_sent'
  | 'closed';

export interface NotificationRecord {
  id: string;
  notificationNumber: string;
  intakeChannel: string;
  receivedAt: string;
  domain: string | undefined;
  subjectPersonId: string | undefined;
  summary: string;
  status: NotificationDbStatus;
  controlCaseId: string | undefined;
  createdAt: string;
}

interface Row {
  id: string;
  notification_number: string;
  intake_channel: string;
  received_at: Date;
  domain: string | null;
  subject_person_id: string | null;
  summary: string;
  status: NotificationDbStatus;
  control_case_id: string | null;
  created_at: Date;
}

function toRecord(row: Row): NotificationRecord {
  return {
    id: row.id,
    notificationNumber: row.notification_number,
    intakeChannel: row.intake_channel,
    receivedAt: row.received_at.toISOString(),
    domain: row.domain ?? undefined,
    subjectPersonId: row.subject_person_id ?? undefined,
    summary: row.summary,
    status: row.status,
    controlCaseId: row.control_case_id ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

export class NotificationRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: {
    notificationNumber: string;
    intakeChannel: 'manual_registration' | 'file_upload';
    receivedAt: string;
    domain?: 'lss' | 'economic_assistance' | 'other' | 'unknown';
    summary: string;
  }): Promise<NotificationRecord> {
    const result = await this.db.query<Row>(
      `insert into ubm_notifications (notification_number, intake_channel, received_at, domain, summary, status)
       values ($1, $2, $3, $4, $5, 'received') returning *`,
      [
        input.notificationNumber,
        input.intakeChannel,
        input.receivedAt,
        input.domain ?? 'unknown',
        input.summary,
      ],
    );
    return toRecord(result.rows[0]!);
  }

  async getById(id: string): Promise<NotificationRecord | undefined> {
    const result = await this.db.query<Row>('select * from ubm_notifications where id = $1::uuid', [
      id,
    ]);
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async list(
    filter: { status?: NotificationDbStatus; limit?: number } = {},
  ): Promise<NotificationRecord[]> {
    const result = await this.db.query<Row>(
      filter.status
        ? 'select * from ubm_notifications where status = $1 order by received_at desc limit $2'
        : 'select * from ubm_notifications order by received_at desc limit $1',
      filter.status ? [filter.status, filter.limit ?? 200] : [filter.limit ?? 200],
    );
    return result.rows.map(toRecord);
  }

  async updateStatus(
    id: string,
    status: NotificationDbStatus,
    detail: { subjectPersonId?: string; controlCaseId?: string } = {},
  ): Promise<NotificationRecord> {
    const result = await this.db.query<Row>(
      `update ubm_notifications
       set status = $2,
           subject_person_id = coalesce($3::uuid, subject_person_id),
           control_case_id = coalesce($4::uuid, control_case_id)
       where id = $1::uuid returning *`,
      [id, status, detail.subjectPersonId ?? null, detail.controlCaseId ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown notification: ${id}`);
    return toRecord(row);
  }

  async addConfidenceScore(input: {
    notificationId: string;
    candidateKind: 'person' | 'case' | 'decision' | 'payment';
    candidateId: string;
    score: number;
    scoreBasis: string;
    selected?: boolean;
  }): Promise<void> {
    await this.db.query(
      `insert into ubm_notification_confidence_scores
         (notification_id, candidate_kind, candidate_id, score, score_basis, selected)
       values ($1::uuid, $2, $3::uuid, $4, $5, $6)`,
      [
        input.notificationId,
        input.candidateKind,
        input.candidateId,
        input.score,
        input.scoreBasis,
        input.selected ?? false,
      ],
    );
  }

  async registerOutcome(input: {
    notificationId: string;
    outcome:
      | 'recovery_claim'
      | 'payment_stopped'
      | 'no_action'
      | 'police_report'
      | 'corrected_source_data'
      | 'other_action';
    detail?: string;
    decidedBy: string;
  }): Promise<void> {
    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `insert into ubm_notification_outcomes (notification_id, outcome, detail, decided_by)
         values ($1::uuid, $2, $3, $4::uuid)`,
        [input.notificationId, input.outcome, input.detail ?? null, input.decidedBy],
      );
      await tx.query(
        `update ubm_notifications set status = 'outcome_registered' where id = $1::uuid`,
        [input.notificationId],
      );
    });
  }

  async countByStatus(): Promise<Record<string, number>> {
    const result = await this.db.query<{ status: string; count: string }>(
      'select status, count(*) as count from ubm_notifications group by status',
    );
    return Object.fromEntries(result.rows.map((r) => [r.status, Number(r.count)]));
  }
}
