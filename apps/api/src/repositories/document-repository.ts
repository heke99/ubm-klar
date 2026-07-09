import type { DbClient } from '@ubm-klar/db';

export interface DocumentRecord {
  id: string;
  bucketKey: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHashSha256: string;
  documentType: string;
  documentClass: string;
  personId: string | undefined;
  caseKind: string | undefined;
  caseId: string | undefined;
  malwareScanStatus: string;
  isRedactedVersion: boolean;
  originalDocumentId: string | undefined;
  redactionStatus: string | undefined;
  uploadedBy: string | undefined;
  uploadedAt: string;
}

interface Row {
  id: string;
  bucket_key: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: string | number;
  file_hash_sha256: string;
  document_type: string;
  document_class: string;
  person_id: string | null;
  case_kind: string | null;
  case_id: string | null;
  malware_scan_status: string;
  is_redacted_version: boolean;
  original_document_id: string | null;
  redaction_status: string | null;
  uploaded_by: string | null;
  uploaded_at: Date;
}

function toRecord(row: Row): DocumentRecord {
  return {
    id: row.id,
    bucketKey: row.bucket_key,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSizeBytes: Number(row.file_size_bytes),
    fileHashSha256: row.file_hash_sha256,
    documentType: row.document_type,
    documentClass: row.document_class,
    personId: row.person_id ?? undefined,
    caseKind: row.case_kind ?? undefined,
    caseId: row.case_id ?? undefined,
    malwareScanStatus: row.malware_scan_status,
    isRedactedVersion: row.is_redacted_version,
    originalDocumentId: row.original_document_id ?? undefined,
    redactionStatus: row.redaction_status ?? undefined,
    uploadedBy: row.uploaded_by ?? undefined,
    uploadedAt: row.uploaded_at.toISOString(),
  };
}

export class DocumentRepository {
  constructor(private readonly db: DbClient) {}

  async ensureBucket(
    bucketKey: string,
    storageProvider:
      | 'supabase'
      | 'municipality_s3'
      | 'municipality_azure_blob'
      | 'municipality_file_share' = 'supabase',
  ): Promise<void> {
    await this.db.query(
      `insert into storage_buckets_config (bucket_key, storage_provider)
       values ($1, $2) on conflict (bucket_key) do nothing`,
      [bucketKey, storageProvider],
    );
  }

  async create(input: {
    bucketKey: string;
    storagePath: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    fileHashSha256: string;
    documentType: string;
    documentClass?: string;
    personId?: string;
    caseKind?: string;
    caseId?: string;
    malwareScanStatus?: string;
    isRedactedVersion?: boolean;
    originalDocumentId?: string;
    redactionStatus?: string;
    uploadedBy?: string;
  }): Promise<DocumentRecord> {
    const result = await this.db.query<Row>(
      `insert into documents
         (bucket_key, storage_path, file_name, mime_type, file_size_bytes, file_hash_sha256,
          document_type, document_class, person_id, case_kind, case_id,
          malware_scan_status, malware_scanned_at, is_redacted_version, original_document_id,
          redaction_status, uploaded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10, $11::uuid,
               $12, case when $12 <> 'pending' then now() else null end, $13, $14::uuid, $15, $16::uuid)
       returning *`,
      [
        input.bucketKey,
        input.storagePath,
        input.fileName,
        input.mimeType,
        input.fileSizeBytes,
        input.fileHashSha256,
        input.documentType,
        input.documentClass ?? 'standard',
        input.personId ?? null,
        input.caseKind ?? null,
        input.caseId ?? null,
        input.malwareScanStatus ?? 'pending',
        input.isRedactedVersion ?? false,
        input.originalDocumentId ?? null,
        input.redactionStatus ?? null,
        input.uploadedBy ?? null,
      ],
    );
    return toRecord(result.rows[0]!);
  }

  async getById(id: string): Promise<DocumentRecord | undefined> {
    const result = await this.db.query<Row>(
      'select * from documents where id = $1::uuid and deleted_at is null',
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async list(
    filter: { documentClass?: string; caseId?: string; personId?: string; limit?: number } = {},
  ): Promise<DocumentRecord[]> {
    const clauses: string[] = ['deleted_at is null'];
    const params: unknown[] = [];
    if (filter.documentClass) {
      params.push(filter.documentClass);
      clauses.push(`document_class = $${params.length}`);
    }
    if (filter.caseId) {
      params.push(filter.caseId);
      clauses.push(`case_id = $${params.length}::uuid`);
    }
    if (filter.personId) {
      params.push(filter.personId);
      clauses.push(`person_id = $${params.length}::uuid`);
    }
    params.push(filter.limit ?? 200);
    const result = await this.db.query<Row>(
      `select * from documents where ${clauses.join(' and ')} order by uploaded_at desc limit $${params.length}`,
      params,
    );
    return result.rows.map(toRecord);
  }

  async updateScanStatus(id: string, status: string): Promise<void> {
    await this.db.query(
      `update documents set malware_scan_status = $2, malware_scanned_at = now() where id = $1::uuid`,
      [id, status],
    );
  }

  async updateRedactionStatus(id: string, status: string): Promise<void> {
    await this.db.query('update documents set redaction_status = $2 where id = $1::uuid', [
      id,
      status,
    ]);
  }
}
