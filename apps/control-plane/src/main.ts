import { buildControlPlaneServer } from './server';
import { InMemoryControlPlaneStore } from './store';

const isProduction =
  process.env.NODE_ENV === 'production' ||
  ['stage', 'prod', 'production'].includes((process.env.APP_ENV ?? '').toLowerCase());

if (isProduction && !process.env.CONTROL_PLANE_DATABASE_URL) {
  // Fail closed: the in-memory store loses all tenants, domains and readiness
  // gates on restart and must never back a production control plane.
  console.error(
    'FATAL: production start refused — CONTROL_PLANE_DATABASE_URL is not set. ' +
      'InMemoryControlPlaneStore is only allowed in local/demo/test.',
  );
  process.exit(1);
}

const port = Number(process.env.CONTROL_PLANE_PORT ?? 3100);
const app = buildControlPlaneServer({ store: new InMemoryControlPlaneStore() });

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.info(`control-plane listening on :${port} (no-PII enforced)`);
});
