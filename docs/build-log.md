# UBM Klar Build Log

Per-batch implementation log. Each entry records what was implemented, files changed,
migrations added, tests added, commands run, remaining work, environment variables needed,
security/compliance notes, and production-safety status.

---

## Batch 1 — Repository foundation

- **Implemented:** pnpm + Turborepo monorepo aligned; 32 workspace packages scaffolded under
  `packages/`; shared strict TypeScript config; ESLint 9 flat config + Prettier; Vitest per
  package; docs skeleton (15 sections); `.env.example` retained; root scripts for security
  scanning, release running and demo reset.
- **Files:** `package.json`, `eslint.config.mjs`, `.prettierrc.json`, `scripts/scaffold-*.mjs`,
  `packages/*/package.json|tsconfig.json|src/index.ts`, `docs/*/README.md`.
- **Migrations:** none yet.
- **Tests:** `packages/config` — no-PII scanner (personnummer Luhn validation, forbidden field
  names, nesting) and env reader (12 tests).
- **Commands:** `pnpm install`, `pnpm --filter @ubm-klar/config test`, package typechecks.
- **Remaining:** all product batches.
- **Env vars:** none required for build/test.
- **Security notes:** `assertNoPii` guard is the mandatory boundary check for the control
  plane and telemetry; personnummer detection uses date-plausibility + Luhn so real identity
  numbers are caught while technical IDs pass.
- **Status:** production-safe foundation.

## Batch 2 — Product rename and brand foundation

- **Implemented:** brand constants in `@ubm-klar/shared-types` (`PRODUCT_NAME`,
  `PRODUCT_TAGLINE_SV`, `NON_AUTHORITY_DISCLAIMER_SV/EN`, forbidden domain patterns);
  architecture overview and domain/brand rules documentation; README positioning language.
- **Files:** `packages/shared-types/src/brand.ts`, `docs/architecture/overview.md`,
  `docs/architecture/domain-rules.md`, `README.md`.
- **Migrations:** none.
- **Tests:** brand rules enforced via tenant-resolver tests (Batch 4).
- **Security notes:** forbidden-domain list (ubm.se, utbetalningsmyndigheten.se, gov-style
  domains) is enforced in code, not just documentation.
- **Status:** production-safe.

## Batch 3 — Control Plane

- **Implemented:** no-PII control-plane service (`apps/control-plane`): Fastify API with a
  preValidation PII scan on every request body (422 on violation); in-memory store with
  `assertNoPii` at every write (defence in depth); SQL schema `migrations/0001` with all
  required tables (tenants, tenant_domains, tenant_environments, tenant_modules,
  tenant_auth_providers, tenant_release_status, tenant_support_cases,
  tenant_production_readiness, tenant_feature_flags, tenant_health_checks,
  tenant_onboarding_progress/blockers, plans, subscriptions, entitlements, usage_metrics,
  billing_events, implementation_projects, support_packages, legal_source_versions,
  ubm_schema_versions_control, ubm_obligation_versions_control, release_channels,
  release_artifacts, migration_runs_no_pii).
- **Tests:** 15 API tests incl. PII rejection, forbidden domains, secret-reference rejection.
- **Security notes:** environments store publishable key *references* only; anything matching
  service_role/secret is rejected with 400.
- **Status:** production-safe (persistence adapter for Postgres wiring is deployment work).

## Batch 4 — Tenant Resolver

- **Implemented:** `@ubm-klar/tenant-resolver`: strict fail-closed resolver (unknown domain
  throws, no default tenant), brand-rule enforcement even for directory-registered domains,
  unverified-domain rejection (spoof protection), directory-mismatch leak detection, frozen
  configs, secret-material scanning of resolved config, TTL cache (positive results only).
  Domain validation lives in `@ubm-klar/shared-types` (`validateTenantDomain`) and is shared
  with the control plane. `@ubm-klar/supabase-client` provides browser (publishable-key) vs
  service (per-tenant env var `DATA_PLANE_SERVICE_KEY__<SLUG>__<ENV>`) connections; service
  connections throw in browser contexts.
- **Tests:** 13 resolver tests (incl. cross-tenant leakage, cache TTL, spoofing) + 6
  supabase-client guard tests.
- **Status:** production-safe.

## Batch 5 — Tenant Provisioning

- **Implemented:** `ProvisioningService` with the canonical 20-step flow (create tenant →
  ... → approve go-live), strict step ordering (409 on out-of-order completion), refusal to
  provision `prod` for `local_demo_shared` deployments; control-plane migration `0002` with
  tenant_provisioning_runs/steps, tenant_domain_verifications, tenant_data_plane_connections,
  tenant_environment_checks, tenant_backup_checks, tenant_restore_tests, tenant_sso_tests,
  tenant_rls_test_runs, tenant_smoke_test_runs.
- **Tests:** provisioning API tests (step ordering, full run, prod refusal for shared mode).
- **Status:** production-safe skeleton; live Supabase project creation is an operator runbook
  action (see docs/deployment) by design — the control plane never holds data-plane secrets.

## Batch 6 — Data Plane Schema Foundation

- **Implemented:** data-plane migration `202607070001_core_init.sql`: `app` schema with
  session helpers (`app.current_user_id`, `app.current_roles`, `app.is_no_pii_session`),
  municipality_profile (single row — one data plane per municipality), committees,
  departments, units, source_systems, integration_connections, import_batches,
  import_errors, persons (with `is_synthetic` demo marker, protected identity levels),
  person_identifiers, protected_identity_events, organizations, representatives,
  contact_persons. RLS enabled deny-by-default on all sensitive tables with a
  restrictive policy blocking no-PII sessions from person tables. `supabase/config.toml`
  for local development.
- **Status:** production-safe foundation.

## Batch 7 — Auth and Access Control

- **Implemented:** migration `202607070002`: identity_providers (Entra/SAML/OIDC/Supabase
  fallback with `allowed_for_production`), user_profiles, external_identities,
  roles/permissions/role_permissions, role_mappings (IdP claims → roles), user_roles,
  access_scopes (ABAC). `@ubm-klar/access-control`: role→permission matrix for all 20
  roles, `authorize()` combining RBAC + ABAC (module entitlement, department binding,
  data classes, protected identity, session kind/expiry) + need-to-know. Migration
  `202607070011` seeds the role and permission catalogue (Swedish display names).
- **Tests:** 15 authorization tests (no-PII wall, JIT restrictions, session expiry,
  module gating, need-to-know, protected identity, reason-required reveals).
- **Security notes:** no-PII roles are structurally barred from PII permissions even if
  the matrix were misconfigured (double check in `authorize`).
- **Status:** production-safe.

## Batch 8 — Internal Secrecy and Need-to-Know

- **Implemented:** migration `202607070015`: case_access_grants (+ `app.has_case_access`),
  purpose_bound_access (time-limited, purpose-required), access_review_findings,
  `dpo_access_review` view. `@ubm-klar/internal-secrecy`: reason-required reveal
  evaluation (min 10 chars, Swedish error copy), display masking helpers, curiosity-
  browsing detection (high volume, off-hours, repeated same-person search, protected
  identity without case, case opens without assignment).
- **Tests:** 12 tests covering reveal gating, masking and all detection rules.
- **Status:** production-safe.

## Batch 9 — Audit and Data Access Logs

- **Implemented:** migration `202607070003`: append-only (trigger-enforced) audit_events
  with hash chaining columns, data_access_events, sensitive_field_reveals (reason
  length constraint in DB). `@ubm-klar/audit`: hash-chained `AuditLogger` +
  `verifyChain` tamper detection; full audit event key catalogue. `@ubm-klar/data-access-log`:
  reason-required access kinds, `sanitizeTechnicalLogEvent` (no-PII helper for anything
  leaving the data plane).
- **Tests:** chain integrity/tamper tests, reason enforcement, technical log PII rejection.
- **Status:** production-safe.

## Batch 10 — Information Classification

- **Implemented:** migration `202607070018`: information_classifications (C/I/A 0-3,
  data class, masked_by_default, reveal_requires_reason, export_requires_approval) with
  seeded defaults. `@ubm-klar/data-classification`: registry with fail-closed default
  (unknown targets = confidential personal data). `@ubm-klar/information-classification`:
  shipped defaults for core fields, document types, UBM exports, SIEM integration.
- **Tests:** 5 registry tests including fail-closed behaviour.
- **Status:** production-safe.

## Batch 11 — Document Vault

- **Implemented:** migration `202607070004`: storage_buckets_config (all nine buckets,
  public access structurally impossible via CHECK constraint), documents (hash, malware
  scan status, redaction linkage), document_export_approvals (approver ≠ requester DB
  constraint, reference-first export modes), document_access_events (append-only),
  document_redaction_jobs. `@ubm-klar/document-vault`: bucket policies (roles, mime
  allowlists, size limits, PII flags), upload validation (magic bytes, traversal guard,
  sha256), export gate (references first; full documents only after approval; redaction
  precondition). `@ubm-klar/redaction-engine`: rule-based masking (personnummer via Luhn,
  account numbers) with post-redaction verification.
- **Tests:** 16 tests across vault and redaction.
- **Status:** production-safe.

## Batch 12 — Import Engine

- **Implemented:** `@ubm-klar/import-engine`: RFC4180-style CSV parser (`;`/`,`), JSON
  array parser, flat XML parser, Excel adapter abstraction, format detection, file
  hashing, mapping templates with transforms (date_iso, amount_sek, personnummer
  normalize), required-field validation, mapping wizard suggestions, import validation
  reports with loaded/partially_loaded/rejected statuses.
- **Tests:** 14 parser/mapping/report tests.
- **Status:** production-safe.

## Batch 13 — System of Record and Data Lineage

- **Implemented:** migration `202607070021`: system_of_record_definitions,
  source_record_links, data_conflicts (masked values only), reconciliation_statuses,
  data_lineage_records, record_hashes, export_hashes. `@ubm-klar/data-lineage`:
  completeness rules (imported data requires source record link), entity lineage check
  (feeds UBM eligibility), system-of-record resolution with validity windows and
  field-over-entity precedence. `@ubm-klar/evidence-chain`: hash-linked append-only
  evidence chains per subject with tamper verification.
- **Tests:** 12 lineage + evidence chain tests.
- **Status:** production-safe.

## Batch 14 — Data Quality Engine

- **Implemented:** `@ubm-klar/data-quality-engine`: full shared check catalogue (26
  checks incl. personnummer format with Luhn + synthetic-demo exemption, payment/decision
  consistency, lineage, classification, legal basis, purpose, UBM mapping, recipient
  verification, SSO role mapping, DPO/legal approval), all ten result statuses, severity
  aggregation, batch reports with per-check counts.
- **Tests:** 13 engine tests.
- **Status:** production-safe.

## Batch 15 — Rule Engine and Payment Control Foundation

- **Implemented:** `@ubm-klar/rule-engine`: versioned risk rules with registry statuses
  (draft rules never run), latest-allowed-version selection, explainable flags carrying
  rule key + version + legal source version + evidence references + amount at risk,
  dry-run mode, severity overrides. `@ubm-klar/payment-control-engine`: payment status
  state machine (all 11 statuses, stop/pause require maker-checker workflow + reason).
- **Tests:** 6 rule-engine + 4 payment-status tests.
- **Status:** production-safe.

## Batch 16 — Maker-Checker Approval Workflows

- **Implemented:** `@ubm-klar/approval-workflows`: ordered approval steps per workflow
  kind (ubm_export, document_export, payment_recipient_change, payment_stop, break_glass,
  exit_export, e_archive_export, disposal_decision, go_live, rule_configuration_change);
  invariants: creator can never approve own workflow, one person cannot approve two steps,
  strict step order, immutable decisions, rejection terminates. Migration `202607070019`
  adds the same guard at DB level (trigger `app.enforce_maker_checker`) plus append-only
  approval_audit_log.
- **Tests:** 10 workflow tests covering every invariant.
- **Status:** production-safe.

## Batch 17 — Control Case Management

- **Implemented:** control case state machine in `@ubm-klar/payment-control-engine`:
  sources (risk_flag, ubm_notification, manual, import_error, payment_anomaly,
  access_anomaly), automatic case creation from high/critical non-dry-run flags,
  lifecycle open→assigned→investigating→awaiting_decision→decided→closed with full
  status history, outcomes (recovery_claim, payment_stopped, no_action, police_report,
  corrected_source_data, other_action), outcome required before closing decided cases.
  Case tables land in migration `202607070006` (shared across domains). APIs/UI in the
  api/web batches.
- **Tests:** 5 case lifecycle tests.
- **Status:** production-safe core; API/UI wiring follows in dashboards phase.

## Batch 18 — Payment Files and Reconciliation

- **Implemented:** migration `202607070020`: payment_files, payment_file_rows,
  payment_recipient_registry (verified accounts, person XOR organization constraint),
  payment_account_change_logs (append-only, approval-workflow reference), payment_blocklists,
  payment_status_history (append-only), payment_pause_decisions, payment_stop_actions,
  payment_reconciliation_runs/results, recovery_claim_links. `@ubm-klar/reconciliation-engine`:
  full reconciliation (blocklist, in-file duplicates, decision matching, amount mismatch,
  decision-period check, recovery-claim conflict, registry account mismatch, account change
  within configurable window) with severities and evidence references.
- **Tests:** 10 reconciliation tests.
- **Status:** production-safe.

## Batch 19 — LSS Data Model

- **Implemented:** migration `202607070005` with all 33 LSS tables
  (lss_person_profiles → lss_recovery_events including personkreis assessments,
  need assessments, basic/other needs, decision basis, appeals, providers, IVO permits,
  contracts, payment accounts, status history, provider risk flags, assistants,
  assignments, time reports + rows + approvals + anomalies, invoices + rows + links +
  validation results, payment batches, payments, recipients, recovery claims + events),
  RLS enabled on every table. Migration `202607070006` adds the shared risk rule registry,
  risk_flags, control_cases (+assignments/notes/documents/decisions/events/status history,
  append-only) and evidence_chain_entries. `@ubm-klar/lss-domain` package with typed rule
  context.
- **Status:** production-safe.

## Batch 20 — LSS Demo Data

- **Implemented:** deterministic seeded generator (`generateLssDemoData`, mulberry32 PRNG)
  producing 500 persons / 1000 decisions / 100 providers / 2000 time reports / 1500
  invoices / 3000 payments / 20 recovery claims / 10 UBM requests by default, with
  intentional anomalies (~4% inflated invoices, missing decision links, expired IVO
  permits, account changes) so demo flows produce risk flags. Synthetic personnummer use
  month 90-98 (structurally impossible) and `is_synthetic` markers. `pnpm demo:reset`
  regenerates JSON seeds.
- **Tests:** determinism, volumes, synthetic-only PII, flag generation.
- **Status:** production-safe (generator refuses nothing — but seeding is provisioning-
  gated to demo/test environments).

## Batch 21 — LSS Matching and Reconciliation

- **Implemented:** `matchDecisions`: decision hours ↔ time reports ↔ invoices ↔ payments
  ↔ provider ↔ IVO permit ↔ recipient verification per decision with issue lists
  (over-invoicing, invoicing without reports, paid > invoiced, inactive provider,
  missing permit, unverified recipient).
- **Tests:** clean match + issue detection tests.
- **Status:** production-safe.

## Batch 22 — LSS Risk Rules

- **Implemented:** all 25 LSS risk rules as versioned rule definitions (v1.0.0, status
  active, legal source `lss_1993_387@2026-07-01`): payments outside decision period (1-2),
  billed hours vs decision (3), missing time report (4), provider approval/IVO/orgnr
  (5-7), assistant overlap/unreasonable hours (8-9), duplicate invoice/payment (10-11),
  recovery-claim conflicts (12, 23), account change near payment (13), protected identity
  protection gap (14), medical document misclassification (15), missing decision link (16),
  recipient mismatch (17), ended decision invoicing (18), unapproved time report (19),
  unusual hours increase (20), payment file unknown recipient (21), paid without approved
  invoice (22), unreviewed provider flags (24), sensitive access without reason (25).
- **Tests:** 30 tests — every rule has at least one positive and the catalogue has a
  clean-context zero-flag test.
- **Status:** production-safe.

## Batch 23 — LSS Dashboard

- **Implemented:** `buildLssDashboard`: decided/reported/invoiced hours, invoiced/paid
  amounts, decisions with issues, flags by severity and rule (with amount at risk),
  providers without active permit, unapproved time reports, open recovery claims;
  filters by period, provider and minimum severity. UI wiring in the web batches.
- **Tests:** aggregation + filter tests.
- **Status:** production-safe.
