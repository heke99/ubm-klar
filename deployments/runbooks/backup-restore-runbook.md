# Runbook: backup and restore per municipality

- Backups are **per municipality per environment**; there is no shared backup set.
- Model B: vendor schedules automated backups (database + storage) per project;
  status recorded in `tenant_backup_checks` (no backup content in the control plane).
- Model C: the municipality owns backups; the vendor provides this checklist.

## Restore test (required before go-live and at least yearly)

1. Restore the latest backup to an isolated environment.
2. Run the release smoke tests against the restored database.
3. Verify audit-chain integrity (`verifyChain`) on a sample of audit events.
4. Record duration + result in `tenant_restore_tests` and the production readiness gate
   `restore_tested`.

## Point-in-time restore (incident)

1. Identify the target timestamp (before the incident).
2. Freeze application traffic for the affected tenant only.
3. Restore, run smoke tests, verify RLS, re-open traffic.
4. Document in the incident timeline (no PII) and notify the municipality.
