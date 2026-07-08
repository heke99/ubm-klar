import type { WorkerJobType } from './jobs';

/**
 * Standard job pipelines. Each step is a job family; the queue chains them so
 * a completed step enqueues the next with the same correlation id.
 */
export interface PipelineDefinition {
  key: string;
  description: string;
  steps: WorkerJobType[];
}

/** Import completed → normalization → mapping → ... → dashboard/report. */
export const IMPORT_PIPELINE: PipelineDefinition = {
  key: 'import',
  description:
    'Import → normalisering → fältmappning → system-of-record-länkning → lineage → datakvalitet → regelmotor → riskflaggor → kontrollärende vid behov → rapport',
  steps: [
    'import-jobs',
    'mapping-jobs',
    'validation-jobs',
    'data-quality-jobs',
    'rule-engine-jobs',
    'payment-control-jobs',
    'report-jobs',
  ],
};

/** UBM request → matching → checks → eligibility → proposal → review → package → receipt. */
export const UBM_PIPELINE: PipelineDefinition = {
  key: 'ubm-request',
  description:
    'UBM-förfrågan → matchning → lineage-/klassningskontroll → behörighetsbedömning → exportförslag → granskning → maskning vid behov → maker-checker → paket → hash/signatur → leverans → kvittens → beviskedja',
  steps: [
    'validation-jobs',
    'data-quality-jobs',
    'rule-engine-jobs',
    'document-redaction-jobs',
    'export-jobs',
    'notification-jobs',
    'report-jobs',
  ],
};

/** Payment file imported → parsed → matched → reconciled → flags → cases. */
export const PAYMENT_PIPELINE: PipelineDefinition = {
  key: 'payment-file',
  description:
    'Betalningsfil importerad → rader tolkade → mottagare matchade → beslut matchade → fakturor matchade → betalstatus uppdaterad → avstämningsresultat → riskflaggor → kontrollärenden vid behov',
  steps: [
    'import-jobs',
    'mapping-jobs',
    'reconciliation-jobs',
    'payment-control-jobs',
    'rule-engine-jobs',
    'report-jobs',
  ],
};

export const ALL_PIPELINES: PipelineDefinition[] = [
  IMPORT_PIPELINE,
  UBM_PIPELINE,
  PAYMENT_PIPELINE,
];

export function nextStep(
  pipeline: PipelineDefinition,
  currentStep: WorkerJobType,
): WorkerJobType | undefined {
  const index = pipeline.steps.indexOf(currentStep);
  if (index === -1) return undefined;
  return pipeline.steps[index + 1];
}
