import { createHash } from 'node:crypto';

export type ImportBatchStatus =
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
  fileName?: string;
  fileHashSha256: string;
  rowCount: number;
  status: ImportBatchStatus;
  errorSummary?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ImportError {
  batchId: string;
  rowNumber?: number;
  errorCode: string;
  errorMessage: string;
  /** Any PII in raw fragments must be masked before storage. */
  rawFragmentMasked?: string;
}

export function hashImportFile(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Detects the likely format of an uploaded file from name + content sniffing. */
export function detectFormat(
  fileName: string,
  contentStart: string,
): 'csv' | 'json' | 'xml' | 'excel' | 'unknown' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return 'csv';
  const trimmed = contentStart.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json';
  if (trimmed.startsWith('<')) return 'xml';
  if (trimmed.includes(';') || trimmed.includes(',')) return 'csv';
  return 'unknown';
}

export interface ImportValidationReport {
  batchId: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  errors: ImportError[];
  status: ImportBatchStatus;
}

export function buildValidationReport(
  batchId: string,
  totalRows: number,
  errors: ImportError[],
  warnings: number,
): ImportValidationReport {
  const errorRowNumbers = new Set(errors.map((e) => e.rowNumber));
  const errorRows = errorRowNumbers.size;
  const validRows = totalRows - errorRows;
  let status: ImportBatchStatus;
  if (totalRows === 0 || errorRows === totalRows) status = 'rejected';
  else if (errorRows > 0) status = 'partially_loaded';
  else status = 'loaded';
  return {
    batchId,
    totalRows,
    validRows,
    errorRows,
    warningRows: warnings,
    errors,
    status,
  };
}
