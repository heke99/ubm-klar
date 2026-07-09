# Customer Pilot Readiness Audit — UBM Klar

Date: 2026-07-09
Scope: full repository audit before the customer pilot hardening work (Batch 0).
Auditor: engineering (automated full-repo review, no code changes in this batch).

## Purpose

Identify every production blocker before a controlled customer pilot. The rule applied
throughout: demo data, static pages, in-memory stores, unsigned releases, header auth,
fake workers, placeholder scanners, and no-op queues are acceptable only in
local/demo/test. They must never run in stage/prod or in a customer pilot unless
explicitly marked as synthetic demo mode.

## Current status (baseline)

The repository contains a strong, well-tested pure domain layer (32 packages: rule
engines, eligibility, export packaging, approval workflows, audit chaining, access
control, import parsing, reconciliation, archive/exit export, billing). All runtime
wiring, however, is demo scaffolding:

- No Postgres/Supabase driver code exists anywhere in the monorepo.
- No OIDC/SAML/JWKS verification code exists.
- No queue implementation exists.
- The web app renders static demo pages and never calls the API.
- The API serves generated demo data and trusts spoofable headers for identity.
- The control plane and audit/data access logs are in-memory only.
- The worker prints a health line and exits; most job handlers are passthrough-success.

Conclusion: the platform is NOT ready for a customer pilot in its current state. The
gaps are enumerated below with priorities.

## P0 blockers (must fix before any customer pilot)

| #     | Blocker                                                                                                                                                                                                                                                                                                                                                                     | Files affected                                                                                                                                                      | Required tests                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| P0-1  | Release preflight fails: `supabase/migrations/202607070002_control_plane_no_pii.sql` exists on disk but is missing from `releases/1.0.0/migration-manifest.json` (also duplicates timestamp `202607070002` with `..._auth_and_access_control.sql`, making ordering non-deterministic). It is an orphan copy of control-plane schema that does not belong in the data plane. | `supabase/migrations/202607070002_control_plane_no_pii.sql`, `releases/1.0.0/migration-manifest.json`, `releases/1.0.0/checksums.txt`, `scripts/release-runner.mjs` | `pnpm db:migrate:preflight` passes; preflight rejects duplicate timestamps                                                           |
| P0-2  | Unsigned release passes as production: `releases/1.0.0/signature.sig` is the plaintext `UNSIGNED release ...` placeholder and `release-runner.mjs` never verifies signatures.                                                                                                                                                                                               | `scripts/release-runner.mjs`, `releases/1.0.0/signature.sig`                                                                                                        | stage/prod apply fails closed on unsigned release; local/demo/test accepts unsigned                                                  |
| P0-3  | In-memory control plane: `apps/control-plane/src/main.ts` always uses `InMemoryControlPlaneStore`; migrations in `apps/control-plane/migrations/` are never applied or queried. All tenants/domains/gates are lost on restart. No auth on any control-plane route.                                                                                                          | `apps/control-plane/src/main.ts`, `apps/control-plane/src/store.ts`, `apps/control-plane/src/server.ts`, `apps/control-plane/src/provisioning.ts`                   | Postgres store round-trip tests; prod startup without persistent store fails; admin auth tests                                       |
| P0-4  | Empty tenant directory: `apps/api/src/main.ts` wires `emptyDirectory` (`lookupByDomain: async () => undefined`); only the localhost demo tenant works. There is no `ControlPlaneTenantDirectory`.                                                                                                                                                                           | `apps/api/src/main.ts`, `apps/api/src/server.ts`, `packages/tenant-resolver/src/*`                                                                                  | unknown/forbidden/unverified domain -> 421; verified domain -> safe config; prod refuses emptyDirectory and allowDemoTenant          |
| P0-5  | Header-based auth: `apps/api/src/server.ts` `parseSubject()` builds the user from `x-user-id`, `x-roles`, `x-departments`, `x-assigned-cases`, `x-session-kind` headers with no verification. Spoofable by any caller.                                                                                                                                                      | `apps/api/src/server.ts`                                                                                                                                            | spoofed headers rejected in stage/prod; OIDC token verification (issuer/audience/expiry/signature) tests; trusted proxy secret tests |
| P0-6  | No login/session in web: no `/login`, `/logout`, `/auth/callback`, `/unauthorized`; navigation uses hardcoded `DEMO_ROLES` in `apps/web/components/navigation.ts` used by `apps/web/app/layout.tsx`.                                                                                                                                                                        | `apps/web/app/*`, `apps/web/components/navigation.ts`, `apps/web/middleware.ts`                                                                                     | unauthenticated redirect; role-based navigation; session expiry                                                                      |
| P0-7  | In-memory audit and data access logs: `apps/api/src/server.ts` uses `InMemoryAuditSink` and `InMemoryDataAccessSink`. Nothing sensitive is persistently logged.                                                                                                                                                                                                             | `apps/api/src/server.ts`, `packages/audit/src/audit-log.ts`, `packages/data-access-log/src/data-access-log.ts`                                                      | persistent sink round-trip; prod refuses in-memory sinks; chain verification                                                         |
| P0-8  | Demo data served as business data: API dashboards call `generateLssDemoData`/`generateEaDemoData` at module load (`apps/api/src/server.ts`), and every web page imports `apps/web/components/demo-data.ts` and/or inline static arrays with `export const dynamic = 'force-static'`.                                                                                        | `apps/api/src/server.ts`, `apps/web/components/demo-data.ts`, all 18 files under `apps/web/app/**/page.tsx`                                                         | stage/prod never calls demo generators; empty tenant shows empty states; demo requires env+tenant flag+feature flag                  |
| P0-9  | No database repositories: no repository layer exists for LSS, EA, UBM requests, export proposals, imports, documents, audit, data access, readiness, control cases, payment control, notifications. `@ubm-klar/supabase-client` only builds descriptors, never connects.                                                                                                    | new `packages/db`, new `apps/api/src/repositories/*`                                                                                                                | repository CRUD tests against local Postgres                                                                                         |
| P0-10 | No-op worker: `apps/worker/src/main.ts` prints health JSON and exits; 13 of 20 job types are registered as passthrough that return `succeeded` without doing anything; the rest run on empty inputs. No queue, no persistence, no retries, no dead-letter.                                                                                                                  | `apps/worker/src/main.ts`, `apps/worker/src/handlers.ts`, `apps/worker/src/jobs.ts`                                                                                 | job execution/retry/dead-letter tests; prod refuses passthrough handlers; unimplemented -> failed NOT_IMPLEMENTED                    |
| P0-11 | Disabled-local malware scanner is the only implementation: `DisabledMalwareScanner` in `packages/document-vault/src/vault.ts` returns `skipped_policy`; `.env.example` defaults `MALWARE_SCANNER_PROVIDER=disabled-local`. No storage adapter exists (no Supabase Storage/S3 code).                                                                                         | `packages/document-vault/src/vault.ts`, `.env.example`                                                                                                              | prod startup with `disabled-local` scanner fails; upload requires scan verdict in stage/prod                                         |
| P0-12 | No environment validation: `packages/config/src/env.ts` is a generic `readEnv` helper. There are no environment modes, no required-config matrix, and nothing prevents unsafe providers in stage/prod.                                                                                                                                                                      | `packages/config/src/env.ts`, all four `apps/*/src/main.ts`                                                                                                         | invalid env fails startup in stage/prod; local stays easy; unsafe provider combinations rejected                                     |
| P0-13 | Weak CI: `.github/workflows/ci.yml` installs with `--frozen-lockfile=false`, does not run `format:check`, `security:deps`, `db:migrate:preflight`, or any production-safety check. `security:deps` script is `pnpm audit --audit-level high \|\| true` (always passes).                                                                                                     | `.github/workflows/ci.yml`, `package.json`                                                                                                                          | CI runs strict lockfile + full gate set; blocking dep audit                                                                          |
| P0-14 | Secret scanner depends on git only: `scripts/scan-secrets.mjs` uses `git ls-files` exclusively, so it silently scans nothing when git is unavailable; no filesystem fallback.                                                                                                                                                                                               | `scripts/scan-secrets.mjs`                                                                                                                                          | scanner works without git; detects planted secret; ignores safe examples                                                             |

## P1 pilot requirements (needed for a usable, safe pilot)

| #     | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Files affected                                                                                   | Required tests                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| P1-1  | Import MVP: upload -> detect -> map -> preview -> validate -> save batch -> approve -> commit, with data quality checks, rule runs, control case creation, lineage and audit. XLSX adapter is currently an abstraction with no implementation (`packages/import-engine/src/parsers.ts` `ExcelAdapter`). Source-system adapters (Procapita/Lifecare, Treserva, Combine, Pulsen, CGI, TietoEVRY) must exist as a registry with unimplemented ones marked unavailable. | `packages/import-engine/*`, new API import routes, `apps/web/app/importer/*`                     | e2e import flow; idempotency; rollback before commit; synthetic personnummer blocked outside demo             |
| P1-2  | UBM request workflow MVP: manual registration through packaging, receipt and closure with the 16-status machine. Engine exists (`packages/ubm-obligation-engine`) but nothing persists requests and there is no UI beyond a static list.                                                                                                                                                                                                                            | new API routes, `apps/web/app/ubm-forfragningar/*`, `UbmRequestRepository`                       | full manual workflow e2e; blocked exports explain why; audit coverage                                         |
| P1-3  | Export proposals and packaging: proposal record with matched subjects, in/excluded fields, legal basis, secrecy assessment, redaction plan, lineage, risk warnings, approver history, hashes. Packaging (zip + manifest.json + checksums + summary) does not exist; `UnsignedPackageSigner` is a placeholder.                                                                                                                                                       | `packages/ubm-export-engine/*`, new packaging module, API routes, `apps/web/app/exportforslag/*` | package hash/manifest verification; blocked proposal cannot package; download creates audit + data access log |
| P1-4  | Document vault persistence: storage adapters (local for dev/test, Supabase Storage, S3-compatible), upload UI, classification, reveal-with-reason, redaction workflow with separately stored redacted copies.                                                                                                                                                                                                                                                       | `packages/document-vault/*`, new storage adapters, API routes, `apps/web/app/dokument/*`         | persistence round-trip; sensitive open requires reason; redacted copy separate; access logged                 |
| P1-5  | Onboarding and go-live gates: control plane has readiness gate storage but no 26-step checklist, no waiver model (reason/approver/expiry/risk), no pilot-vs-production approval separation, no UI.                                                                                                                                                                                                                                                                  | `apps/control-plane/src/*`, `apps/web/app/onboarding/*`                                          | required gate cannot be bypassed; waiver requires fields; pilot approval separate                             |
| P1-6  | Payment control on real data: 25 LSS + 25 EA rules exist and are tested, but run only against demo data. Control cases are never persisted.                                                                                                                                                                                                                                                                                                                         | API routes, repositories, `apps/web/app/kontrollarenden/*`, `apps/web/app/betalningskontroll/*`  | imported data generates flags; high/critical flags become cases; case actions audited                         |
| P1-7  | UBM notification manual intake: engine matching exists (`matchNotification`), but no intake flow, persistence, or outcome recording.                                                                                                                                                                                                                                                                                                                                | API routes, `apps/web/app/underrattelser/*`                                                      | manual registration -> matching -> outcome; no fake official transmission                                     |
| P1-8  | Reports over real data with CSV/XLSX/JSON export. Current `/rapporter` is a static list.                                                                                                                                                                                                                                                                                                                                                                            | API report routes, `apps/web/app/rapporter/*`                                                    | reports use real data; permission-scoped; export works                                                        |
| P1-9  | Admin/support/superadmin: municipality admin pages, vendor superadmin without PII, JIT support sessions and break-glass surfaced in UI. Backend session creation exists in `packages/access-control`.                                                                                                                                                                                                                                                               | `apps/web/app/installningar/*`, control plane UI/API                                             | superadmin cannot see PII; support scope enforced and audited                                                 |
| P1-10 | Security hardening: no security headers, no rate limiting, no CSRF protection, no request/upload size limits, stack traces unfiltered.                                                                                                                                                                                                                                                                                                                              | `apps/web/next.config.mjs`, `apps/api/src/server.ts`, middleware                                 | headers present; rate limits on login/upload/export/reveal; safe errors with correlation id                   |
| P1-11 | Health/readiness endpoints: only trivial `/health` exists on api/control-plane; no `/ready` with dependency checks; worker and web have none.                                                                                                                                                                                                                                                                                                                       | all `apps/*/src/main.ts`                                                                         | `/ready` fails when dependencies missing                                                                      |
| P1-12 | Explicit customer pilot mode: no pilot flag, no pilot banner, no pilot gate checklist, nothing blocks production claims or official transport at the tenant level.                                                                                                                                                                                                                                                                                                  | control plane, web shell, API                                                                    | pilot gates enforced; pilot banner visible; official transport blocked                                        |
| P1-13 | RLS test hardening: `scripts/rls-tests.mjs` covers 8 select-focused scenarios; no insert/update/delete coverage, no cross-tenant checks, and many tables have RLS enabled with zero policies (migrations 014-023, 029, 030) which must be documented as service-only or given policies.                                                                                                                                                                             | `scripts/rls-tests.mjs`, `supabase/migrations/*`, new smoke test                                 | select/insert/update/delete; cross-tenant denial; failure reasons are RLS not NOT NULL                        |
| P1-14 | E2E integration tests: none exist that boot the apps against a real database.                                                                                                                                                                                                                                                                                                                                                                                       | new `tests/e2e` or per-app integration suites, CI                                                | 9 critical flows covered in CI                                                                                |
| P1-15 | Pilot documentation: missing `docs/deployment/customer-pilot.md`, `docs/runbooks/*`, `docs/user-manuals/*` (stub README only).                                                                                                                                                                                                                                                                                                                                      | `docs/**`                                                                                        | docs match code; no overstated claims                                                                         |

## P2 post-pilot requirements

| #    | Requirement                                               | Notes                                                                                                                                  |
| ---- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 | Official UBM transport                                    | Must remain disabled until official spec, credentials, and transport security approval exist. Keep feature-flagged and unconfigurable. |
| P2-2 | Recurring 2029 reporting                                  | Already disabled by default (`ubm_recurring_reporting_2029`); keep blocked in pilot mode.                                              |
| P2-3 | SAML IdP support                                          | Provide abstraction; full SAML flow post-pilot. Entra ID/OIDC covers pilot.                                                            |
| P2-4 | Automated intake channels (`api_webhook`, `email_intake`) | Marked placeholder in `packages/ubm-obligation-engine/src/request-manager.ts`; manual registration and file upload suffice for pilot.  |
| P2-5 | SIEM export, full NIS2 automation                         | Docs exist; automated export post-pilot.                                                                                               |
| P2-6 | Full accessibility (AT user) audit                        | Statement template exists; formal audit is a production go-live gate.                                                                  |
| P2-7 | Penetration test                                          | Required before full production, not for controlled pilot with synthetic/limited data.                                                 |
| P2-8 | Billing automation                                        | `billing-engine` logic exists; invoicing automation post-pilot.                                                                        |

## Complete inventory of demo/static/in-memory/placeholder runtime use

### In-memory stores in runtime paths

- `apps/control-plane/src/main.ts` — `InMemoryControlPlaneStore` (all tenant metadata).
- `apps/control-plane/src/provisioning.ts` — `ProvisioningService` keeps runs in a `Map`.
- `apps/api/src/server.ts` — `InMemoryAuditSink`, `InMemoryDataAccessSink`.
- `apps/api/src/main.ts` — `emptyDirectory` tenant directory (always resolves undefined).
- `packages/tenant-resolver/src/cache.ts` — `TtlCache` (acceptable: positive-lookup cache only).
- `packages/evidence-chain/src/evidence-chain.ts` — `EvidenceChain` in-memory array, no sink.

### Demo data in runtime paths

- `apps/api/src/server.ts` — module-level `generateLssDemoData(...)` / `generateEaDemoData(...)` feeding `/dashboards/lss` and `/dashboards/economic-assistance`.
- `apps/web/components/demo-data.ts` — synthetic dashboards used by most pages.
- `apps/web/components/navigation.ts` — hardcoded `DEMO_ROLES`.
- Inline static business data in `apps/web/app/underrattelser/page.tsx`, `apps/web/app/importer/page.tsx`, `apps/web/app/dokument/page.tsx`, `apps/web/app/arkiv/page.tsx`.
- `apps/api/src/server.ts` — hardcoded `/support/technical-status` snapshot (fake queue depth, fake migration name).

### force-static pages showing business data (all 18 pages)

`apps/web/app/page.tsx`, `ubm-beredskap`, `ubm-forfragningar`, `exportforslag`,
`underrattelser`, `kontrollarenden`, `lss`, `ekonomiskt-bistand`, `betalningskontroll`,
`importer`, `dokument`, `rapporter`, `revision`, `juridik`, `sakerhet`, `arkiv`,
`installningar`, `tillganglighet` — every one exports `dynamic = 'force-static'`.
(`sakerhet`, `tillganglighet`, `revision` are informational; the rest show what should be
tenant data.)

### Header-based auth

- `apps/api/src/server.ts` `parseSubject()` — trusts `x-user-id`, `x-roles`, `x-departments`, `x-assigned-cases`, `x-session-kind`, `x-session-expires-at` with no proxy verification.

### Fake/no-op workers and queues

- `apps/worker/src/main.ts` — prints health, exits; no queue consumer.
- `apps/worker/src/handlers.ts` — `passthrough()` returns `succeeded` for 13 job types; `reconciliation-jobs`, `document-redaction-jobs`, `anomaly-detection-jobs` run on empty inputs; `rule-engine-jobs` only counts rules.
- No queue provider anywhere; `WORKER_QUEUE_URL` env var unused.

### Placeholder integrations

- `packages/document-vault/src/vault.ts` — `DisabledMalwareScanner` (returns `skipped_policy`).
- `packages/ubm-export-engine/src/export-package.ts` — `UnsignedPackageSigner`; transport profile `ubm_official_transport_pending` (properly blocked).
- `packages/ubm-obligation-engine/src/request-manager.ts` — intake channels `api_webhook`, `email_intake`, `official_transport` documented as placeholders (properly disabled; only `manual_registration`, `file_upload` enabled).
- `packages/import-engine/src/parsers.ts` — `ExcelAdapter` abstraction with no implementation.
- `packages/supabase-client/src/client-factory.ts` — descriptor factory only; no client is ever created.
- `.env.example` — `MALWARE_SCANNER_PROVIDER=disabled-local` default; `DOCUMENT_STORAGE_PROVIDER=supabase` with no implementation behind it.

### Release/CI weaknesses

- `releases/1.0.0/signature.sig` — plaintext `UNSIGNED ...`; never verified by `scripts/release-runner.mjs`.
- `releases/1.0.0/migration-manifest.json` — missing `202607070002_control_plane_no_pii.sql` (preflight fails today).
- `releases/1.0.0/release-notes.md` — says 30 data-plane migrations, manifest has 31.
- `.github/workflows/ci.yml` — `--frozen-lockfile=false`; missing format check, dep audit, migration preflight, safety check.
- `package.json` — `security:deps` swallows failures with `|| true`.
- `scripts/scan-secrets.mjs` — git-tracked-files only, no filesystem fallback.

### Missing implementations (nothing to replace, must be created)

- Postgres/Supabase data access layer (repositories) — absent.
- OIDC/Entra/SAML verification — absent (types only).
- Web login/session — absent.
- Queue implementation — absent.
- Storage adapters — absent.
- Persistent audit/data-access sinks — absent.
- `ControlPlaneTenantDirectory` — absent.
- Environment mode validation — absent.
- Backup/restore verification workflow — docs only (`deployments/runbooks/backup-restore-runbook.md`).
- Monitoring integration — docs only (`docs/deployment/monitoring.md`).
- Pilot limitation screens, privacy/security/legal pages in UI — absent (only static `sakerhet`/`tillganglighet` copy).

## Go/no-go checklist for customer pilot

A customer pilot is GO only when all of the following are verified:

- [ ] `pnpm install --frozen-lockfile=true`, `format:check`, `typecheck`, `lint`, `test`, `security:secrets`, `db:migrate:preflight`, `production:safety-check` all pass.
- [ ] Release preflight passes and stage/prod refuses unsigned releases.
- [ ] Control plane persists tenants/domains/gates in Postgres; prod refuses in-memory store.
- [ ] Tenant resolution works from the control plane; unknown/forbidden/unverified domains return 421; demo tenant is local-only.
- [ ] Login via verified OIDC/Entra (or explicitly approved pilot fallback); spoofed headers rejected; role-based navigation and backend authorization enforced.
- [ ] Dashboards read from the tenant data plane; empty tenants show empty states, never demo stats.
- [ ] Import dry-run and commit work with lineage and audit; demo data cannot pollute a production tenant.
- [ ] UBM request can be registered, matched, eligibility-checked, exported via maker-checker approval, packaged, downloaded, and receipted — all audited.
- [ ] Documents persist with real storage; prod refuses `disabled-local` scanner; sensitive open requires reason.
- [ ] Audit and data access logs are persistent, hash-chained, and searchable in UI.
- [ ] RLS tests pass including cross-tenant denial and write coverage.
- [ ] Worker runs continuously with persistent jobs, retries, dead-letter; no passthrough success in prod.
- [ ] Go-live gates block production; pilot gates (15) complete or formally waived; pilot banner and limitations visible.
- [ ] No official UBM transport claimed or enabled; manual export only.
- [ ] Docs match code: pilot guide, onboarding, runbooks, incident process, support model delivered.

## Acceptance for Batch 0

- This audit file exists and enumerates every demo/static/in-memory/placeholder runtime use found in the repository.
- No code changes were made in this batch (docs only).
