import { buildApiServer } from './server';
import type { TenantDirectory } from '@ubm-klar/tenant-resolver';

// Production deployments back the directory with the control plane API.
// Local development uses the demo tenant on localhost (fail-closed otherwise).
const emptyDirectory: TenantDirectory = { lookupByDomain: async () => undefined };

const isProduction =
  process.env.NODE_ENV === 'production' ||
  ['stage', 'prod', 'production'].includes((process.env.APP_ENV ?? '').toLowerCase());

if (isProduction) {
  // Fail closed: without a real tenant directory every domain would 421 and the
  // demo tenant must never be reachable. Refuse to start rather than serve a
  // useless or unsafe API. The control-plane-backed directory is wired via
  // CONTROL_PLANE_URL (Pilot Batch 4).
  if (!process.env.CONTROL_PLANE_URL) {
    console.error(
      'FATAL: production start refused — no tenant directory configured (CONTROL_PLANE_URL missing). ' +
        'The API must not run in production with an empty tenant directory or the demo tenant.',
    );
    process.exit(1);
  }
}

const port = Number(process.env.API_PORT ?? 3001);
const app = buildApiServer({
  directory: emptyDirectory,
  allowDemoTenant: !isProduction,
});

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.info(`api listening on :${port}`);
});
