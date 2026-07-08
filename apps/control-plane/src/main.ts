import { buildControlPlaneServer } from './server';
import { InMemoryControlPlaneStore } from './store';

const port = Number(process.env.CONTROL_PLANE_PORT ?? 3100);
const app = buildControlPlaneServer({ store: new InMemoryControlPlaneStore() });

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.info(`control-plane listening on :${port} (no-PII enforced)`);
});
