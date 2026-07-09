import type { DbClient } from '@ubm-klar/db';

export type ExportProposalDbStatus =
  | 'draft'
  | 'eligibility_blocked'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'packaged'
  | 'sent'
  | 'receipt_received'
  | 'closed';

export interface ExportProposalRecord {
  id: string;
  requestId: string | undefined;
  proposalNumber: string;
  domain: 'lss' | 'economic_assistance';
  schemaKey: string;
  schemaVersion: string;
  eligibilityOutcome: string;
  eligibilityExplanations: string[];
  status: ExportProposalDbStatus;
  createdBy: string | undefined;
  approvalWorkflowId: string | undefined;
  createdAt: string;
}

interface Row {
  id: string;
  request_id: string | null;
  proposal_number: string;
  domain: 'lss' | 'economic_assistance';
  schema_key: string;
  schema_version: string;
  eligibility_outcome: string;
  eligibility_explanations: string[];
  status: ExportProposalDbStatus;
  created_by: string | null;
  approval_workflow_id: string | null;
  created_at: Date;
}

function toRecord(row: Row): ExportProposalRecord {
  return {
    id: row.id,
    requestId: row.request_id ?? undefined,
    proposalNumber: row.proposal_number,
    domain: row.domain,
    schemaKey: row.schema_key,
    schemaVersion: row.schema_version,
    eligibilityOutcome: row.eligibility_outcome,
    eligibilityExplanations: row.eligibility_explanations,
    status: row.status,
    createdBy: row.created_by ?? undefined,
    approvalWorkflowId: row.approval_workflow_id ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

export class ExportProposalRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: {
    requestId?: string;
    proposalNumber: string;
    domain: 'lss' | 'economic_assistance';
    schemaKey: string;
    schemaVersion: string;
    eligibilityOutcome: string;
    eligibilityExplanations?: string[];
    status?: ExportProposalDbStatus;
    createdBy?: string;
  }): Promise<ExportProposalRecord> {
    const result = await this.db.query<Row>(
      `insert into ubm_export_proposals
         (request_id, proposal_number, domain, schema_key, schema_version,
          eligibility_outcome, eligibility_explanations, status, created_by)
       values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid)
       returning *`,
      [
        input.requestId ?? null,
        input.proposalNumber,
        input.domain,
        input.schemaKey,
        input.schemaVersion,
        input.eligibilityOutcome,
        input.eligibilityExplanations ?? [],
        input.status ?? 'draft',
        input.createdBy ?? null,
      ],
    );
    return toRecord(result.rows[0]!);
  }

  async getById(id: string): Promise<ExportProposalRecord | undefined> {
    const result = await this.db.query<Row>(
      'select * from ubm_export_proposals where id = $1::uuid',
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async list(
    filter: { status?: ExportProposalDbStatus; requestId?: string; limit?: number } = {},
  ): Promise<ExportProposalRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      clauses.push(`status = $${params.length}`);
    }
    if (filter.requestId) {
      params.push(filter.requestId);
      clauses.push(`request_id = $${params.length}::uuid`);
    }
    params.push(filter.limit ?? 200);
    const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
    const result = await this.db.query<Row>(
      `select * from ubm_export_proposals ${where} order by created_at desc limit $${params.length}`,
      params,
    );
    return result.rows.map(toRecord);
  }

  async updateStatus(
    id: string,
    status: ExportProposalDbStatus,
    approvalWorkflowId?: string,
  ): Promise<ExportProposalRecord> {
    const result = await this.db.query<Row>(
      `update ubm_export_proposals
       set status = $2, approval_workflow_id = coalesce($3::uuid, approval_workflow_id)
       where id = $1::uuid returning *`,
      [id, status, approvalWorkflowId ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown export proposal: ${id}`);
    return toRecord(row);
  }

  async addRow(input: {
    proposalId: string;
    personId?: string;
    entityKind: string;
    entityId: string;
    payload: Record<string, unknown>;
    lineageComplete: boolean;
  }): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into ubm_export_rows (proposal_id, person_id, entity_kind, entity_id, payload, lineage_complete)
       values ($1::uuid, $2::uuid, $3, $4::uuid, $5::jsonb, $6) returning id`,
      [
        input.proposalId,
        input.personId ?? null,
        input.entityKind,
        input.entityId,
        JSON.stringify(input.payload),
        input.lineageComplete,
      ],
    );
    return result.rows[0]!.id;
  }

  async listRows(proposalId: string): Promise<
    Array<{
      id: string;
      personId: string | undefined;
      entityKind: string;
      payload: Record<string, unknown>;
    }>
  > {
    const result = await this.db.query<{
      id: string;
      person_id: string | null;
      entity_kind: string;
      payload: Record<string, unknown>;
    }>('select * from ubm_export_rows where proposal_id = $1::uuid', [proposalId]);
    return result.rows.map((row) => ({
      id: row.id,
      personId: row.person_id ?? undefined,
      entityKind: row.entity_kind,
      payload: row.payload,
    }));
  }

  async countByStatus(): Promise<Record<string, number>> {
    const result = await this.db.query<{ status: string; count: string }>(
      'select status, count(*) as count from ubm_export_proposals group by status',
    );
    return Object.fromEntries(result.rows.map((r) => [r.status, Number(r.count)]));
  }
}
