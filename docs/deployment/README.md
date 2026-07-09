# Deployment

Deployment documentation for UBM Klar. Every municipality runs on an **isolated
data plane** (Model B: vendor-hosted isolated Supabase/Postgres per municipality;
Model C: municipality-owned). The vendor control plane never stores personal data.

## Documents

| Document                                                                                     | Purpose                                                                                 |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [customer-pilot.md](customer-pilot.md)                                                       | Zero-to-pilot deployment guide: services, environment variables, releases, tenant setup |
| [monitoring.md](monitoring.md)                                                               | Health/readiness endpoints, monitored signals, alert routing                            |
| [municipality-owned-data-plane-manual.md](municipality-owned-data-plane-manual.md)           | Model C (C1/C2/C3) setup where the municipality owns database, storage and keys         |
| [../runbooks/customer-pilot-go-live.md](../runbooks/customer-pilot-go-live.md)               | Step-by-step pilot go-live runbook with rollback                                        |
| [../runbooks/backup-restore-runbook.md](../runbooks/backup-restore-runbook.md)               | Backup/restore procedure and restore-test evidence for the readiness gate               |
| [../runbooks/incident-and-rollback-runbook.md](../runbooks/incident-and-rollback-runbook.md) | Operational incident handling and release rollback                                      |

## Runtime services

Four services are deployed per environment (see `docs/architecture/overview.md`):

- `apps/control-plane` — no-PII tenant registry (own Postgres, admin/directory token auth)
- `apps/api` — all business logic; resolves tenants via the control plane directory and
  connects to each municipality's data plane
- `apps/worker` — persistent Postgres-backed job queue and rule runs
- `apps/web` — Next.js UI with OIDC login and encrypted sessions

## Fail-closed guarantees

In `stage`/`prod` mode, every service validates configuration at startup via
`loadAppConfig` and **refuses to boot** with: demo data providers, in-memory
stores/queues/sinks, disabled malware scanning, header auth without a trusted
proxy secret, unsigned releases, missing backup configuration, or the official
UBM transport flag. `pnpm production:safety-check` probes these refusals in CI.
