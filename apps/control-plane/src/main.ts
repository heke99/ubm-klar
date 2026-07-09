import { loadAppConfig, UnsafeProductionConfigError } from '@ubm-klar/config';
import { buildControlPlaneServer } from './server';
import { InMemoryControlPlaneStore } from './store';

const config = (() => {
  try {
    return loadAppConfig('control-plane');
  } catch (error) {
    if (error instanceof UnsafeProductionConfigError) {
      console.error(`FATAL: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
})();

if (config.isProductionLike && config.controlPlane.store !== 'postgres') {
  // Defense in depth: loadAppConfig already forbids the in-memory store in
  // stage/prod. The in-memory store loses all tenants, domains and readiness
  // gates on restart and must never back a production control plane.
  console.error('FATAL: production start refused — InMemoryControlPlaneStore is forbidden.');
  process.exit(1);
}

const port = Number(process.env.CONTROL_PLANE_PORT ?? 3100);
const app = buildControlPlaneServer({ store: new InMemoryControlPlaneStore() });

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.info(`control-plane listening on :${port} (${config.mode}, no-PII enforced)`);
});
