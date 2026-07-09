# Monitoring and health

## Health and readiness endpoints

| Component     | Endpoint            | Content                                                                                                                                                                                                    |
| ------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API           | `GET /health`       | liveness: `{ service: 'api', status, piiSafe: true }`                                                                                                                                                      |
| API           | `GET /ready`        | dependency checks: control plane, data-plane DB + migrations applied, auth config, fail-closed resolver, release signature key, scanner + storage providers, job queue. 503 when any required check fails. |
| Control plane | `GET /health`       | liveness                                                                                                                                                                                                   |
| Control plane | `GET /ready`        | store round-trip (Postgres for persistent deployments)                                                                                                                                                     |
| Worker        | `GET /health`       | registered vs expected job families, queue provider, queue depth, running, failed, dead-letter count, succeeded last hour, last success/error                                                              |
| Worker        | `GET /ready`        | queue + data-plane connectivity                                                                                                                                                                            |
| Web           | `GET /health`       | liveness (exempt from tenant resolution)                                                                                                                                                                   |
| Data plane    | release smoke tests | table existence, RLS enabled on every sensitive table, policies present, no PUBLIC/anon grants, seeds present                                                                                              |

All health payloads are no-PII by construction and safe to forward to vendor telemetry.

## What is monitored

- `/ready` per service (alert when 503) and process restarts
- queue depth, retrying and dead-letter counts (`GET /worker/health`, `GET /admin/jobs`)
- import batch failures and validation-report error rates
- audit chain verification (`GET /audit/verify-chain` — alert immediately on `valid: false`)
- API 5xx rate and correlation-id error logs (technical logs are no-PII sanitized)
- rate-limit rejections (429 counts) per route class
- latest applied migration vs release target (`tenant_release_status`)
- backup freshness (`tenant_backup_checks`) and restore test age (`tenant_restore_tests`)
- SSO login failures (count only), certificate/metadata expiry
- anomaly events (privacy/security) — counts by severity

## Alert routing

Technical alerts go to the operations channel; privacy anomalies route to the
municipality's DPO dashboard, never to vendor support. Alert payloads pass the no-PII
guard before leaving the data plane.

## Rollback notes

- Application: redeploy previous image; sessions are stateless (encrypted cookies).
- Database: migrations are expand-only (no destructive statements — enforced by the
  release preflight); rollback = PITR restore per `releases/1.0.0/rollback-plan.md`.
- Tenant kill switch: unverify the domain or set tenant status `suspended` in the
  control plane — the resolver fails closed (421) immediately after cache TTL.
