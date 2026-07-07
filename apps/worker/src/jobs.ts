import { sanitizeTechnicalLogEvent } from '@ubm-klar/data-access-log';
import type { EnvironmentName } from '@ubm-klar/shared-types';

/** All worker job families. */
export type WorkerJobType =
  | 'import-jobs'
  | 'mapping-jobs'
  | 'validation-jobs'
  | 'data-quality-jobs'
  | 'rule-engine-jobs'
  | 'payment-control-jobs'
  | 'reconciliation-jobs'
  | 'export-jobs'
  | 'document-redaction-jobs'
  | 'notification-jobs'
  | 'report-jobs'
  | 'archive-jobs'
  | 'retention-jobs'
  | 'siem-export-jobs'
  | 'anomaly-detection-jobs'
  | 'exit-export-jobs'
  | 'onboarding-jobs'
  | 'provisioning-jobs'
  | 'billing-jobs'
  | 'legal-source-update-jobs';

export const ALL_JOB_TYPES: readonly WorkerJobType[] = [
  'import-jobs',
  'mapping-jobs',
  'validation-jobs',
  'data-quality-jobs',
  'rule-engine-jobs',
  'payment-control-jobs',
  'reconciliation-jobs',
  'export-jobs',
  'document-redaction-jobs',
  'notification-jobs',
  'report-jobs',
  'archive-jobs',
  'retention-jobs',
  'siem-export-jobs',
  'anomaly-detection-jobs',
  'exit-export-jobs',
  'onboarding-jobs',
  'provisioning-jobs',
  'billing-jobs',
  'legal-source-update-jobs',
] as const;

export interface WorkerJob {
  id: string;
  type: WorkerJobType;
  tenantId: string;
  environment: EnvironmentName;
  payloadReference: string;
  attempts: number;
  maxAttempts: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead_letter';
  enqueuedAt: string;
}

export interface JobResult {
  jobId: string;
  status: 'succeeded' | 'failed';
  /** No-PII output summary (validated before leaving the worker). */
  summary: Record<string, unknown>;
  errorCode?: string;
}

export type JobHandler = (job: WorkerJob) => Promise<JobResult>;

export class JobRegistry {
  private handlers = new Map<WorkerJobType, JobHandler>();

  register(type: WorkerJobType, handler: JobHandler): void {
    if (this.handlers.has(type)) throw new Error(`Handler already registered for ${type}`);
    this.handlers.set(type, handler);
  }

  registeredTypes(): WorkerJobType[] {
    return [...this.handlers.keys()];
  }

  async execute(job: WorkerJob): Promise<JobResult> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      return {
        jobId: job.id,
        status: 'failed',
        summary: {},
        errorCode: 'E_NO_HANDLER',
      };
    }
    try {
      const result = await handler(job);
      // Job summaries can end up in technical telemetry: enforce no-PII.
      sanitizeTechnicalLogEvent({
        level: 'info',
        code: `JOB_${job.type.toUpperCase().replaceAll('-', '_')}`,
        message: `job ${job.id} finished`,
        context: result.summary,
      });
      return result;
    } catch (error) {
      return {
        jobId: job.id,
        status: 'failed',
        summary: {},
        errorCode: error instanceof Error ? error.message.slice(0, 120) : 'E_UNKNOWN',
      };
    }
  }
}

export interface WorkerHealth {
  service: 'worker';
  status: 'ok' | 'degraded';
  registeredJobTypes: number;
  expectedJobTypes: number;
  queueDepth: number;
  piiSafe: true;
}

export function workerHealth(registry: JobRegistry, queueDepth: number): WorkerHealth {
  const registered = registry.registeredTypes().length;
  return {
    service: 'worker',
    status: registered === ALL_JOB_TYPES.length ? 'ok' : 'degraded',
    registeredJobTypes: registered,
    expectedJobTypes: ALL_JOB_TYPES.length,
    queueDepth,
    piiSafe: true,
  };
}
