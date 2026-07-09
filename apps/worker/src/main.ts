import { createDefaultRegistry } from './handlers';
import { workerHealth } from './jobs';

const isProduction =
  process.env.NODE_ENV === 'production' ||
  ['stage', 'prod', 'production'].includes((process.env.APP_ENV ?? '').toLowerCase());

if (isProduction && !process.env.WORKER_QUEUE_URL) {
  // Fail closed: without a persistent queue the worker would either exit
  // immediately or acknowledge jobs it never performed. Neither is acceptable
  // in production.
  console.error(
    'FATAL: production start refused — WORKER_QUEUE_URL is not set. ' +
      'A no-op worker must never run in production.',
  );
  process.exit(1);
}

const registry = createDefaultRegistry();
console.info(JSON.stringify(workerHealth(registry, 0)));
console.info('worker ready (queue adapter configured per deployment)');
