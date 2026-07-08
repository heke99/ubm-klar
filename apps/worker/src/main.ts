import { createDefaultRegistry } from './handlers';
import { workerHealth } from './jobs';

const registry = createDefaultRegistry();
console.info(JSON.stringify(workerHealth(registry, 0)));
console.info('worker ready (queue adapter configured per deployment)');
