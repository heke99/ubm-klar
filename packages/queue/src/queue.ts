import type { DbClient } from '@ubm-klar/db';

/**
 * Persistent job queue.
 *
 * PgQueue is the production implementation (Postgres, `FOR UPDATE SKIP LOCKED`
 * claims, retries with exponential backoff, dead-letter). InMemoryQueue exists
 * for unit tests ONLY — loadAppConfig forbids it in stage/prod.
 */

export type QueueJobStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'retrying' | 'dead_letter';

export interface QueueJob {
  id: string;
  type: string;
  tenantSlug: string;
  environment: string;
  payload: Record<string, unknown>;
  payloadReference: string | undefined;
  status: QueueJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | undefined;
  errorCode: string | undefined;
  enqueuedAt: string;
  finishedAt: string | undefined;
}

export interface EnqueueInput {
  type: string;
  tenantSlug: string;
  environment: string;
  payload?: Record<string, unknown>;
  payloadReference?: string;
  maxAttempts?: number;
  /** Delay before the job becomes claimable (ms). */
  delayMs?: number;
}

export interface QueueStats {
  queueDepth: number;
  running: number;
  failed: number;
  deadLetter: number;
  succeededLastHour: number;
  lastSuccessAt: string | undefined;
  lastError: string | undefined;
}

export interface JobQueue {
  readonly provider: 'postgres' | 'in-memory';
  enqueue(input: EnqueueInput): Promise<string>;
  /** Claims the next runnable job (locked for this worker) or undefined. */
  claim(workerId: string, types?: string[]): Promise<QueueJob | undefined>;
  complete(jobId: string, summary: Record<string, unknown>): Promise<void>;
  /** Fails the job: retries with backoff until maxAttempts, then dead_letter. */
  fail(jobId: string, errorCode: string, message: string): Promise<void>;
  stats(): Promise<QueueStats>;
  list(filter?: { status?: QueueJobStatus; limit?: number }): Promise<QueueJob[]>;
}

export const QUEUE_MIGRATION_SQL = `
create extension if not exists pgcrypto;
create table if not exists worker_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  tenant_slug text not null,
  environment text not null,
  payload jsonb not null default '{}'::jsonb,
  payload_reference text,
  status text not null default 'queued' check (status in
    ('queued','running','succeeded','failed','retrying','dead_letter')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  error_code text,
  result_summary jsonb,
  enqueued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists worker_jobs_claim_idx on worker_jobs (status, run_at);
create index if not exists worker_jobs_type_idx on worker_jobs (type, status);
`;

export async function applyQueueSchema(db: DbClient): Promise<void> {
  await db.query(QUEUE_MIGRATION_SQL);
}

interface Row {
  id: string;
  type: string;
  tenant_slug: string;
  environment: string;
  payload: Record<string, unknown>;
  payload_reference: string | null;
  status: QueueJobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  error_code: string | null;
  enqueued_at: Date;
  finished_at: Date | null;
}

function toJob(row: Row): QueueJob {
  return {
    id: row.id,
    type: row.type,
    tenantSlug: row.tenant_slug,
    environment: row.environment,
    payload: row.payload,
    payloadReference: row.payload_reference ?? undefined,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error ?? undefined,
    errorCode: row.error_code ?? undefined,
    enqueuedAt: row.enqueued_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : undefined,
  };
}

export class PgQueue implements JobQueue {
  readonly provider = 'postgres' as const;
  constructor(private readonly db: DbClient) {}

  async enqueue(input: EnqueueInput): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into worker_jobs (type, tenant_slug, environment, payload, payload_reference, max_attempts, run_at)
       values ($1, $2, $3, $4::jsonb, $5, $6, now() + ($7 || ' milliseconds')::interval)
       returning id`,
      [
        input.type,
        input.tenantSlug,
        input.environment,
        JSON.stringify(input.payload ?? {}),
        input.payloadReference ?? null,
        input.maxAttempts ?? 3,
        input.delayMs ?? 0,
      ],
    );
    return result.rows[0]!.id;
  }

  async claim(workerId: string, types?: string[]): Promise<QueueJob | undefined> {
    const typeClause = types && types.length > 0 ? 'and type = any($2)' : '';
    const params: unknown[] = [workerId];
    if (types && types.length > 0) params.push(types);
    const result = await this.db.query<Row>(
      `update worker_jobs set
         status = 'running',
         attempts = attempts + 1,
         locked_by = $1,
         locked_at = now(),
         started_at = coalesce(started_at, now())
       where id = (
         select id from worker_jobs
         where status in ('queued', 'retrying') and run_at <= now() ${typeClause}
         order by run_at
         for update skip locked
         limit 1
       )
       returning *`,
      params,
    );
    return result.rows[0] ? toJob(result.rows[0]) : undefined;
  }

  async complete(jobId: string, summary: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `update worker_jobs set status = 'succeeded', result_summary = $2::jsonb,
         finished_at = now(), locked_by = null
       where id = $1::uuid`,
      [jobId, JSON.stringify(summary)],
    );
  }

  async fail(jobId: string, errorCode: string, message: string): Promise<void> {
    // Retry with exponential backoff until max_attempts, then dead-letter.
    await this.db.query(
      `update worker_jobs set
         status = case when attempts >= max_attempts then 'dead_letter' else 'retrying' end,
         run_at = now() + (power(2, attempts) || ' seconds')::interval,
         last_error = $3,
         error_code = $2,
         locked_by = null,
         finished_at = case when attempts >= max_attempts then now() else null end
       where id = $1::uuid`,
      [jobId, errorCode, message.slice(0, 500)],
    );
  }

  async stats(): Promise<QueueStats> {
    const result = await this.db.query<{
      queue_depth: string;
      running: string;
      failed: string;
      dead_letter: string;
      succeeded_last_hour: string;
      last_success_at: Date | null;
      last_error: string | null;
    }>(
      `select
         (select count(*) from worker_jobs where status in ('queued','retrying')) as queue_depth,
         (select count(*) from worker_jobs where status = 'running') as running,
         (select count(*) from worker_jobs where status in ('failed','retrying')) as failed,
         (select count(*) from worker_jobs where status = 'dead_letter') as dead_letter,
         (select count(*) from worker_jobs where status = 'succeeded' and finished_at > now() - interval '1 hour') as succeeded_last_hour,
         (select max(finished_at) from worker_jobs where status = 'succeeded') as last_success_at,
         (select last_error from worker_jobs where last_error is not null order by finished_at desc nulls last limit 1) as last_error`,
    );
    const row = result.rows[0]!;
    return {
      queueDepth: Number(row.queue_depth),
      running: Number(row.running),
      failed: Number(row.failed),
      deadLetter: Number(row.dead_letter),
      succeededLastHour: Number(row.succeeded_last_hour),
      lastSuccessAt: row.last_success_at?.toISOString(),
      lastError: row.last_error ?? undefined,
    };
  }

  async list(filter: { status?: QueueJobStatus; limit?: number } = {}): Promise<QueueJob[]> {
    const result = await this.db.query<Row>(
      filter.status
        ? 'select * from worker_jobs where status = $1 order by enqueued_at desc limit $2'
        : 'select * from worker_jobs order by enqueued_at desc limit $1',
      filter.status ? [filter.status, filter.limit ?? 100] : [filter.limit ?? 100],
    );
    return result.rows.map(toJob);
  }
}

/** Test-only queue. Forbidden in stage/prod by configuration. */
export class InMemoryQueue implements JobQueue {
  readonly provider = 'in-memory' as const;
  private jobs = new Map<string, QueueJob & { runAt: number }>();
  private counter = 0;

  async enqueue(input: EnqueueInput): Promise<string> {
    const id = `mem-${++this.counter}`;
    this.jobs.set(id, {
      id,
      type: input.type,
      tenantSlug: input.tenantSlug,
      environment: input.environment,
      payload: input.payload ?? {},
      payloadReference: input.payloadReference,
      status: 'queued',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      lastError: undefined,
      errorCode: undefined,
      enqueuedAt: new Date().toISOString(),
      finishedAt: undefined,
      runAt: Date.now() + (input.delayMs ?? 0),
    });
    return id;
  }

  async claim(_workerId: string, types?: string[]): Promise<QueueJob | undefined> {
    for (const job of this.jobs.values()) {
      if (
        (job.status === 'queued' || job.status === 'retrying') &&
        job.runAt <= Date.now() &&
        (!types || types.includes(job.type))
      ) {
        job.status = 'running';
        job.attempts += 1;
        return { ...job };
      }
    }
    return undefined;
  }

  async complete(jobId: string, _summary: Record<string, unknown> = {}): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'succeeded';
      job.finishedAt = new Date().toISOString();
    }
  }

  async fail(jobId: string, errorCode: string, message: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.errorCode = errorCode;
    job.lastError = message;
    if (job.attempts >= job.maxAttempts) {
      job.status = 'dead_letter';
      job.finishedAt = new Date().toISOString();
    } else {
      job.status = 'retrying';
      job.runAt = Date.now() + 2 ** job.attempts * 1000;
    }
  }

  async stats(): Promise<QueueStats> {
    const jobs = [...this.jobs.values()];
    return {
      queueDepth: jobs.filter((j) => j.status === 'queued' || j.status === 'retrying').length,
      running: jobs.filter((j) => j.status === 'running').length,
      failed: jobs.filter((j) => j.status === 'failed' || j.status === 'retrying').length,
      deadLetter: jobs.filter((j) => j.status === 'dead_letter').length,
      succeededLastHour: jobs.filter((j) => j.status === 'succeeded').length,
      lastSuccessAt: undefined,
      lastError: jobs.find((j) => j.lastError)?.lastError,
    };
  }

  async list(filter: { status?: QueueJobStatus; limit?: number } = {}): Promise<QueueJob[]> {
    return [...this.jobs.values()]
      .filter((j) => !filter.status || j.status === filter.status)
      .slice(0, filter.limit ?? 100)
      .map((j) => ({ ...j }));
  }

  /** Test helper: makes retrying jobs immediately claimable. */
  fastForward(): void {
    for (const job of this.jobs.values()) job.runAt = 0;
  }
}
