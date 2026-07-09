# UBM Klar 1.0.0

First production release.

## Included

- Data plane schema (31 migrations): core municipal model, auth/access control, audit and
  data access logs, document vault, LSS domain + payment control, economic assistance
  domain, UBM schema registry, UBM request/export/notification, RLS policies, seeds
  (roles + rules), support/break-glass, retention/exit export, internal secrecy,
  archive/e-archive, public records, information classification, maker-checker,
  payment files/reconciliation, system-of-record/lineage, anomaly detection,
  cybersecurity readiness, production readiness gates, onboarding, billing/entitlements,
  legal sources/UBM obligations, AI guardrails, tenant provisioning references,
  recurring UBM reporting 2029 (feature-flagged off).
- Control plane schema (2 migrations, no PII).
- Domain engines with full test suites.

## Positioning

UBM Klar är en fristående produkt och är inte en tjänst från Utbetalningsmyndigheten
eller någon annan myndighet.

## Constraints honored

- No final official UBM schema is hardcoded; Phase 2 (2029) datasets remain
  `awaiting_official_specification` and feature-flagged.
- No destructive migration statements (verified by the release runner preflight).
