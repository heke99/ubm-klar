#!/usr/bin/env node
/**
 * UBM Klar migration and release runner.
 *
 * Commands:
 *   preflight   --release <v>            verify manifest, checksums, order and signature policy
 *   checksums   --release <v>            (re)generate checksums.txt for the release
 *   sign        --release <v>            sign the manifest with RELEASE_SIGNING_PRIVATE_KEY (ed25519)
 *   verify-signature --release <v>       verify signature.sig against the manifest
 *   dry-run     --release <v> [--db url] apply all migrations inside a rolled-back tx
 *   apply       --release <v> --db url   apply migrations (expand-migrate-contract, no destructive ops)
 *   smoke-test  --release <v> --db url   run release smoke tests
 *   rollback-plan --release <v>          print the rollback plan
 *
 * Signature policy (fail closed):
 *   - local/demo/test environments may run with the UNSIGNED placeholder.
 *   - stage/prod require a valid ed25519 signature verified with
 *     RELEASE_SIGNING_PUBLIC_KEY. Unsigned or unverifiable releases are refused.
 *
 * Status updates (no PII) are POSTed to the control plane when
 * CONTROL_PLANE_URL and TENANT_ID/ENVIRONMENT are set.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const PRODUCTION_LIKE_ENVIRONMENTS = new Set(['stage', 'prod', 'production']);

function currentEnvironment() {
  const explicit = (process.env.ENVIRONMENT ?? process.env.APP_ENV ?? '').toLowerCase();
  if (explicit) return explicit;
  if ((process.env.NODE_ENV ?? '').toLowerCase() === 'production') return 'prod';
  return 'local';
}

function isProductionLike() {
  return PRODUCTION_LIKE_ENVIRONMENTS.has(currentEnvironment());
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      args[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    }
  }
  return args;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function migrationFiles() {
  const dir = join(root, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, path: join(dir, name), sql: readFileSync(join(dir, name), 'utf8') }));
}

const DESTRUCTIVE_PATTERNS = [
  /\bdrop\s+table\s+(?!if\s+exists\s+_)/i,
  /\bdrop\s+column\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\s+(?!.*where)/i,
];

function releaseDir(version) {
  return join(root, 'releases', version);
}

async function postControlPlaneStatus(phase, status, detail) {
  const url = process.env.CONTROL_PLANE_URL;
  const tenantId = process.env.TENANT_ID;
  if (!url || !tenantId) return;
  try {
    // no-PII payload: phase, status, migration name only
    await fetch(`${url}/tenants/${tenantId}/migration-status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        environment: process.env.ENVIRONMENT ?? 'local',
        phase,
        status,
        detail,
      }),
    });
  } catch {
    console.warn('control-plane status update failed (continuing)');
  }
}

function manifestDigest(manifest) {
  // Deterministic digest of the migration lists (data plane + control plane).
  return sha256(
    JSON.stringify({
      release: manifest.release,
      migrations: manifest.migrations,
      controlPlaneMigrations: manifest.controlPlaneMigrations,
    }),
  );
}

function readManifest(version) {
  return JSON.parse(readFileSync(join(releaseDir(version), 'migration-manifest.json'), 'utf8'));
}

function checksums(version) {
  const files = migrationFiles();
  const lines = files.map((f) => `${sha256(f.sql)}  supabase/migrations/${f.name}`);
  const manifestPath = join(releaseDir(version), 'migration-manifest.json');
  const manifest = {
    release: version,
    generatedAt: new Date().toISOString(),
    migrations: files.map((f) => ({ name: f.name, sha256: sha256(f.sql) })),
    controlPlaneMigrations: readdirSync(join(root, 'apps/control-plane/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((name) => ({
        name,
        sha256: sha256(readFileSync(join(root, 'apps/control-plane/migrations', name), 'utf8')),
      })),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(releaseDir(version), 'checksums.txt'), lines.join('\n') + '\n');
  if (process.env.RELEASE_SIGNING_PRIVATE_KEY) {
    signRelease(version);
  } else {
    // Unsigned placeholder is only valid for local/demo/test. Preflight refuses it
    // in stage/prod (fail closed).
    writeFileSync(
      join(releaseDir(version), 'signature.sig'),
      `UNSIGNED release ${version} manifest-sha256=${manifestDigest(manifest)}\n`,
    );
  }
  console.info(`checksums + manifest written for release ${version} (${files.length} migrations)`);
}

function signRelease(version) {
  const pem = process.env.RELEASE_SIGNING_PRIVATE_KEY;
  if (!pem) {
    console.error('RELEASE_SIGNING_PRIVATE_KEY is not set; cannot sign the release.');
    process.exit(1);
  }
  const manifest = readManifest(version);
  const digest = manifestDigest(manifest);
  const key = createPrivateKey(
    pem.includes('BEGIN') ? pem : Buffer.from(pem, 'base64').toString('utf8'),
  );
  const signature = edSign(null, Buffer.from(digest, 'utf8'), key).toString('base64');
  writeFileSync(
    join(releaseDir(version), 'signature.sig'),
    `SIGNED release ${version} manifest-sha256=${digest} ed25519=${signature}\n`,
  );
  console.info(`release ${version} signed (ed25519, manifest digest ${digest.slice(0, 12)}…)`);
}

/**
 * Verifies the release signature. Returns a list of errors (empty when valid for
 * the current environment). stage/prod fail closed on unsigned or unverifiable
 * releases; local/demo/test accept the UNSIGNED placeholder when the digest matches.
 */
function signatureErrors(version) {
  const errors = [];
  const sigPath = join(releaseDir(version), 'signature.sig');
  if (!existsSync(sigPath)) {
    errors.push(`missing releases/${version}/signature.sig`);
    return errors;
  }
  const raw = readFileSync(sigPath, 'utf8').trim();
  const manifest = readManifest(version);
  const digest = manifestDigest(manifest);
  const digestMatch = raw.match(/manifest-sha256=([0-9a-f]{64})/);
  if (!digestMatch) {
    errors.push('signature.sig has no manifest-sha256 digest');
    return errors;
  }
  if (digestMatch[1] !== digest) {
    errors.push(
      'signature.sig digest does not match the current manifest (re-run checksums + sign)',
    );
  }
  if (raw.startsWith('UNSIGNED')) {
    if (isProductionLike()) {
      errors.push(
        `release ${version} is UNSIGNED. stage/prod require a signed release ` +
          '(set RELEASE_SIGNING_PRIVATE_KEY and run "release-runner sign").',
      );
    }
    return errors;
  }
  const sigMatch = raw.match(/ed25519=([A-Za-z0-9+/=]+)/);
  if (!sigMatch) {
    errors.push('signature.sig is not UNSIGNED but has no ed25519 signature');
    return errors;
  }
  const publicKeyPem = process.env.RELEASE_SIGNING_PUBLIC_KEY;
  if (!publicKeyPem) {
    if (isProductionLike()) {
      errors.push(
        'RELEASE_SIGNING_PUBLIC_KEY is not set; cannot verify the release signature in stage/prod.',
      );
    } else {
      console.warn(
        'signature present but RELEASE_SIGNING_PUBLIC_KEY not set; skipping cryptographic verification (non-production).',
      );
    }
    return errors;
  }
  const key = createPublicKey(
    publicKeyPem.includes('BEGIN')
      ? publicKeyPem
      : Buffer.from(publicKeyPem, 'base64').toString('utf8'),
  );
  const valid = edVerify(
    null,
    Buffer.from(digest, 'utf8'),
    key,
    Buffer.from(sigMatch[1], 'base64'),
  );
  if (!valid)
    errors.push(
      `release ${version} signature verification FAILED (wrong key or tampered manifest)`,
    );
  return errors;
}

function verifySignature(version) {
  const errors = signatureErrors(version);
  if (errors.length > 0) {
    console.error('SIGNATURE VERIFICATION FAILED:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const raw = readFileSync(join(releaseDir(version), 'signature.sig'), 'utf8').trim();
  console.info(
    raw.startsWith('UNSIGNED')
      ? `release ${version} is UNSIGNED (allowed in ${currentEnvironment()} only)`
      : `release ${version} signature valid`,
  );
}

function preflight(version) {
  const errors = [];
  const dir = releaseDir(version);
  for (const required of [
    'migration-manifest.json',
    'checksums.txt',
    'release-notes.md',
    'rollback-plan.md',
    'smoke-tests.json',
    'compatibility-matrix.json',
  ]) {
    if (!existsSync(join(dir, required))) errors.push(`missing releases/${version}/${required}`);
  }
  const files = migrationFiles();
  if (existsSync(join(dir, 'migration-manifest.json'))) {
    const manifest = JSON.parse(readFileSync(join(dir, 'migration-manifest.json'), 'utf8'));
    for (const entry of manifest.migrations) {
      const file = files.find((f) => f.name === entry.name);
      if (!file) errors.push(`manifest lists ${entry.name} but the file is missing`);
      else if (sha256(file.sql) !== entry.sha256)
        errors.push(`checksum mismatch for ${entry.name} (file was modified after packaging)`);
    }
    for (const file of files) {
      if (!manifest.migrations.some((m) => m.name === file.name)) {
        errors.push(`migration ${file.name} is not in the manifest (re-run checksums)`);
      }
    }
  }
  const names = files.map((f) => f.name);
  const sorted = [...names].sort();
  if (JSON.stringify(names) !== JSON.stringify(sorted)) errors.push('migrations are not ordered');
  // Deterministic ordering requires unique timestamp prefixes: two files sharing a
  // prefix sort by the rest of the filename, which is accidental, not intentional.
  const prefixes = new Map();
  for (const name of names) {
    const prefix = name.split('_')[0];
    if (prefixes.has(prefix)) {
      errors.push(
        `duplicate migration timestamp ${prefix}: "${prefixes.get(prefix)}" and "${name}" — ordering is not deterministic`,
      );
    } else {
      prefixes.set(prefix, name);
    }
  }
  if (existsSync(join(dir, 'migration-manifest.json'))) {
    errors.push(...signatureErrors(version));
  }
  for (const file of files) {
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(file.sql)) {
        errors.push(
          `${file.name} contains a destructive statement (${pattern}). Use expand-migrate-contract.`,
        );
      }
    }
  }
  if (errors.length > 0) {
    console.error('PREFLIGHT FAILED:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.info(
    `preflight passed: ${files.length} migrations, manifest verified, no destructive statements`,
  );
}

function requireDb(args) {
  const db = args.db ?? process.env.DATABASE_URL;
  if (!db) {
    console.error('Missing --db <url> (or DATABASE_URL). Refusing to run against nothing.');
    process.exit(1);
  }
  return db;
}

function runPsql(db, sql) {
  return execFileSync('psql', [db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-c', sql], {
    encoding: 'utf8',
  });
}

function dryRun(version, args) {
  preflight(version);
  const db = requireDb(args);
  const files = migrationFiles();
  const combined = files.map((f) => `-- ${f.name}\n${f.sql}`).join('\n\n');
  const wrapped = `begin;\n${combined}\nrollback;`;
  execFileSync('psql', [db, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
    input: wrapped,
    encoding: 'utf8',
  });
  postControlPlaneStatus('dry_run', 'succeeded', `${files.length} migrations`);
  console.info(`dry-run OK: all ${files.length} migrations applied and rolled back cleanly`);
}

function apply(version, args) {
  preflight(version);
  const db = requireDb(args);
  if (process.env.ENVIRONMENT === 'prod' && process.env.BACKUP_VERIFIED !== 'true') {
    console.error('Refusing to apply to prod without BACKUP_VERIFIED=true (backup-check gate).');
    process.exit(1);
  }
  runPsql(
    db,
    `create table if not exists schema_migrations (
       name text primary key, sha256 text not null, applied_at timestamptz not null default now())`,
  );
  const appliedRaw = runPsql(db, 'select name from schema_migrations order by name');
  const applied = new Set(
    appliedRaw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('.sql')),
  );
  let count = 0;
  for (const file of migrationFiles()) {
    if (applied.has(file.name)) continue;
    const wrapped = `begin;\n${file.sql}\ninsert into schema_migrations(name, sha256) values ('${file.name}', '${sha256(file.sql)}');\ncommit;`;
    execFileSync('psql', [db, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
      input: wrapped,
      encoding: 'utf8',
    });
    console.info(`applied ${file.name}`);
    count++;
  }
  postControlPlaneStatus('apply', 'succeeded', `${count} migrations applied`);
  console.info(count === 0 ? 'nothing to apply' : `applied ${count} migrations`);
}

function smokeTest(version, args) {
  const db = requireDb(args);
  const tests = JSON.parse(readFileSync(join(releaseDir(version), 'smoke-tests.json'), 'utf8'));
  let failed = 0;
  for (const test of tests.tests) {
    try {
      const output = runPsql(db, test.sql);
      if (test.expectContains && !output.includes(test.expectContains)) {
        console.error(`FAIL ${test.name}: expected output to contain "${test.expectContains}"`);
        failed++;
      } else {
        console.info(`PASS ${test.name}`);
      }
    } catch (error) {
      console.error(`FAIL ${test.name}: ${error.message}`);
      failed++;
    }
  }
  postControlPlaneStatus(
    'smoke_test',
    failed === 0 ? 'succeeded' : 'failed',
    `${tests.tests.length - failed}/${tests.tests.length}`,
  );
  if (failed > 0) process.exit(1);
  console.info(`smoke tests passed (${tests.tests.length})`);
}

const args = parseArgs(process.argv.slice(2));
const version = args.release ?? '1.0.0';

switch (args.command) {
  case 'checksums':
    checksums(version);
    break;
  case 'sign':
    signRelease(version);
    break;
  case 'verify-signature':
    verifySignature(version);
    break;
  case 'preflight':
    preflight(version);
    break;
  case 'dry-run':
    dryRun(version, args);
    break;
  case 'apply':
    apply(version, args);
    break;
  case 'smoke-test':
    smokeTest(version, args);
    break;
  case 'rollback-plan':
    execSync(`cat ${join(releaseDir(version), 'rollback-plan.md')}`, { stdio: 'inherit' });
    break;
  default:
    console.error(
      'unknown command. Use: preflight | checksums | sign | verify-signature | dry-run | apply | smoke-test | rollback-plan',
    );
    process.exit(1);
}
