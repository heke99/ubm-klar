import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from './handlers';
import { ALL_JOB_TYPES, workerHealth, type WorkerJob } from './jobs';
import {
  ALL_PIPELINES,
  IMPORT_PIPELINE,
  nextStep,
  PAYMENT_PIPELINE,
  UBM_PIPELINE,
} from './pipelines';

function job(type: WorkerJob['type']): WorkerJob {
  return {
    id: `job-${type}`,
    type,
    tenantId: 'demo-tenant',
    environment: 'demo',
    payloadReference: 'ref-1',
    attempts: 0,
    maxAttempts: 3,
    status: 'queued',
    enqueuedAt: new Date().toISOString(),
  };
}

describe('job registry', () => {
  it('registers handlers for all 20 job families', () => {
    const registry = createDefaultRegistry();
    expect(registry.registeredTypes().sort()).toEqual([...ALL_JOB_TYPES].sort());
    expect(workerHealth(registry, 0).status).toBe('ok');
  });

  it('executes every job family successfully', async () => {
    const registry = createDefaultRegistry();
    for (const type of ALL_JOB_TYPES) {
      const result = await registry.execute(job(type));
      expect(result.status, type).toBe('succeeded');
    }
  });

  it('fails gracefully for unregistered handlers', async () => {
    const registry = createDefaultRegistry();
    const result = await registry.execute({ ...job('import-jobs'), type: 'unknown' as never });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('E_NO_HANDLER');
  });
});

describe('pipelines', () => {
  it('defines the three standard flows', () => {
    expect(ALL_PIPELINES).toHaveLength(3);
    expect(IMPORT_PIPELINE.steps[0]).toBe('import-jobs');
    expect(UBM_PIPELINE.steps).toContain('document-redaction-jobs');
    expect(PAYMENT_PIPELINE.steps).toContain('reconciliation-jobs');
  });

  it('chains steps in order', () => {
    expect(nextStep(IMPORT_PIPELINE, 'import-jobs')).toBe('mapping-jobs');
    expect(nextStep(IMPORT_PIPELINE, 'report-jobs')).toBeUndefined();
    expect(nextStep(IMPORT_PIPELINE, 'exit-export-jobs')).toBeUndefined();
  });
});
