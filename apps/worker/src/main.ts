import { loadAppConfig, UnsafeProductionConfigError } from '@ubm-klar/config';
import { createDefaultRegistry } from './handlers';
import { workerHealth } from './jobs';

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
  // Defense in depth: loadAppConfig already forbids no-op workers and missing
  // queues in stage/prod. A worker without a persistent queue would either
  // exit immediately or acknowledge jobs it never performed.
  console.error('FATAL: production start refused — no-op worker mode is forbidden.');
  process.exit(1);
}

const registry = createDefaultRegistry();
console.info(JSON.stringify(workerHealth(registry, 0)));
console.info(`worker ready (${config.mode}, queue provider: ${config.queue.provider})`);
