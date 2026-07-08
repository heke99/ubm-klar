# Monitoring and health

## Health endpoints

| Component | Endpoint / probe | Content |
| --- | --- | --- |
| API | `GET /health` | `{ service: 'api', status, piiSafe: true }` |
| Control plane | `GET /health` | `{ service: 'control-plane', status, piiSafe: true }` |
| Worker | `workerHealth()` snapshot | registered vs expected job families, queue depth |
| Data plane | release smoke tests | table existence, RLS enabled, seeds present |

All health payloads are no-PII by construction and safe to forward to vendor telemetry.

## What is monitored

- queue depth and job failure rates per job family (worker)
- import batch failures and validation-report error rates
- integration/connection status per source system
- latest applied migration vs release target (`tenant_release_status`)
- backup freshness (`tenant_backup_checks`) and restore test age (`tenant_restore_tests`)
- SSO login failures (count only), certificate/metadata expiry
- SIEM export delivery status
- anomaly events (privacy/security) — counts by severity

## Alert routing

Technical alerts go to the operations channel; privacy anomalies route to the
municipality's DPO dashboard, never to vendor support. Alert payloads pass the no-PII
guard before leaving the data plane.
