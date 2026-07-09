import type { DbClient } from '@ubm-klar/db';

export type ImportBatchDbStatus =
  | 'received'
  | 'parsing'
  | 'validating'
  | 'mapping'
  | 'loaded'
  | 'failed'
  | 'partially_loaded'
  | 'rejected';

export interface ImportBatchRecord {
  id: string;
  importKind: string;
  fileName: string | undefined;
  fileHashSha256: string | undefined;
  rowCount: number | undefined;
  status: ImportBatchDbStatus;
  errorSummary: string | undefined;
  importedBy: string | undefined;
  startedAt: string;
  finishedAt: string | undefined;
}

interface Row {
  id: string;
  import_kind: string;
  file_name: string | null;
  file_hash_sha256: string | null;
  row_count: number | null;
  status: ImportBatchDbStatus;
  error_summary: string | null;
  imported_by: string | null;
  started_at: Date;
  finished_at: Date | null;
}

function toRecord(row: Row): ImportBatchRecord {
  return {
    id: row.id,
    importKind: row.import_kind,
    fileName: row.file_name ?? undefined,
    fileHashSha256: row.file_hash_sha256 ?? undefined,
    rowCount: row.row_count ?? undefined,
    status: row.status,
    errorSummary: row.error_summary ?? undefined,
    importedBy: row.imported_by ?? undefined,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : undefined,
  };
}

export class ImportBatchRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: {
    importKind:
      | 'persons'
      | 'lss'
      | 'economic_assistance'
      | 'payments'
      | 'payment_file'
      | 'documents'
      | 'other';
    fileName?: string;
    fileHashSha256?: string;
    rowCount?: number;
    importedBy?: string;
  }): Promise<ImportBatchRecord> {
    const result = await this.db.query<Row>(
      `insert into import_batches (import_kind, file_name, file_hash_sha256, row_count, status, imported_by)
       values ($1, $2, $3, $4, 'received', $5::uuid) returning *`,
      [
        input.importKind,
        input.fileName ?? null,
        input.fileHashSha256 ?? null,
        input.rowCount ?? null,
        input.importedBy ?? null,
      ],
    );
    return toRecord(result.rows[0]!);
  }

  async getById(id: string): Promise<ImportBatchRecord | undefined> {
    const result = await this.db.query<Row>('select * from import_batches where id = $1::uuid', [
      id,
    ]);
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  /** Idempotency: an already-committed batch with the same file hash is reused. */
  async findByFileHash(fileHashSha256: string): Promise<ImportBatchRecord | undefined> {
    const result = await this.db.query<Row>(
      `select * from import_batches where file_hash_sha256 = $1
       and status in ('loaded','partially_loaded') order by started_at desc limit 1`,
      [fileHashSha256],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async list(limit = 100): Promise<ImportBatchRecord[]> {
    const result = await this.db.query<Row>(
      'select * from import_batches order by started_at desc limit $1',
      [limit],
    );
    return result.rows.map(toRecord);
  }

  async updateStatus(
    id: string,
    status: ImportBatchDbStatus,
    detail: { errorSummary?: string; rowCount?: number; finished?: boolean } = {},
  ): Promise<ImportBatchRecord> {
    const result = await this.db.query<Row>(
      `update import_batches
       set status = $2,
           error_summary = coalesce($3, error_summary),
           row_count = coalesce($4, row_count),
           finished_at = case when $5 then now() else finished_at end
       where id = $1::uuid returning *`,
      [id, status, detail.errorSummary ?? null, detail.rowCount ?? null, detail.finished ?? false],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown import batch: ${id}`);
    return toRecord(row);
  }

  async addError(input: {
    batchId: string;
    rowNumber?: number;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    await this.db.query(
      `insert into import_errors (batch_id, row_number, error_code, error_message)
       values ($1::uuid, $2, $3, $4)`,
      [input.batchId, input.rowNumber ?? null, input.errorCode, input.errorMessage],
    );
  }

  async listErrors(
    batchId: string,
  ): Promise<Array<{ rowNumber: number | undefined; errorCode: string; errorMessage: string }>> {
    const result = await this.db.query<{
      row_number: number | null;
      error_code: string;
      error_message: string;
    }>('select * from import_errors where batch_id = $1::uuid order by row_number', [batchId]);
    return result.rows.map((row) => ({
      rowNumber: row.row_number ?? undefined,
      errorCode: row.error_code,
      errorMessage: row.error_message,
    }));
  }
}
