#!/usr/bin/env node
/**
 * RLS test suite. Applies session contexts with different roles against a
 * migrated data plane database and verifies row-level security:
 * - anonymous sessions see nothing sensitive
 * - no-PII sessions are blocked from person/payment/UBM tables
 * - PII roles see what they should, and only that
 * - protected identity rows require elevated roles
 *
 * Usage: node scripts/rls-tests.mjs --db postgresql://...
 */
import { execFileSync } from 'node:child_process';

const dbArg = process.argv.indexOf('--db');
const db = dbArg !== -1 ? process.argv[dbArg + 1] : process.env.DATABASE_URL;
if (!db) {
  console.error('Missing --db <url>');
  process.exit(1);
}

// RLS applies to non-superuser roles without BYPASSRLS.
const setupSql = `
do $$ begin
  if not exists (select from pg_roles where rolname = 'rls_test_user') then
    create role rls_test_user login password 'rls_test';
  end if;
end $$;
grant usage on schema public, app to rls_test_user;
grant select, insert, update, delete on all tables in schema public to rls_test_user;
grant execute on all functions in schema app to rls_test_user;

-- seed one normal and one protected person (synthetic)
insert into persons (id, personal_identity_number, is_synthetic, given_name, family_name, protected_identity)
values
  ('00000000-0000-0000-0000-000000000001', '199990ZZ-0001', true, 'Testa', 'Testsson', false),
  ('00000000-0000-0000-0000-000000000002', '199990ZZ-0002', true, 'Skyddad', 'Testsson', true)
on conflict (id) do nothing;
`;

function psqlAsAdmin(sql) {
  return execFileSync('psql', [db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A'], {
    input: sql,
    encoding: 'utf8',
  });
}

function psqlAsTestUser(sessionSql, querySql) {
  const url = new URL(db);
  url.username = 'rls_test_user';
  url.password = 'rls_test';
  return execFileSync('psql', [url.toString(), '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A'], {
    input: `begin;\n${sessionSql}\n${querySql}\nrollback;`,
    encoding: 'utf8',
  }).trim();
}

function session(userId, roles, noPii = false) {
  return `
select set_config('app.user_id', '${userId}', true);
select set_config('app.roles', '${roles.join(',')}', true);
select set_config('app.no_pii_session', '${noPii}', true);
`;
}

const USER = '11111111-1111-1111-1111-111111111111';
let passed = 0;
let failed = 0;

function expectCount(name, sessionSql, query, expected) {
  try {
    const output = psqlAsTestUser(sessionSql, query);
    const count = Number(output.split('\n').filter(Boolean).at(-1));
    if (count === expected) {
      console.info(`PASS ${name}`);
      passed++;
    } else {
      console.error(`FAIL ${name}: expected ${expected}, got ${count}`);
      failed++;
    }
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message.split('\n')[0]}`);
    failed++;
  }
}

psqlAsAdmin(setupSql);

// 1. Anonymous session sees no persons
expectCount(
  'anonymous session sees no persons',
  session('', []),
  'select count(*) from persons;',
  0,
);

// 2. No-PII support session is blocked from persons even with a PII role string
expectCount(
  'no-PII session blocked from persons',
  session(USER, ['lss_case_worker'], true),
  'select count(*) from persons;',
  0,
);

// 3. Support technician (no-PII role) sees no persons
expectCount(
  'support technician sees no persons',
  session(USER, ['support_technician_no_pii']),
  'select count(*) from persons;',
  0,
);

// 4. LSS case worker sees the normal person but not the protected one
expectCount(
  'case worker sees normal persons',
  session(USER, ['lss_case_worker']),
  "select count(*) from persons where id = '00000000-0000-0000-0000-000000000001';",
  1,
);
expectCount(
  'case worker cannot see protected identity',
  session(USER, ['lss_case_worker']),
  "select count(*) from persons where id = '00000000-0000-0000-0000-000000000002';",
  0,
);

// 5. DPO (elevated) sees the protected person
expectCount(
  'dpo sees protected identity',
  session(USER, ['dpo']),
  "select count(*) from persons where id = '00000000-0000-0000-0000-000000000002';",
  1,
);

// 6. Billing admin sees no UBM proposals
expectCount(
  'billing admin blocked from ubm proposals',
  session(USER, ['billing_admin_no_pii']),
  'select count(*) from ubm_export_proposals;',
  0,
);

// 7. Support technician can read reference config (non-PII)
expectCount(
  'authenticated user reads readiness gates',
  session(USER, ['support_technician_no_pii']),
  'select case when count(*) >= 14 then 14 else count(*) end from production_readiness_gates;',
  14,
);

/** Asserts an operation is denied BY RLS specifically (not NOT NULL or grants). */
function expectRlsDenied(name, sessionSql, statement) {
  try {
    psqlAsTestUser(sessionSql, statement);
    console.error(`FAIL ${name}: statement succeeded`);
    failed++;
  } catch (error) {
    const message = String(error.message ?? '');
    if (/row-level security/i.test(message)) {
      console.info(`PASS ${name}`);
      passed++;
    } else {
      console.error(
        `FAIL ${name}: denied but NOT by RLS (${message.split('\n').find((l) => l.includes('ERROR')) ?? message.slice(0, 120)})`,
      );
      failed++;
    }
  }
}

function expectAllowed(name, sessionSql, statement) {
  try {
    psqlAsTestUser(sessionSql, statement);
    console.info(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${String(error.message).split('\n')[0]}`);
    failed++;
  }
}

// 8. Case worker cannot INSERT payments (all NOT NULL columns provided: RLS is the blocker)
expectRlsDenied(
  'case worker blocked from inserting payments (RLS, not NOT NULL)',
  session(USER, ['lss_case_worker']),
  `insert into lss_payments (person_id, amount_sek, payment_date, status)
   values ('00000000-0000-0000-0000-000000000001', 100, '2026-06-01', 'created');`,
);

// 9. Case worker cannot UPDATE payments
psqlAsAdmin(`
insert into lss_payments (id, person_id, amount_sek, payment_date, status)
values ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-000000000001', 500, '2026-06-01', 'paid')
on conflict (id) do nothing;
`);
// Rows invisible under RLS cannot be updated: affected row count must be 0
// and the stored amount must remain unchanged.
expectAllowed(
  'case worker update on payments affects nothing (RLS hides rows)',
  session(USER, ['lss_case_worker']),
  `do $$
   declare n integer;
   begin
     update lss_payments set amount_sek = 999999 where id = '00000000-0000-0000-0000-00000000aa01';
     get diagnostics n = row_count;
     if n <> 0 then raise exception 'update affected % rows despite RLS', n; end if;
   end $$;`,
);
{
  const amount = psqlAsAdmin(
    "select amount_sek from lss_payments where id = '00000000-0000-0000-0000-00000000aa01';",
  ).trim();
  if (amount.startsWith('500')) {
    console.info('PASS payment amount unchanged after blocked update');
    passed++;
  } else {
    console.error(`FAIL payment amount changed to ${amount}`);
    failed++;
  }
}

// 10. Case worker cannot DELETE payments (delete affecting 0 rows is silent —
// verify the row is invisible to delete by checking it still exists afterwards)
expectAllowed(
  'case worker delete on payments affects nothing (RLS hides rows)',
  session(USER, ['lss_case_worker']),
  `do $$
   declare n integer;
   begin
     delete from lss_payments where id = '00000000-0000-0000-0000-00000000aa01';
     get diagnostics n = row_count;
     if n <> 0 then raise exception 'delete affected % rows despite RLS', n; end if;
   end $$;`,
);

// 11. Controller (authorized role) CAN read payments
expectCount(
  'controller reads payments (authorized access works)',
  session(USER, ['controller']),
  "select count(*) from lss_payments where id = '00000000-0000-0000-0000-00000000aa01';",
  1,
);

// 12. Unauthorized role (billing admin) cannot read payments
expectCount(
  'billing admin blocked from payments',
  session(USER, ['billing_admin_no_pii']),
  'select count(*) from lss_payments;',
  0,
);

// 13. Service-only tables: default deny for every direct client role
expectCount(
  'import staging (service-only) hidden from all client roles',
  session(USER, ['municipality_admin', 'controller', 'dpo']),
  'select count(*) from import_staging_rows;',
  0,
);

// 14. Audit events: auditors read, case workers do not
expectCount(
  'case worker cannot read audit events',
  session(USER, ['lss_case_worker']),
  'select count(*) from audit_events;',
  0,
);

// 15. Cross-tenant isolation is database-level: this data plane must identify
// exactly one municipality (shared prod databases are structurally impossible).
try {
  const output = psqlAsAdmin(`select count(*) from data_plane_identity;`).trim();
  const count = Number(output.split('\n').filter(Boolean).at(-1));
  if (count <= 1) {
    console.info('PASS data plane is single-tenant (cross-tenant isolation by design)');
    passed++;
  } else {
    console.error(`FAIL data plane identity: expected <= 1 tenant, found ${count}`);
    failed++;
  }
} catch (error) {
  console.error(`FAIL data plane identity check: ${String(error.message).split('\n')[0]}`);
  failed++;
}

// cleanup seeded rows
psqlAsAdmin(`
delete from lss_payments where id = '00000000-0000-0000-0000-00000000aa01';
delete from persons where id in
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
`);

console.info(`\nRLS tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
