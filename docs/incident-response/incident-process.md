# Incident response process

## Severity matrix

| Severity | Definition | Response |
| --- | --- | --- |
| Critical | Data breach, cross-tenant exposure, production down | Immediate; municipality notified < 1h |
| High | Sensitive-data risk, payment control unavailable | < 4h |
| Medium | Degraded function, failed imports | < 1 business day |
| Low | Cosmetic/minor | Planned |

## Process

1. **Detect** — monitoring alert, anomaly event, SIEM finding or report.
2. **Register** — `security_incidents` with a **no-PII** description; the timeline
   (`security_incident_timeline`) is append-only.
3. **Contain** — isolate the affected tenant's data plane (isolation means other
   municipalities are unaffected by design).
4. **Assess personal-data impact** — if personal data is affected, the municipality (data
   controller) is notified immediately and handles IMY notification (72h); the vendor
   provides technical evidence.
5. **NIS2 reporting** — early warning within 24h and incident notification within 72h to
   the supervisory authority where applicable.
6. **Eradicate & recover** — fix, restore from backup if needed (see backup runbook),
   verify with smoke tests + RLS tests.
7. **Post-mortem** — timeline entry `post_mortem`, actions into the cyber risk register,
   break-glass sessions post-reviewed.

Communication templates (municipality + authority) contain no citizen PII.
