export type WorkerJobType =
  | 'import'
  | 'mapping'
  | 'validation'
  | 'data_quality'
  | 'risk_rules'
  | 'payment_reconciliation'
  | 'ubm_export'
  | 'document_redaction'
  | 'archive_export'
  | 'exit_export';

export type WorkerJob = {
  id: string;
  type: WorkerJobType;
  tenantId: string;
  environment: 'test' | 'stage' | 'prod';
  piiSafeLogReference?: string;
};
