import { loadAppConfig, UnsafeProductionConfigError } from '@ubm-klar/config';
import { applyMigrationsFromDir, createDbClient } from '@ubm-klar/db';
import { buildControlPlaneServer } from './server';
import { InMemoryControlPlaneStore, type ControlPlaneStore } from './store';
import { PostgresControlPlaneStore } from './postgres-store';

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

async function selectStore(): Promise<ControlPlaneStore> {
  if (config.controlPlane.databaseUrl) {
    const db = createDbClient({
      connectionString: config.controlPlane.databaseUrl,
      applicationName: 'ubm-klar-control-plane',
    });
    const migrationsDir = new URL('../migrations', import.meta.url).pathname;
    const applied = await applyMigrationsFromDir(
      db,
      migrationsDir,
      'control_plane_schema_migrations',
    );
    if (applied.length > 0) console.info(`control-plane migrations applied: ${applied.length}`);
    return new PostgresControlPlaneStore(db);
  }
  if (config.isProductionLike) {
    // Defense in depth: loadAppConfig already requires CONTROL_PLANE_DATABASE_URL
    // in stage/prod. The in-memory store loses everything on restart.
    console.error('FATAL: production start refused — InMemoryControlPlaneStore is forbidden.');
    process.exit(1);
  }
  console.warn('control-plane using InMemoryControlPlaneStore (local/demo/test only)');
  return new InMemoryControlPlaneStore();
}

const store = await selectStore();
const port = Number(process.env.CONTROL_PLANE_PORT ?? 3100);
const adminToken = process.env.CONTROL_PLANE_ADMIN_TOKEN;
const directoryToken = process.env.CONTROL_PLANE_DIRECTORY_TOKEN;
const app = buildControlPlaneServer({
  store,
  ...(adminToken ? { adminToken } : {}),
  ...(directoryToken ? { directoryToken } : {}),
});

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.info(`control-plane listening on :${port} (${config.mode}, no-PII enforced)`);
});
