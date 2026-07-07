# Security Baseline

## Non-negotiable rules

- No PII in vendor control plane.
- No service role keys in frontend.
- No PII in logs, telemetry, support bundles, OpenAPI examples or error messages.
- Unknown tenant domains fail closed.
- Sensitive operations go through backend and workers.
- All sensitive tables must use RLS.
- Access control must be enforced backend-side and database-side.
- Support access must be approved, scoped, time-limited and logged.
- Break-glass must be exceptional, justified, time-limited and post-reviewed.

## Sensitive categories

- protected identity
- personal identity number
- children’s data
- health/functional impairment data
- medical documents
- income
- housing/social circumstances
- bank account/payment recipient
- legal/case notes
- recovery claims
- UBM export details

## Required security mechanisms

- RBAC
- ABAC
- need-to-know
- RLS
- data access logs
- audit logs
- sensitive field reveal logs
- maker-checker approvals
- document classification
- information classification C/I/A
- redaction
- anomaly detection
- SIEM export without PII
- secret scanning
- dependency scanning
- production readiness gates
