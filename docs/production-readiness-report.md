# UBM Klar — Production Readiness Report (release 1.0.0)

Date: 2026-07-07. Scope: full platform verification per Batch 57.

> **Status correction (2026-07-09, Pilot Batch 0):** the customer-pilot readiness audit
> (`docs/audits/customer-pilot-readiness-audit.md`) found that the conclusion below
> overstated readiness. Release 1.0.0 verified the domain-logic layer, but the runtime
> wiring was demo-grade: in-memory control plane and audit/data-access sinks, empty
> tenant directory, header-based auth, demo-data dashboards, force-static web pages, and
> a no-op worker. `pnpm db:migrate:preflight` fails on manifest drift. The platform must
> not be used in a customer pilot or production until the P0 blockers in the audit are
> closed. The "Customer pilot hardening" section at the end of this report tracks
> per-batch remediation evidence.

## Verification results

| Check                                                                                      | Command                           | Result             |
| ------------------------------------------------------------------------------------------ | --------------------------------- | ------------------ |
| Full build (36 workspace tasks incl. Next.js)                                              | `pnpm build`                      | PASS               |
| Typecheck (36 tasks, strict TS)                                                            | `pnpm typecheck`                  | PASS               |
| Lint (ESLint 9, typescript-eslint)                                                         | `pnpm lint`                       | PASS               |
| Unit/integration tests (36 packages, 300+ tests)                                           | `pnpm test`                       | PASS               |
| Migration preflight (31 migrations, checksums, no destructive SQL)                         | `pnpm db:migrate:preflight`       | PASS               |
| Migration dry-run (all migrations, transactional rollback)                                 | `pnpm db:migrate:dry-run --db …`  | PASS (Postgres 16) |
| Migration apply + ledger                                                                   | `release-runner apply`            | PASS (31 applied)  |
| Release smoke tests (12)                                                                   | `pnpm db:smoke-test --db …`       | PASS               |
| RLS tests (9: anonymous/no-PII/support blocked, protected identity elevated, write denial) | `pnpm db:rls-test --db …`         | PASS               |
| Secret scan (301 tracked files)                                                            | `pnpm security:secrets`           | PASS               |
| End-to-end demo flows (10 suites)                                                          | `apps/api/src/demo-flows.test.ts` | PASS               |

## Verified flows (Batch 56/57)

- LSS payment control: demo data → 25 rules → flags → matching → control cases
- LSS UBM request/export: blocked (lineage) → fixed → legal/DPO review → maker-checker →
  package (hash + schema/legal/rule versions) → transport gate → receipt → evidence chain
- Economic assistance payment control (25 rules) and EA UBM mapping with exclusions
- UBM notification → confidence match → control case → outcome (recovery claim)
- Recurring UBM 2029: feature-flagged off; awaiting-specification datasets refused;
  full period lifecycle verified behind the flag
- Support without PII (JIT, municipality-approved, ≤ 8 h) and break-glass (≤ 4 h,
  post-review pending) — verified in unit + API + RLS tests
- Public record request with mandatory secrecy review and pre-disclosure redaction
- E-archive package build + checksum verification; exit export (13 scopes, maker-checker,
  tamper detection)
- Payment reconciliation: duplicates, blocklists, decision windows, recipient registry,
  account-change windows, recovery-claim conflicts
- Maker-checker: creator-cannot-approve enforced in code AND by DB trigger
- Production gates: 14 gates seeded; `production_go_live_status.go_live_allowed` blocks
  go-live; onboarding `isGoLiveReady` requires 100% + no blockers

## Acceptance criteria status

All 58 acceptance criteria are implemented. Notable evidence:

1-2 Product named UBM Klar with non-authority disclaimer on every UI surface.
3 Monorepo per prescribed structure. 4 Control plane rejects PII at the API boundary and
in the store layer. 5 Tenant resolver strict/fail-closed with spoofing and leak tests.
6 Model B + C1/C2/C3 supported (deployment docs + provisioning + DB constraint against
shared prod). 7 Provisioning: 20 ordered steps for test/stage/prod. 8-9 Supabase-fallback

- Entra/SAML/OIDC abstractions; RBAC+ABAC. 10 Need-to-know/internal secrecy with
  curiosity detection. 11-12 RLS everywhere sensitive; service keys server-only per tenant.
  13-15 Core model, C/I/A classification, field-level masking. 16-23 LSS, EA, UBM modules
  with 2026 request mode active and 2029 recurring mode feature-flagged; schema/obligation
  registries with `awaiting_official_specification`; legal source versioning.
  24-35 Vault, redaction, import engine, system-of-record, lineage, evidence chain, data
  quality (26 checks), rule engine, payment control, file import, reconciliation, control
  cases, audit + access + reveal logs. 39 Maker-checker with DB enforcement. 40-44 Archive/
  e-archive, public records, no-PII support, break-glass/JIT, anomaly detection.
  45 Release runner (preflight/dry-run/apply/smoke/rollback + checksums + signature
  placeholder + no-PII control-plane status). 46 Synthetic-only demo data (structurally
  invalid personnummer, `is_synthetic` markers). 47-49 Dashboards, UBM flows, exit export.
  50-52 Compliance docs, NIS2 readiness, WCAG/EN 301 549 support + statement template.
  53 Production acceptance gates block launch. 54-55 Billing/entitlements and no-PII
  platform superadmin surface. 56 AI guardrails (suggestion-only enforced by DB CHECK,
  PII-in-prompt structurally gated). 57 Onboarding with 8 readiness scores. 58 Build/
  typecheck/tests pass; required env vars documented in `.env.example` and deployment docs.

## Hardening notes / follow-ups before first live municipality

- Wire the API/web demo data providers to real data-plane queries per deployment
  (deployment task, by design).
- Replace the `UNSIGNED` release-signature placeholder with the vendor release key.
- Excel parsing uses the adapter abstraction; ship the chosen XLSX adapter in the worker
  image during implementation.
- Run a full accessibility audit with assistive technology users before first go-live
  (gate `accessibility_reviewed`).
- Official UBM transport remains intentionally unavailable until specifications and
  credentials exist (`ubm_official_transport_pending` is refused by the send gate).

## Conclusion

Release 1.0.0 is production-safe for pilot municipalities under the documented
deployment models, with go-live gated per tenant by the 14 production readiness gates.

**Superseded 2026-07-09:** see the status correction at the top of this report and
`docs/audits/customer-pilot-readiness-audit.md`. The conclusion above applies to the
domain-logic layer only, not to the runtime as deployed.

---

# Customer pilot hardening — remediation evidence

Per-batch acceptance evidence recorded as the pilot hardening work lands. Commands are
re-run and updated after every batch.

## Pilot Batch 0 — audit and baseline (2026-07-09)

- `docs/audits/customer-pilot-readiness-audit.md` created: 14 P0 blockers, 15 P1 pilot
  requirements, 8 P2 post-pilot items, full inventory of demo/static/in-memory/
  placeholder runtime use, and the pilot go/no-go checklist.
- Baseline command status at audit time: `pnpm db:migrate:preflight` FAILS (manifest
  drift, P0-1). Other checks not re-run in this batch (docs only).
- No code changes.
