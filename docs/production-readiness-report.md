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

## Pilot Batch 1 — release, CI, quality gates (2026-07-09)

Closes P0-1 (manifest drift), P0-2 (unsigned release), P0-13 (weak CI), P0-14 (secret
scanner), and adds interim fail-closed startup guards toward P0-3/P0-4/P0-10.

Acceptance evidence (all run locally on Node 22.14 / pnpm 9.12.3 / Postgres 16.14):

| Check                         | Command                               | Result                                        |
| ----------------------------- | ------------------------------------- | --------------------------------------------- |
| Strict install                | `pnpm install --frozen-lockfile=true` | PASS                                          |
| Format                        | `pnpm format:check`                   | PASS                                          |
| Typecheck                     | `pnpm typecheck` (36 tasks)           | PASS                                          |
| Lint                          | `pnpm lint`                           | PASS                                          |
| Tests (vitest 3)              | `pnpm test` (36 tasks)                | PASS                                          |
| Secret scan                   | `pnpm security:secrets` (308 files)   | PASS                                          |
| Dependency audit (blocking)   | `pnpm security:deps`                  | PASS (0 high/critical; 1 moderate documented) |
| Migration preflight           | `pnpm db:migrate:preflight`           | PASS (31 migrations)                          |
| Migration dry-run             | `db:migrate:dry-run --db …`           | PASS                                          |
| Migration apply + smoke + RLS | apply, 12 smoke tests, 9 RLS tests    | PASS                                          |
| Production safety             | `pnpm production:safety-check`        | PASS (7/7)                                    |
| Unsigned release in prod      | `ENVIRONMENT=prod verify-signature`   | REFUSED (fail closed, as required)            |
| Signed release in prod        | ed25519 key pair round-trip           | PASS; wrong key REFUSED                       |

Notes:

- The remaining moderate advisory is in the dev-only test toolchain (esbuild via
  vite dev server), not shipped to production runtimes.
- The repository release `1.0.0` remains UNSIGNED on disk, which is valid for
  local/demo/test only; stage/prod pipelines must sign with the vendor release key.

## Pilot Batch 2 — environment validation (2026-07-09)

Closes P0-12 (missing env validation). Progresses P0-3/4/5/10/11 by making the unsafe
providers unreachable in stage/prod at startup.

- `loadAppConfig(app)` in `@ubm-klar/config`: 5 modes, per-app requirement matrix,
  forbidden-provider list, `UnsafeProductionConfigError` aborts startup.
- All four apps validate configuration before serving; web validates via
  `instrumentation.ts` at server start.
- Evidence: 24 new config tests PASS; `pnpm production:safety-check` now 13/13 PASS
  including: prod refuses demo data, demo tenant, disabled-local scanner, header auth
  without trusted proxy, no-op worker, missing queue, official UBM transport flag.
- Local development remains zero-config (verified by `loadAppConfig('api', {})`).

## Pilot Batch 3 — control plane persistence (2026-07-09)

Closes P0-3 (in-memory control plane, no auth on control-plane routes).

- `PostgresControlPlaneStore` + `@ubm-klar/db`; migrations 0001/0002 applied and
  queried at runtime; provisioning runs persisted.
- Evidence: 29 control-plane tests PASS (7 against live Postgres 16); manual runtime
  check — tenant created over HTTP survived a process restart; requests without the
  admin bearer token get 401; PII payloads still rejected 422 at the API boundary and
  with `PiiLeakError` at the store layer; secret-looking key references rejected 400.
- Production cannot use `InMemoryControlPlaneStore` (config validation + defense in
  depth in `main.ts`, probed by `production:safety-check`).

## Pilot Batch 4 — tenant resolution (2026-07-09)

Closes P0-4 (empty tenant directory).

- `ControlPlaneTenantDirectory` wired into the API; scope-limited directory token.
- Evidence: 21 tenant-resolver tests PASS (incl. 8 new directory tests). Live check
  with control plane (Postgres) + API: verified domain resolved to safe config with
  publishable key from env; unknown domain 421; forbidden authority-style domain 421;
  unverified domain invisible (404 -> 421); demo tenant localhost-only. Failures are
  never cached; positive lookups cached once per TTL (asserted by request counting).
- No secret material can reach the frontend: `assertNoSecretMaterial` re-checks every
  resolved config; a service-role-looking key aborts resolution.

## Pilot Batch 5 — auth, SSO, RBAC (2026-07-09)

Closes P0-5 (header auth) and P0-6 (no web login/session).

- `@ubm-klar/auth`: verified OIDC/Entra tokens (JWKS/issuer/audience/expiry), subject
  builder with group->role mapping, HMAC-signed trusted-proxy header auth, encrypted
  web sessions, SAML abstraction that refuses (post-pilot).
- Evidence: 19 auth tests + 11 API integration tests PASS on a production-like server:
  spoofed `x-user-id`/`x-roles` headers -> 401; unauthenticated -> 401; valid Entra
  token with right role -> 200; wrong role -> 403 (+ audit event); expired/wrong-key/
  wrong-issuer tokens -> 401; tampered session cookie -> 401; forged proxy signature
  -> 401. Web refused to start in prod without auth config; demo login only exists
  outside stage/prod (404 otherwise).

## Pilot Batch 6 — repositories and real API data (2026-07-09)

Closes P0-8 (demo data served as business data) and P0-9 (no database repositories).

- 13 repositories against the release 1.0.0 data-plane schema; per-tenant Postgres
  pools; correlation ids on every request; no-PII technical logs.
- Evidence: 11 repository tests PASS against live Postgres 16 (full audited control
  case lifecycle, UBM request/subject persistence, import idempotency, readiness
  gates blocking go-live, audit + data access event round-trips). Server tests prove:
  a production tenant without data shows `dataSource: 'empty'` (no fake stats), and
  demo data requires demo tenant + environment flag + tenant feature flag — the demo
  generators are not even constructed on stage/prod servers.
- CI database job now also runs the repository test suites against Postgres 16.

## Pilot Batch 7 — real web UI (2026-07-09)

Closes the web half of P0-8 (force-static demo pages) and P0-6 remainder (role-based
navigation).

- `demo-data.ts` deleted; zero `force-static` pages; all pages fetch real API data
  server-side with loading/empty/error/forbidden states; pilot banner + environment
  badge + tenant banner in the shell; role-based navigation from the verified session.
- Evidence (manual run against live API+web): demo tenant renders demo dashboard with
  an explicit synthetic-data warning; production-tenant empty database renders
  "inga uppgifter" (no fake stats); unauthorized role gets "Behörighet saknas" from a
  backend 403; anonymous users are redirected to /login; `next build` and full test
  suite green.
