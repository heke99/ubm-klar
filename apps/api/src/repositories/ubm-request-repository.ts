import type { DbClient } from '@ubm-klar/db';

export type UbmRequestDbStatus =
  | 'received'
  | 'registered'
  | 'validated'
  | 'matching'
  | 'data_collection'
  | 'eligibility_review'
  | 'proposal_created'
  | 'in_review'
  | 'approved'
  | 'exported'
  | 'receipt_received'
  | 'closed'
  | 'rejected';

export interface UbmRequestRecord {
  id: string;
  requestNumber: string;
  intakeChannel: string;
  externalReference: string | undefined;
  receivedAt: string;
  registeredBy: string | undefined;
  domain: string | undefined;
  status: UbmRequestDbStatus;
  deadlineAt: string | undefined;
  legalSourceKey: string | undefined;
  createdAt: string;
}

export interface CreateUbmRequestInput {
  requestNumber: string;
  intakeChannel: 'manual_registration' | 'file_upload';
  externalReference?: string;
  receivedAt: string;
  registeredBy?: string;
  domain?: 'lss' | 'economic_assistance' | 'other' | 'unknown';
  deadlineAt?: string;
  legalSourceKey?: string;
  legalSourceVersion?: string;
}

interface Row {
  id: string;
  request_number: string;
  intake_channel: string;
  external_reference: string | null;
  received_at: Date;
  registered_by: string | null;
  domain: string | null;
  status: UbmRequestDbStatus;
  deadline_at: Date | null;
  legal_source_key: string | null;
  created_at: Date;
}

function toRecord(row: Row): UbmRequestRecord {
  return {
    id: row.id,
    requestNumber: row.request_number,
    intakeChannel: row.intake_channel,
    externalReference: row.external_reference ?? undefined,
    receivedAt: row.received_at.toISOString(),
    registeredBy: row.registered_by ?? undefined,
    domain: row.domain ?? undefined,
    status: row.status,
    deadlineAt: row.deadline_at ? row.deadline_at.toISOString().slice(0, 10) : undefined,
    legalSourceKey: row.legal_source_key ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

export class UbmRequestRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: CreateUbmRequestInput): Promise<UbmRequestRecord> {
    const result = await this.db.query<Row>(
      `insert into ubm_requests
         (request_number, intake_channel, external_reference, received_at, registered_by,
          domain, status, deadline_at, legal_source_key, legal_source_version)
       values ($1, $2, $3, $4, $5::uuid, $6, 'received', $7, $8, $9)
       returning *`,
      [
        input.requestNumber,
        input.intakeChannel,
        input.externalReference ?? null,
        input.receivedAt,
        input.registeredBy ?? null,
        input.domain ?? 'unknown',
        input.deadlineAt ?? null,
        input.legalSourceKey ?? null,
        input.legalSourceVersion ?? null,
      ],
    );
    return toRecord(result.rows[0]!);
  }

  async getById(id: string): Promise<UbmRequestRecord | undefined> {
    const result = await this.db.query<Row>('select * from ubm_requests where id = $1::uuid', [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async list(
    filter: { status?: UbmRequestDbStatus; limit?: number } = {},
  ): Promise<UbmRequestRecord[]> {
    const result = await this.db.query<Row>(
      filter.status
        ? 'select * from ubm_requests where status = $1 order by received_at desc limit $2'
        : 'select * from ubm_requests order by received_at desc limit $1',
      filter.status ? [filter.status, filter.limit ?? 200] : [filter.limit ?? 200],
    );
    return result.rows.map(toRecord);
  }

  async updateStatus(id: string, status: UbmRequestDbStatus): Promise<UbmRequestRecord> {
    const result = await this.db.query<Row>(
      'update ubm_requests set status = $2 where id = $1::uuid returning *',
      [id, status],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown UBM request: ${id}`);
    return toRecord(row);
  }

  async addSubject(input: {
    requestId: string;
    subjectKind: 'person' | 'organization';
    personId?: string;
    organizationId?: string;
    matchStatus?: 'unmatched' | 'matched' | 'ambiguous' | 'not_found' | 'manual';
    matchConfidence?: number;
    matchedBy?: string;
  }): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into ubm_request_subjects
         (request_id, subject_kind, person_id, organization_id, match_status, match_confidence, matched_by, matched_at)
       values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7::uuid,
               case when $5 in ('matched','manual') then now() else null end)
       returning id`,
      [
        input.requestId,
        input.subjectKind,
        input.personId ?? null,
        input.organizationId ?? null,
        input.matchStatus ?? 'unmatched',
        input.matchConfidence ?? null,
        input.matchedBy ?? null,
      ],
    );
    return result.rows[0]!.id;
  }

  async listSubjects(requestId: string): Promise<
    Array<{
      id: string;
      subjectKind: string;
      personId: string | undefined;
      matchStatus: string;
      matchConfidence: number | undefined;
    }>
  > {
    const result = await this.db.query<{
      id: string;
      subject_kind: string;
      person_id: string | null;
      match_status: string;
      match_confidence: string | null;
    }>('select * from ubm_request_subjects where request_id = $1::uuid', [requestId]);
    return result.rows.map((row) => ({
      id: row.id,
      subjectKind: row.subject_kind,
      personId: row.person_id ?? undefined,
      matchStatus: row.match_status,
      matchConfidence: row.match_confidence !== null ? Number(row.match_confidence) : undefined,
    }));
  }

  async countByStatus(): Promise<Record<string, number>> {
    const result = await this.db.query<{ status: string; count: string }>(
      'select status, count(*) as count from ubm_requests group by status',
    );
    return Object.fromEntries(result.rows.map((r) => [r.status, Number(r.count)]));
  }
}
