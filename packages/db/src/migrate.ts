import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DbClient } from './client';

/**
 * Minimal idempotent migration applier for service-owned schemas (control plane,
 * job queue). The municipal data plane uses the signed release runner instead —
 * this applier is for vendor-internal schemas without release packaging.
 */
export async function applyMigrationsFromDir(
  db: DbClient,
  dir: string,
  ledgerTable = 'schema_migrations',
): Promise<string[]> {
  if (!/^[a-z_][a-z0-9_]*$/.test(ledgerTable)) {
    throw new Error(`Invalid ledger table name: ${ledgerTable}`);
  }
  await db.query(
    `create table if not exists ${ledgerTable} (
       name text primary key,
       sha256 text not null,
       applied_at timestamptz not null default now())`,
  );
  const appliedResult = await db.query<{ name: string }>(`select name from ${ledgerTable}`);
  const applied = new Set(appliedResult.rows.map((r) => r.name));

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(dir, name), 'utf8');
    const sha256 = createHash('sha256').update(sql).digest('hex');
    await db.withTransaction(async (tx) => {
      await tx.query(sql);
      await tx.query(`insert into ${ledgerTable} (name, sha256) values ($1, $2)`, [name, sha256]);
    });
    newlyApplied.push(name);
  }
  return newlyApplied;
}
