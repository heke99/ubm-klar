# Runbook: applying a release to a municipality data plane

Applies to Model B (vendor-operated) and Model C (municipality-operated, vendor-guided).
Migrations run **per municipality per environment** — never in bulk across tenants.

1. **Preflight** — `node scripts/release-runner.mjs preflight --release <v>`
   (manifest + checksums verified, migration order checked, destructive SQL rejected).
2. **Backup check** — confirm a fresh verified backup exists. Prod refuses to apply
   without `BACKUP_VERIFIED=true`.
3. **Dry-run** — `node scripts/release-runner.mjs dry-run --release <v> --db <stage-url>`
   on a copy of production data.
4. **Apply to test → stage → prod** in order, each followed by:
   `node scripts/release-runner.mjs smoke-test --release <v> --db <url>`.
5. **RLS tests** — run the RLS test suite; record the result in
   `tenant_rls_test_runs` (control plane, no PII).
6. **Status update** — the runner reports phase/status (no PII) to the control plane
   (`migration_runs_no_pii`, `tenant_release_status`).
7. **On failure** — stop, execute `releases/<v>/rollback-plan.md`, set
   `tenant_release_status = rolled_back`, open a no-PII support case.
