#!/usr/bin/env node
/**
 * UBM Klar migration and release runner.
 *
 * Commands:
 *   preflight   --release <v>            verify manifest, checksums and migration order
 *   checksums   --release <v>            (re)generate checksums.txt for the release
 *   dry-run     --release <v> [--db url] apply all migrations inside a rolled-back tx
 *   apply       --release <v> --db url   apply migrations (expand-migrate-contract, no destructive ops)
 *   smoke-test  --release <v> --db url   run release smoke tests
 *   rollback-plan --release <v>          print the rollback plan
 *
 * Status updates (no PII) are POSTed to the control plane when
 * CONTROL_PLANE_URL and TENANT_ID/ENVIRONMENT are set.
 */
import { createHash } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

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
  // Signature placeholder: production releases are signed with the vendor release key.
  writeFileSync(
    join(releaseDir(version), 'signature.sig'),
    `UNSIGNED release ${version} manifest-sha256=${sha256(JSON.stringify(manifest.migrations))}\n`,
  );
  console.info(`checksums + manifest written for release ${version} (${files.length} migrations)`);
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
  console.info(`preflight passed: ${files.length} migrations, manifest verified, no destructive statements`);
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
    appliedRaw.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.sql')),
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
  postControlPlaneStatus('smoke_test', failed === 0 ? 'succeeded' : 'failed', `${tests.tests.length - failed}/${tests.tests.length}`);
  if (failed > 0) process.exit(1);
  console.info(`smoke tests passed (${tests.tests.length})`);
}

const args = parseArgs(process.argv.slice(2));
const version = args.release ?? '1.0.0';

switch (args.command) {
  case 'checksums':
    checksums(version);
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
    console.error('unknown command. Use: preflight | checksums | dry-run | apply | smoke-test | rollback-plan');
    process.exit(1);
}
