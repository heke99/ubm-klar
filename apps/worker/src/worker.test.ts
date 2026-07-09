import { describe, expect, it } from 'vitest';
import { createDbClient } from '@ubm-klar/db';
import { InMemoryQueue } from '@ubm-klar/queue';
import { createDefaultRegistry, NOT_IMPLEMENTED_TYPES } from './handlers';
import { ALL_JOB_TYPES, workerHealth, type WorkerJob } from './jobs';
import { IMPORT_PIPELINE, nextStep } from './pipelines';

const databaseUrl = process.env.DATA_PLANE_TEST_DATABASE_URL;

function makeJob(type: WorkerJob['type'], payloadReference = ''): WorkerJob {
  return {
    id: `job-${type}`,
    type,
    tenantId: 'test',
    environment: 'test',
    payloadReference,
    attempts: 1,
    maxAttempts: 3,
    status: 'running',
    enqueuedAt: new Date().toISOString(),
  };
}

describe('job registry', () => {
  it('registers every job family', () => {
    const registry = createDefaultRegistry();
    expect(registry.registeredTypes().sort()).toEqual([...ALL_JOB_TYPES].sort());
    expect(workerHealth(registry, 0).status).toBe('ok');
  });

  it('unimplemented job types FAIL with NOT_IMPLEMENTED — never fake success', async () => {
    const registry = createDefaultRegistry();
    for (const type of NOT_IMPLEMENTED_TYPES) {
      const result = await registry.execute(makeJob(type));
      expect(result.status, type).toBe('failed');
      expect(result.errorCode, type).toBe('NOT_IMPLEMENTED');
    }
  });

  it('data-plane handlers fail without a database connection (no silent success)', async () => {
    const registry = createDefaultRegistry();
    const result = await registry.execute(makeJob('rule-engine-jobs', 'lss'));
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('NO_DATA_PLANE');
  });

  it('pipelines chain job steps', () => {
    expect(nextStep(IMPORT_PIPELINE, IMPORT_PIPELINE.steps[0]!)).toBe(IMPORT_PIPELINE.steps[1]);
  });
});

describe('queue semantics (in-memory adapter, test only)', () => {
  it('executes jobs, retries on failure and dead-letters after max attempts', async () => {
    const queue = new InMemoryQueue();
    const id = await queue.enqueue({
      type: 'archive-jobs', // NOT_IMPLEMENTED -> always fails
      tenantSlug: 'test',
      environment: 'test',
      maxAttempts: 2,
    });

    const registry = createDefaultRegistry();

    // Attempt 1: fails -> retrying
    let claimed = await queue.claim('w1');
    expect(claimed?.id).toBe(id);
    let result = await registry.execute(makeJob('archive-jobs'));
    await queue.fail(id, result.errorCode!, 'not implemented');
    expect((await queue.list({ status: 'retrying' })).length).toBe(1);

    // Attempt 2: fails -> dead_letter (max attempts reached)
    queue.fastForward();
    claimed = await queue.claim('w1');
    expect(claimed?.id).toBe(id);
    result = await registry.execute(makeJob('archive-jobs'));
    await queue.fail(id, result.errorCode!, 'not implemented');

    const stats = await queue.stats();
    expect(stats.deadLetter).toBe(1);
    expect((await queue.list({ status: 'dead_letter' }))[0]?.errorCode).toBe('NOT_IMPLEMENTED');
  });

  it('successful jobs complete and appear in stats', async () => {
    const queue = new InMemoryQueue();
    const id = await queue.enqueue({ type: 'import-jobs', tenantSlug: 't', environment: 'test' });
    const claimed = await queue.claim('w1');
    expect(claimed?.id).toBe(id);
    await queue.complete(id, { ok: true });
    const stats = await queue.stats();
    expect(stats.queueDepth).toBe(0);
    expect(stats.deadLetter).toBe(0);
  });
});

describe.skipIf(!databaseUrl)('real handlers against the data plane', () => {
  it('data-quality job returns real counts', async () => {
    const db = createDbClient({ connectionString: databaseUrl!, applicationName: 'worker-test' });
    const registry = createDefaultRegistry({ db });
    const result = await registry.execute(makeJob('data-quality-jobs'));
    expect(result.status).toBe('succeeded');
    expect(typeof result.summary.lssPaymentsWithoutDecision).toBe('number');
    await db.end();
  });

  it('rule-engine job (dry run) evaluates the full LSS rule set', async () => {
    const db = createDbClient({ connectionString: databaseUrl!, applicationName: 'worker-test' });
    const registry = createDefaultRegistry({ db });
    const result = await registry.execute(makeJob('rule-engine-jobs', 'lss'));
    expect(result.status).toBe('succeeded');
    expect(result.summary.rulesEvaluated).toBe(25);
    expect(result.summary.dryRun).toBe(true);
    await db.end();
  });

  it('onboarding job verifies audit/data-access persistence and sets gates', async () => {
    const db = createDbClient({ connectionString: databaseUrl!, applicationName: 'worker-test' });
    const registry = createDefaultRegistry({ db });
    const result = await registry.execute(makeJob('onboarding-jobs'));
    expect(result.status).toBe('succeeded');
    expect(result.summary.auditGatePassed).toBe(true);
    const gate = await db.query(
      `select status from production_readiness_evidence where gate_key = 'audit_log_verified'`,
    );
    expect(gate.rows[0]?.status).toBe('passed');
    await db.end();
  });
});

describe.skipIf(!databaseUrl)('PgQueue against Postgres', () => {
  it('enqueue/claim/complete/fail/dead-letter with SKIP LOCKED claims', async () => {
    const { PgQueue, applyQueueSchema } = await import('@ubm-klar/queue');
    const db = createDbClient({ connectionString: databaseUrl!, applicationName: 'queue-test' });
    await applyQueueSchema(db);
    const queue = new PgQueue(db);

    const id = await queue.enqueue({
      type: 'data-quality-jobs',
      tenantSlug: 'test',
      environment: 'test',
      maxAttempts: 1,
    });
    const claimed = await queue.claim('worker-a', ['data-quality-jobs']);
    expect(claimed?.id).toBe(id);
    // Claimed jobs are locked: a second worker cannot claim them.
    const second = await queue.claim('worker-b', ['data-quality-jobs']);
    expect(second?.id).not.toBe(id);
    await queue.complete(id, { verified: true });

    const failId = await queue.enqueue({
      type: 'archive-jobs',
      tenantSlug: 'test',
      environment: 'test',
      maxAttempts: 1,
    });
    const claimedFail = await queue.claim('worker-a', ['archive-jobs']);
    expect(claimedFail?.id).toBe(failId);
    await queue.fail(failId, 'NOT_IMPLEMENTED', 'no handler');
    const deadLetter = await queue.list({ status: 'dead_letter', limit: 200 });
    expect(deadLetter.some((j) => j.id === failId)).toBe(true);

    const stats = await queue.stats();
    expect(stats.deadLetter).toBeGreaterThanOrEqual(1);
    await db.end();
  });
});
