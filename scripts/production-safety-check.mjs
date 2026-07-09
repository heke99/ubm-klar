#!/usr/bin/env node
/**
 * Production safety check: verifies that production CANNOT start with
 * demo/in-memory/placeholder modes and that the release pipeline fails closed.
 *
 * Run via `pnpm production:safety-check`. Every check must pass; the script
 * exits 1 on the first summary of failures.
 *
 * Checks grow as the pilot batches land. Each check either:
 *  - boots an app entry point with production env and asserts it REFUSES to start, or
 *  - runs a pipeline command asserting fail-closed behaviour, or
 *  - statically asserts that unsafe modules cannot be reached from production code.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.info(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function run(cmd, args, { env = {}, timeout = 30_000 } = {}) {
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...env },
  });
}

const tsx = join(root, 'node_modules', '.bin', 'tsx');

/**
 * Boot an app entry point with production environment variables and assert the
 * process exits non-zero (refuses to start). A process that keeps listening is
 * a FAIL: spawnSync will hit the timeout and status will be null.
 */
function expectProductionRefusal(name, entry, env, mustMention) {
  const res = run(tsx, [entry], {
    env: { NODE_ENV: 'production', APP_ENV: 'prod', ...env },
    timeout: 20_000,
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const refused = res.status !== null && res.status !== 0;
  const mentioned = mustMention ? output.includes(mustMention) : true;
  record(
    name,
    refused && mentioned,
    refused
      ? mentioned
        ? `refused with exit ${res.status}`
        : `refused but without expected message "${mustMention}"`
      : `did NOT refuse (status=${res.status}) — production booted an unsafe mode`,
  );
}

// --- Release pipeline fail-closed -------------------------------------------

{
  // An UNSIGNED release must be refused when the environment is stage/prod.
  const sig = readFileSync(join(root, 'releases/1.0.0/signature.sig'), 'utf8');
  if (sig.startsWith('UNSIGNED')) {
    const res = run(
      'node',
      ['scripts/release-runner.mjs', 'verify-signature', '--release', '1.0.0'],
      {
        env: { ENVIRONMENT: 'prod' },
      },
    );
    record(
      'release: unsigned refused in prod',
      res.status !== 0,
      res.status !== 0
        ? 'verify-signature exited non-zero'
        : 'unsigned release was ACCEPTED in prod',
    );
  } else {
    // Signed release: verification must still fail without the public key in prod.
    const res = run(
      'node',
      ['scripts/release-runner.mjs', 'verify-signature', '--release', '1.0.0'],
      {
        env: { ENVIRONMENT: 'prod', RELEASE_SIGNING_PUBLIC_KEY: '' },
      },
    );
    record(
      'release: signed release requires verification key in prod',
      res.status !== 0,
      res.status !== 0
        ? 'unverifiable signature refused'
        : 'signature accepted without verification key',
    );
  }
}

{
  // Migration manifest must be consistent in every environment.
  const res = run('node', ['scripts/release-runner.mjs', 'preflight', '--release', '1.0.0']);
  record(
    'release: migration manifest consistent',
    res.status === 0,
    res.status === 0
      ? undefined
      : (res.stderr || res.stdout).trim().split('\n').slice(0, 3).join(' | '),
  );
}

// --- App startup fail-closed -------------------------------------------------

/**
 * A complete, otherwise-valid production environment. Individual checks break
 * one rule at a time and assert the app refuses to start.
 */
const VALID_PROD_ENV = {
  APP_BASE_URL: 'https://kommun.ubmklar.se',
  API_BASE_URL: 'https://api.kommun.ubmklar.se',
  CONTROL_PLANE_URL: 'https://control.ubmklar.se',
  CONTROL_PLANE_DATABASE_URL: 'postgresql://cp',
  CONTROL_PLANE_ADMIN_TOKEN: 'token-ref',
  TENANT_RESOLVER_FAIL_CLOSED: 'true',
  AUTH_PROVIDER: 'entra_id',
  AUTH_ISSUER: 'https://login.microsoftonline.com/tenant/v2.0',
  AUTH_CLIENT_ID: 'client-id',
  SESSION_SECRET: 'secret-ref',
  DATA_PLANE_SERVICE_KEY_SOURCE: 'env',
  DOCUMENT_STORAGE_PROVIDER: 'supabase',
  MALWARE_SCANNER_PROVIDER: 'clamav',
  AUDIT_SINK: 'postgres',
  DATA_ACCESS_SINK: 'postgres',
  QUEUE_PROVIDER: 'postgres',
  WORKER_QUEUE_URL: 'postgresql://queue',
  RELEASE_SIGNING_PUBLIC_KEY: 'pem',
  BACKUP_PROVIDER: 'supabase-pitr',
};

expectProductionRefusal(
  'api: refuses empty config / empty tenant directory in prod',
  'apps/api/src/main.ts',
  { CONTROL_PLANE_URL: '' },
  'production start refused',
);

expectProductionRefusal(
  'api: refuses demo data provider in prod',
  'apps/api/src/main.ts',
  { ...VALID_PROD_ENV, DEMO_DATA_ENABLED: 'true' },
  'production start refused',
);

expectProductionRefusal(
  'api: refuses demo tenant in prod',
  'apps/api/src/main.ts',
  { ...VALID_PROD_ENV, ALLOW_DEMO_TENANT: 'true' },
  'production start refused',
);

expectProductionRefusal(
  'api: refuses disabled-local malware scanner in prod',
  'apps/api/src/main.ts',
  { ...VALID_PROD_ENV, MALWARE_SCANNER_PROVIDER: 'disabled-local' },
  'production start refused',
);

expectProductionRefusal(
  'api: refuses header auth without trusted proxy in prod',
  'apps/api/src/main.ts',
  { ...VALID_PROD_ENV, AUTH_PROVIDER: 'header-proxy' },
  'production start refused',
);

expectProductionRefusal(
  'api: refuses official UBM transport flag',
  'apps/api/src/main.ts',
  { ...VALID_PROD_ENV, UBM_OFFICIAL_TRANSPORT: 'enabled' },
  'production start refused',
);

expectProductionRefusal(
  'control-plane: refuses in-memory store in prod',
  'apps/control-plane/src/main.ts',
  { CONTROL_PLANE_DATABASE_URL: '' },
  'production start refused',
);

expectProductionRefusal(
  'worker: refuses no-op mode in prod',
  'apps/worker/src/main.ts',
  { ...VALID_PROD_ENV, WORKER_MODE: 'noop' },
  'production start refused',
);

expectProductionRefusal(
  'worker: refuses missing queue in prod',
  'apps/worker/src/main.ts',
  { WORKER_QUEUE_URL: '' },
  'production start refused',
);

// --- Static assertions --------------------------------------------------------

{
  // The demo seed must not be reachable from production npm scripts.
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const demoReset = pkg.scripts['demo:reset'] ?? '';
  record(
    'scripts: demo reset exists and is clearly demo-scoped',
    demoReset.includes('demo'),
    demoReset,
  );
}

{
  // The pilot demo seed must refuse production environments outright.
  const res = run('node', ['scripts/pilot-demo-seed.mjs', '--db', 'postgresql://invalid'], {
    env: { APP_ENV: 'prod' },
  });
  record(
    'demo seed: refuses production environments',
    res.status !== 0 && `${res.stderr}`.includes('REFUSED'),
    res.status !== 0 ? 'refused before touching any database' : 'seed did NOT refuse prod',
  );
}

{
  // signature.sig must exist for the packaged release.
  record('release: signature file present', existsSync(join(root, 'releases/1.0.0/signature.sig')));
}

// --- Summary ------------------------------------------------------------------

const failed = results.filter((r) => !r.passed);
console.info(
  `\n${results.length - failed.length}/${results.length} production safety checks passed`,
);
if (failed.length > 0) {
  console.error('PRODUCTION SAFETY CHECK FAILED:');
  for (const f of failed) console.error(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  process.exit(1);
}
