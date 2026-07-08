# Rollback plan — UBM Klar 1.0.0

This is the first release; rollback means restoring the pre-migration state.

## Before applying (mandatory)

1. `pnpm db:migrate:preflight` must pass (manifest + checksums + no destructive SQL).
2. A verified backup must exist (`BACKUP_VERIFIED=true` gate for prod).
3. `pnpm db:migrate:dry-run --db <staging-url>` must pass on a copy of production.

## Rollback procedure

1. Stop application traffic to the affected data plane (single municipality only —
   deployments are per-tenant; other municipalities are unaffected).
2. Restore the pre-migration backup (point-in-time restore to the timestamp recorded in
   `schema_migrations` before the release was applied).
3. Verify restoration with the previous release's smoke tests.
4. Record the rollback in the control plane (`tenant_release_status` = `rolled_back`,
   `migration_runs_no_pii` phase `rollback`) — no PII in any status record.
5. Re-run the production readiness gates before any new go-live.

## Expand-migrate-contract

All 1.0.0 migrations are additive (expand). Contract steps (dropping legacy columns)
are only shipped in later releases after all consumers are migrated, each with its own
rollback note.
