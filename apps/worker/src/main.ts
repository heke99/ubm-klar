import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { loadAppConfig, UnsafeProductionConfigError } from '@ubm-klar/config';
import { createDbClient, type DbClient } from '@ubm-klar/db';
import { applyQueueSchema, InMemoryQueue, PgQueue, type JobQueue } from '@ubm-klar/queue';
import { createDefaultRegistry } from './handlers';
import { workerHealth, type WorkerJob, type WorkerJobType } from './jobs';

/**
 * Worker runtime: continuous queue consumer + health endpoint.
 * Production requires a persistent queue (loadAppConfig enforces this) and
 * never runs in no-op mode.
 */

const config = (() => {
  try {
    return loadAppConfig('worker');
  } catch (error) {
    if (error instanceof UnsafeProductionConfigError) {
      console.error(`FATAL: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
})();

if (config.isProductionLike && (config.worker.mode !== 'queue' || !config.queue.url)) {
  console.error('FATAL: production start refused — no-op worker mode is forbidden.');
  process.exit(1);
}

const dataPlaneUrl = process.env.DATA_PLANE_DATABASE_URL;
const dataPlane: DbClient | undefined = dataPlaneUrl
  ? createDbClient({ connectionString: dataPlaneUrl, applicationName: 'ubm-klar-worker' })
  : undefined;

async function selectQueue(): Promise<JobQueue> {
  if (config.queue.url) {
    const queueDb = createDbClient({
      connectionString: config.queue.url,
      applicationName: 'ubm-klar-worker-queue',
    });
    await applyQueueSchema(queueDb);
    return new PgQueue(queueDb);
  }
  if (config.isProductionLike) {
    console.error('FATAL: production start refused — persistent queue missing.');
    process.exit(1);
  }
  console.warn('worker using InMemoryQueue (local/test only)');
  return new InMemoryQueue();
}

const queue = await selectQueue();
const registry = createDefaultRegistry(dataPlane ? { db: dataPlane } : {});
const workerId = `${hostname()}:${process.pid}`;
let running = true;
let lastError: string | undefined;

async function pollOnce(): Promise<boolean> {
  const claimed = await queue.claim(workerId);
  if (!claimed) return false;
  const job: WorkerJob = {
    id: claimed.id,
    type: claimed.type as WorkerJobType,
    tenantId: claimed.tenantSlug,
    environment: claimed.environment as WorkerJob['environment'],
    payloadReference: claimed.payloadReference ?? '',
    attempts: claimed.attempts,
    maxAttempts: claimed.maxAttempts,
    status: 'running',
    enqueuedAt: claimed.enqueuedAt,
  };
  const result = await registry.execute(job);
  if (result.status === 'succeeded') {
    await queue.complete(claimed.id, result.summary);
  } else {
    lastError = `${claimed.type}: ${result.errorCode ?? 'unknown'}`;
    await queue.fail(claimed.id, result.errorCode ?? 'E_UNKNOWN', JSON.stringify(result.summary));
  }
  return true;
}

async function loop(): Promise<void> {
  while (running) {
    try {
      const processed = await pollOnce();
      if (!processed) await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 200) : 'unknown';
      console.error(`worker loop error: ${lastError}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

const port = Number(process.env.WORKER_PORT ?? 3002);
const server = createServer(async (request, response) => {
  if (request.url === '/health') {
    try {
      const stats = await queue.stats();
      const health = {
        ...workerHealth(registry, stats.queueDepth),
        queueProvider: queue.provider,
        running: stats.running,
        failedJobs: stats.failed,
        deadLetterCount: stats.deadLetter,
        succeededLastHour: stats.succeededLastHour,
        lastSuccessAt: stats.lastSuccessAt ?? null,
        lastError: stats.lastError ?? lastError ?? null,
        mode: config.mode,
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(health));
    } catch {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ service: 'worker', status: 'degraded', queue: 'unreachable' }));
    }
    return;
  }
  if (request.url === '/ready') {
    try {
      await queue.stats();
      if (dataPlane) await dataPlane.query('select 1');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ready: true,
          checks: [
            { name: 'queue', ok: true },
            { name: 'data_plane', ok: Boolean(dataPlane) },
          ],
        }),
      );
    } catch (error) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ready: false,
          detail: error instanceof Error ? error.message.slice(0, 120) : 'dependency failed',
        }),
      );
    }
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, '0.0.0.0', () => {
  console.info(
    `worker listening on :${port} (${config.mode}, queue: ${queue.provider}, data plane: ${dataPlane ? 'connected' : 'none'})`,
  );
});

process.on('SIGTERM', () => {
  running = false;
  server.close();
});
process.on('SIGINT', () => {
  running = false;
  server.close();
});

void loop();
