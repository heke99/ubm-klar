import { buildApiServer } from './server';
import type { TenantDirectory } from '@ubm-klar/tenant-resolver';

// Production deployments back the directory with the control plane API.
// Local development uses the demo tenant on localhost (fail-closed otherwise).
const emptyDirectory: TenantDirectory = { lookupByDomain: async () => undefined };

const port = Number(process.env.API_PORT ?? 3001);
const app = buildApiServer({
  directory: emptyDirectory,
  allowDemoTenant: process.env.NODE_ENV !== 'production',
});

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.info(`api listening on :${port}`);
});
