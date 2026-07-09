import { loadAppConfig, UnsafeProductionConfigError } from '@ubm-klar/config';
import { buildApiServer } from './server';
import type { TenantDirectory } from '@ubm-klar/tenant-resolver';

const config = (() => {
  try {
    return loadAppConfig('api');
  } catch (error) {
    if (error instanceof UnsafeProductionConfigError) {
      console.error(`FATAL: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
})();

// Production deployments back the directory with the control plane API
// (Pilot Batch 4 wires ControlPlaneTenantDirectory). Local development uses
// the demo tenant on localhost (fail-closed otherwise).
const emptyDirectory: TenantDirectory = { lookupByDomain: async () => undefined };

if (config.isProductionLike && !config.controlPlane.url) {
  // Defense in depth: loadAppConfig already requires CONTROL_PLANE_URL.
  console.error('FATAL: production start refused — no tenant directory configured.');
  process.exit(1);
}

const port = Number(process.env.API_PORT ?? 3001);
const app = buildApiServer({
  directory: emptyDirectory,
  allowDemoTenant: config.tenantResolver.allowDemoTenant,
});

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.info(`api listening on :${port} (${config.mode})`);
});
