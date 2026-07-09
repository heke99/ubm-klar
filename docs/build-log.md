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
- **Security notes:** environments store publishable key _references_ only; anything matching
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

## Batch 24 — Legal Source and UBM Obligation Registry

- **Implemented:** migration `202607070027`: legal_sources, legal_source_versions,
  regulatory_obligations(+versions), ubm_obligation_versions, ubm_effective_dates
  (2026-07-01 and 2029-07-01 seeded), ubm_phase_configurations (phase 1 active, phase 2
  disabled behind `ubm_recurring_reporting_2029`), ubm_guidance_documents,
  ubm_schema_statuses; Swedish legal source seed (lag 2023:455/456, LSS, SoL, OSL, GDPR).
  `@ubm-klar/legal-source-engine`: effective-date version resolution failing safe to
  manual review (incl. `awaiting_official_specification`), phase activation checks.
- **Tests:** 8 tests.
- **Status:** production-safe.

## Batch 25 — UBM Schema Registry

- **Implemented:** migration `202607070008`: ubm_schemas, ubm_schema_versions (transport
  profile + approval flags), ubm_schema_fields, ubm_code_lists,
  ubm_schema_validation_rules, ubm_field_mappings; seeds internal working schemas for
  request responses (active) and 2029 recurring placeholders
  (`awaiting_official_specification`, transport `ubm_official_transport_pending`).
  `@ubm-klar/ubm-schema-engine`: registry with usable-version resolution (never resolves
  awaiting-spec schemas), record validation (types, code lists, max length, unknown-field
  rejection to prevent over-sharing).
- **Tests:** 8 tests.
- **Security notes:** no official UBM format is hardcoded anywhere.
- **Status:** production-safe.

## Batch 26 — UBM Eligibility Engine

- **Implemented:** `@ubm-klar/ubm-eligibility-engine`: all 27 eligibility questions
  (request validity, subject, data relevance/necessity, five sensitive categories,
  legal basis/purpose/lineage/classification, redaction/legal/DPO/maker-checker reviews,
  document-reference preference, destination/schema/transport/receipt) producing all 13
  outcome statuses with Swedish blocker texts; deny-by-default, `do_not_send` dominates.
- **Tests:** 22 tests covering every question and outcome.
- **Status:** production-safe.

## Batch 27 — UBM Request Manager

- **Implemented:** migration `202607070009` request tables (ubm_requests,
  ubm_request_subjects with match confidence, ubm_request_items, ubm_request_deadlines,
  ubm_request_reviews). `@ubm-klar/ubm-obligation-engine`: request validation (phase 1
  effective-date gate, enabled intake channels only — official transport intake refused
  until specs exist), full request status machine (received → … → closed) with strict
  transitions.
- **Tests:** 7 request tests.
- **Status:** production-safe.

## Batch 28 — UBM Export Manager

- **Implemented:** migration `202607070009` export tables (ubm_export_proposals with
  eligibility outcomes + legal/rule versions, ubm_export_rows with lineage/classification
  flags, ubm_export_documents reference-first, ubm_submissions with manifest/payload
  hashes + signature, ubm_receipts, ubm_approval_logs append-only).
  `@ubm-klar/ubm-export-engine`: deterministic package builder (sorted rows, sha256
  manifest+payload hashes, signer abstraction with explicit UNSIGNED placeholder),
  `assertSendable` gate (maker-checker approved + transport approved + official transport
  refused), receipt registration into the evidence chain.
- **Tests:** 6 packaging/sending/receipt tests.
- **Status:** production-safe.

## Batch 29 — UBM Notification Inbox

- **Implemented:** migration `202607070009` notification tables (ubm_notifications,
  ubm_notification_confidence_scores, ubm_notification_manual_reviews,
  ubm_notification_outcomes with the six outcome kinds, ubm_feedback_submissions).
  `@ubm-klar/ubm-obligation-engine` notification matching: weighted confidence scoring
  (personnummer, orgnr, decision number, payment reference, amount, date, name fragment),
  auto-match at ≥0.9 with ambiguity guard (top-2 within 0.1 → manual review), manual
  review band, no-match floor.
- **Tests:** 5 matching tests.
- **Status:** production-safe.

## Batch 30 — Recurring UBM Reporting 2029

- **Implemented:** migration `202607070030`: ubm_reporting_schedules (feature-flag key),
  ubm_reporting_periods, ubm_recurring_dataset_definitions (status-gated),
  ubm_recurring_exports, ubm_export_differences, ubm_period_closures (approval workflow +
  receipt + evidence chain verification). `@ubm-klar/ubm-export-engine` recurring module:
  `openReportingPeriod` triple gate (feature flag off by default, dataset status must be
  pilot/active — awaiting_official_specification refused, not before 2029-07-01), period
  state machine through closure, `diffExports` for previous-period differences.
- **Tests:** 6 recurring tests.
- **Status:** production-safe and feature-flagged off by default as required.

## Batch 31 — Economic Assistance Data Model

- **Implemented:** migration `202607070007` with all 30 EA tables (person profiles,
  households + members, applications + periods + documents, income sources with SSBTEK
  codes, declared/verified income, housing + rent documents + address history, assets,
  expenses, norm versions + rules, calculations + rows + deductions + approved amounts,
  decisions + periods + basis, payment batches/payments/recipients/account references,
  recovery claims + events, appeals). RLS enabled on every table.
  `@ubm-klar/economic-assistance-domain` package with typed rule context.
- **Status:** production-safe.

## Batch 32 — Economic Assistance Demo Data

- **Implemented:** deterministic generator (`generateEaDemoData`): 1000 persons / 600
  households / 2000 applications / 2000 decisions / 3000 income records / 1000 housing
  records / 2500 payments / 100 recovery claims by default, with intentional anomalies
  (rejections with payments, missing attachments, account changes, protected households
  without elevated access). Synthetic personnummer only (month 9x).
- **Tests:** determinism, synthetic-PII checks, flag generation.
- **Status:** production-safe.

## Batch 33 — EA Intake and SSBTEK/GIF Metadata

- **Implemented:** ea_income_sources seeded with SSBTEK codes (migration `202607070012`),
  ea_declared_income / ea_verified_income carry `used_in_decision`, `legal_basis`,
  `purpose`, `export_eligible` and `verification_source` (ssbtek/gif/skatteverket/FK/AF/
  CSN/pensionsmyndigheten/a-kassa/bank/employer/manual) + verification references.
- **Tests:** covered through UBM mapping tests (eligibility of income-backed rows).
- **Status:** production-safe.

## Batch 34 — Economic Assistance Payment Control

- **Implemented:** all 25 EA risk rules (payment without decision, exceeds approved,
  after validity, household duplicates, income period/verification/usage, member missing
  from calculation, housing documentation, missing attachments, recovery-claim control,
  shared accounts, account changes, superseded decisions, rejection payments,
  reconsideration payments, household changes, recipients outside household, period
  mismatches, payment file rows without approved decision, recipient changed after
  decision, ignored verified income, protected household access, sensitive reveals).
- **Tests:** 30 tests — every rule has a positive test plus clean-context zero-flag test.
- **Status:** production-safe.

## Batch 35 — Economic Assistance Dashboard

- **Implemented:** `buildEaDashboard`: applications/decisions/approvals/rejections,
  payments and paid totals, open recovery claims, verified income share (SSBTEK/GIF
  metric), anomaly groups (income, household, housing, duplicates, accounts, rejection
  with payment, payment file mismatches), flags by severity, amount at risk.
- **Tests:** aggregation test on demo data.
- **Status:** production-safe.

## Batch 36 — UBM for Economic Assistance

- **Implemented:** `mapEaDecisionToUbm`: schema-conformant export rows for the internal
  EA working schema with eligibility exclusions (not export-eligible, not used in
  decision, missing legal basis/purpose); EA export schema seeded in migration
  `202607070008`; notification/feedback tables shared with LSS in `202607070009`.
- **Tests:** 3 mapping tests.
- **Status:** production-safe.

## Batch 37 — Onboarding and Readiness Score

- **Implemented:** migration `202607070025` (onboarding_steps/progress/blockers/evidence/
  assignments/readiness_scores/recommendations). `@ubm-klar/onboarding-engine`: full
  8-stage guided program (organisation incl. DPO/security/system-owner/UBM/legal/finance
  contacts; deployment incl. Model B/C, domains, environments, storage, keys,
  backup/restore, SIEM, support model; authentication incl. Entra/OIDC/SAML, MFA, group/
  role mapping, break-glass; source systems; data mapping incl. legal basis, purpose,
  retention, classification, export eligibility; payment control; UBM readiness;
  go-live incl. DPIA, PUB/DPA, security review, RLS/SSO/backup/restore/accessibility/
  exit-export tests, UBM mock request+export, reconciliation test, final maker-checker
  approval), all 8 readiness scores, blockers → critical recommendations, `isGoLiveReady`
  gate (100% + no blockers).
- **Tests:** 11 tests.
- **Status:** production-safe.

## Batch 38 — Archive, Retention and E-Archive

- **Implemented:** migrations `202607070014` (retention_policies, data_subject_requests,
  retention_actions append-only, exit_exports + items) and `202607070016`
  (archive_classifications, archive_retention_rules, legal_holds, disposal_decisions with
  maker-checker workflow reference, e_archive_export_packages with manifest + checksums,
  append-only archive_audit_trail). `@ubm-klar/archive-engine`: retention evaluation
  (legal holds always block, unmatched classifications go to manual review), e-archive
  package builder with manifest/content sha256 and verification (tamper + missing entry
  detection).
- **Tests:** 7 tests.
- **Status:** production-safe.

## Batch 39 — Public Record and Secrecy Review

- **Implemented:** migration `202607070017` (public_record_requests, request items,
  secrecy_reviews with legal basis + motivation, disclosure_packages, append-only
  disclosure_logs). `@ubm-klar/public-record-engine`: disclosure gate — every item needs
  secrecy review, redacted releases require completed redaction, withheld items tracked
  with legal basis; request status machine (cannot disclose without review).
- **Tests:** 7 tests.
- **Status:** production-safe.

## Batch 40 — Support Mode without PII

- **Implemented:** migration `202607070013` support_access_sessions (DB CHECK:
  `pii_access = false` structurally, max 8h) + append-only support_access_events.
  `createSupportSession` in `@ubm-klar/access-control`: municipality approval required,
  no self-approval, reason min 10 chars, scoped (technical/import/integration/queue/
  schema/logs-no-pii), time-limited with automatic expiry via `isSessionActive`. Support
  JIT sessions are additionally barred from all PII permissions in `authorize()`.
- **Tests:** 5 session tests + JIT authorization tests from Batch 7.
- **Status:** production-safe.

## Batch 41 — Break-glass

- **Implemented:** break_glass_sessions (DB CHECK: reason ≥ 20 chars, max 4h) + append-only
  break_glass_events (migration `202607070013`); `createBreakGlassSession` requires the
  break_glass_admin role, substantive reason, duration cap; sessions start in
  `post_review_status = pending` and surface in the DPO/legal dashboard; expired sessions
  are denied by `authorize()`.
- **Tests:** 3 break-glass tests + session-expiry authorization test.
- **Status:** production-safe.

## Batch 42 — Reports and Dashboards

- **Implemented:** Next.js 15 web app (`apps/web`) with strict middleware domain gate
  (fail-closed 421 for unknown/forbidden hosts), Swedish role-based navigation for all 17
  areas (Översikt, UBM-beredskap, UBM-förfrågningar, Exportförslag, Underrättelser,
  Kontrollärenden, LSS, Ekonomiskt bistånd, Betalningskontroll, Importer, Dokument,
  Rapporter, Revision och loggar, Juridik och DPO, Säkerhet, Arkiv, Inställningar) plus
  Tillgänglighetsredogörelse; case workers never see infrastructure/billing areas.
  Dashboards: leadership (Översikt), UBM, LSS, EA, payment control, DPO/legal, security,
  archive, production readiness (Inställningar) — leadership/UBM/domain dashboards are
  computed from the domain engines. Design system with loading/empty/error/
  permission-denied states, masked values, "why blocked" explanations. Backend API
  (`apps/api`, Fastify) with fail-closed tenant resolution from Host header,
  RBAC/ABAC-authorized dashboard + eligibility + reveal + support + break-glass routes;
  17 API tests. `next build` passes (18 static routes).
- **Status:** production-safe skeleton; production data wiring replaces demo providers
  per deployment.

## Batch 43 — Privacy/Security Anomaly Detection

- **Implemented:** migration `202607070022` (anomaly_rules seeded with 8 rules,
  anomaly_events, anomaly_review_cases). `@ubm-klar/anomaly-detection`: window-based
  detection (failed-authorization bursts with critical escalation, role-change bursts,
  recipient-change bursts, break-glass without incident, high-volume person access,
  protected-identity access without case) feeding DPO/security dashboards.
- **Tests:** 6 tests.
- **Status:** production-safe.

## Batch 44 — Migration and Release Runner

- **Implemented:** `scripts/release-runner.mjs` CLI: `checksums` (manifest + checksums +
  signature placeholder), `preflight` (manifest/checksum verification, ordering,
  destructive-SQL rejection → enforces expand-migrate-contract), `dry-run` (all
  migrations in one transaction, rolled back), `apply` (per-file transactions,
  `schema_migrations` ledger, prod requires `BACKUP_VERIFIED=true`), `smoke-test`
  (12 release smoke tests), `rollback-plan`; no-PII status updates to the control plane.
  `releases/1.0.0/` with manifest, checksums, signature placeholder, release notes,
  rollback plan, smoke tests, compatibility matrix.
- **Commands run:** full dry-run of all data-plane migrations against local Postgres 16 —
  all migrations apply and roll back cleanly; control-plane migrations verified too.
- **Status:** production-safe.

## Batch 45 — Backup/Restore and Monitoring

- **Implemented:** backup/restore checks modeled in control plane (`tenant_backup_checks`,
  `tenant_restore_tests`, Batch 5), worker health (`workerHealth` — job family coverage +
  queue depth), API/control-plane health endpoints, monitoring documentation
  (docs/deployment/monitoring.md) and backup/restore runbook.
- **Status:** production-safe.

## Batch 46 — SIEM and Incident Support

- **Implemented:** siem_export_config (no-PII technical events; endpoint stored as secret
  reference), security_incidents with `description_no_pii` + append-only
  security_incident_timeline (migration `202607070023`), incident process documentation
  (severity matrix, NIS2 24h/72h reporting, GDPR breach path), no-PII event export via
  `sanitizeTechnicalLogEvent`.
- **Status:** production-safe.

## Batch 47 — Cybersecurity/NIS2 Readiness

- **Implemented:** migration `202607070023`: cyber_risk_register (likelihood/impact,
  treatment, owner), security_controls + security_control_evidence (framework references),
  supplier_risks (criticality, data processed, DPA, security review, exit plan),
  continuity_plans (RTO/RPO, test results), security_exercises. Security dashboard page.
- **Status:** production-safe.

## Batch 48 — Compliance Package

- **Implemented:** GDPR records of processing with legal bases per module
  (docs/gdpr/legal-basis-and-purposes.md), DPIA template with UBM-specific risk matrix
  (docs/dpia/dpia-template.md), PUB/DPA template (docs/gdpr/pub-dpa-template.md),
  subprocessor list template (docs/gdpr/subprocessors.md); legal basis/purpose fields and
  data_subject_requests already in migrations 0007/0014; retention policies in 0014.
- **Status:** production-safe documentation package.

## Batch 49 — Outsourcing and Procurement Package

- **Implemented:** responsibility matrix across Model B/C1/C2/C3
  (docs/procurement/responsibility-matrix.md), cloud/outsourcing assessment support
  (docs/procurement/cloud-outsourcing.md), security appendix, SLA appendix (three tiers,
  RPO/RTO), exit appendix (docs/exit-plan/exit-appendix.md), municipality-owned data
  plane manual (docs/deployment/municipality-owned-data-plane-manual.md), support model
  doc (docs/support/support-model.md).
- **Status:** production-safe.

## Batch 50 — Commercial Billing and Entitlements

- **Implemented:** migration `202607070026` (billing_plans + versions, subscriptions +
  items, entitlements, usage_metrics, billing_events, invoices_no_pii, contract_terms,
  implementation_packages, support_packages; the five packages seeded).
  `@ubm-klar/billing-engine`: plan catalogue (Start/LSS/EB/Kontroll/Enterprise),
  entitlement resolution with validity windows, feature gating with explanations,
  module mapping, billing events/usage metrics that reject citizen data via
  `assertNoPii`. Control-plane billing tables from Batch 3; platform superadmin data is
  no-PII by construction.
- **Tests:** 7 tests.
- **Status:** production-safe.

## Batch 51 — AI Assistance Guardrails

- **Implemented:** migration `202607070028`: ai_model_configurations (PII in prompts
  structurally impossible without approved provider — DB CHECK), ai_prompt_policy
  (8 allowed use cases seeded), ai_suggestions (marking forced to `suggestion_only`,
  `requires_human_review` forced true by CHECK), ai_source_references, ai_review_status,
  ai_guardrail_flags, append-only ai_assistance_logs. `checkAiRequest`/`checkAiOutput`
  in `@ubm-klar/config`: forbidden use cases, protected identity always blocked,
  security-classified blocked, classification ceilings, PII scans of prompt and output,
  decision-language detection, mandatory source references.
- **Tests:** 12 guardrail tests.
- **Status:** production-safe; AI disabled by default (feature flag + provider `disabled`).

## Batch 52 — Exit Export

- **Implemented:** `buildExitExport`/`verifyExitExport` in `@ubm-klar/archive-engine`:
  13-scope takeout (structured data, documents + metadata, audit + access logs, UBM
  exports + receipts, control cases, rule configs, import history, mappings, source
  record links, lineage, evidence chain) with per-item sha256 + manifest hash,
  completeness tracking, tamper detection; requires an approved `exit_export`
  maker-checker workflow (wrong-kind and pending workflows rejected). Tables in
  migration `202607070014`; `exit-exports` bucket in the vault.
- **Tests:** 5 tests.
- **Status:** production-safe.

## Batch 53 — Accessibility Hardening

- **Implemented:** WCAG 2.1 AA / EN 301 549 support in the web app: skip-link, visible
  focus ring, semantic landmarks/headings, table captions + header cells, status conveyed
  with text + color, Swedish plain-language copy, loading/empty/error/permission-denied
  states on every page, masked fields announced to screen readers with reveal
  instructions; accessibility statement page (`/tillganglighet`) and per-municipality
  statement template (docs/accessibility/accessibility-statement-template.md).
- **Status:** production-safe; full AT-user audit is a go-live gate.

## Batch 54 — Production Acceptance Gates

- **Implemented:** migration `202607070024` with 14 seeded gates (DPIA, PUB/DPA, SSO,
  MFA, RLS, backup, restore, SIEM, exit export, accessibility, archive, UBM mock,
  reconciliation, go-live approval), production_readiness_evidence with waiver +
  approval-workflow reference, `production_go_live_status` view whose `go_live_allowed`
  blocks launch; `isGoLiveReady` (onboarding) requires 100% + no blockers; go-live is a
  maker-checker workflow kind.
- **Tests:** onboarding gate tests + smoke test verifying gate seeding.
- **Status:** production-safe.

## Batch 55 — Security Hardening

- **Implemented:** migration `202607070010` + `202607070031`: least-privilege RLS
  policies per role with restrictive no-PII blocks and protected-identity elevation;
  `scripts/rls-tests.mjs` (9 live-database tests: anonymous/no-PII/support sessions see
  nothing, case worker sees normal but not protected persons, DPO sees protected,
  billing admin blocked from UBM, write denial); `scripts/scan-secrets.mjs` (service-role
  JWTs, sb_secret, private keys, AWS/Stripe keys, credential URLs — clean over 301
  files); dependency scan script (`pnpm security:deps`); security checklist
  (docs/security/security-checklist.md); cross-tenant isolation covered by resolver leak
  tests + per-tenant service-key tests + `no_shared_prod` DB constraint.
- **Commands run:** full apply of all 31 migrations + smoke tests + RLS tests against
  local Postgres 16 — all green.
- **Status:** production-safe.

## Batch 56 — End-to-End Demo Flows

- **Implemented:** `apps/api/src/demo-flows.test.ts` — 10 end-to-end suites: LSS payment
  control, LSS UBM request→blocked→lineage fix→review→maker-checker→package→receipt→
  evidence chain, EA UBM mapping, reconciliation duplicate→recovery-claim conflict, UBM
  notification→case→outcome, support without PII, break-glass with pending post-review,
  public record secrecy review with redaction, e-archive + exit export verification,
  onboarding readiness/go-live gating, EA payment control on demo data.
- **Tests:** 10 e2e suites, all passing.
- **Status:** production-safe.

## Batch 57 — Final Production Readiness

- **Implemented:** full verification run — `pnpm build` (36 tasks incl. Next.js, PASS),
  `pnpm typecheck` (PASS), `pnpm lint` (PASS), `pnpm test` (36 packages PASS), migration
  preflight + dry-run + apply + smoke tests + RLS tests against Postgres 16 (PASS),
  secret scan (PASS). Final report: docs/production-readiness-report.md with acceptance
  criteria mapping and pre-first-go-live hardening notes.
- **Status:** release 1.0.0 production-safe; per-tenant go-live gated by the 14
  production readiness gates.

---

# Customer pilot hardening (Pilot Batches)

The following batches harden the platform for a controlled customer pilot and real
production. They supersede earlier "production-safe" labels where the audit
(docs/audits/customer-pilot-readiness-audit.md) found demo/in-memory/placeholder
runtime behaviour.

## Pilot Batch 0 — Full repo audit and baseline

- **Implemented:** complete repository audit against the customer-pilot readiness
  criteria. Every demo/static/in-memory/placeholder runtime use is enumerated with
  exact files, priorities (P0/P1/P2), required tests, and a go/no-go checklist in
  `docs/audits/customer-pilot-readiness-audit.md`.
- **Key findings:** in-memory control plane + audit/data-access sinks; empty tenant
  directory; header-based auth; demo data served from API dashboards and all 18
  force-static web pages; no-op worker (13/20 passthrough job types); no Postgres/
  OIDC/queue/storage implementations anywhere; migration manifest drift
  (`202607070002_control_plane_no_pii.sql` missing from release 1.0.0 manifest, so
  `pnpm db:migrate:preflight` fails); unsigned release accepted; CI uses
  `--frozen-lockfile=false`; secret scanner is git-only.
- **Files:** `docs/audits/customer-pilot-readiness-audit.md`,
  `docs/production-readiness-report.md` (status corrected), this log.
- **Migrations:** none.
- **Tests:** none (docs only, per batch definition).
- **Commands run:** repo-wide static inspection only.
- **Remaining work:** Pilot Batches 1–25.
- **Env vars:** none.
- **Security/compliance notes:** the audit corrects the earlier overstatement that
  release 1.0.0 is production-safe; it is a well-tested domain layer with demo runtime
  wiring, and must not be piloted with real data until P0 blockers are closed.
- **Status:** needs hardening (baseline established; no production claims).

## Pilot Batch 1 — Release, CI, and quality gates

- **Implemented:**
  - Removed the orphan `supabase/migrations/202607070002_control_plane_no_pii.sql`
    (duplicate control-plane scaffold in the data plane; canonical schema lives in
    `apps/control-plane/migrations/`); regenerated release 1.0.0 manifest + checksums;
    `pnpm db:migrate:preflight` passes again.
  - Preflight now rejects duplicate migration timestamps (deterministic ordering) and
    enforces the release signature policy.
  - Real ed25519 release signing: `release-runner sign` / `verify-signature` commands,
    `RELEASE_SIGNING_PRIVATE_KEY`/`RELEASE_SIGNING_PUBLIC_KEY` env vars. local/demo/test
    may run unsigned; stage/prod fail closed on unsigned or unverifiable releases
    (verified: signed release passes with correct key, fails with wrong key).
  - CI rewritten: strict `pnpm install --frozen-lockfile=true`, `format:check`,
    `typecheck`, `lint`, `test`, `security:secrets`, blocking `security:deps`,
    `db:migrate:preflight`, `production:safety-check`; a second job runs migration
    dry-run/apply/smoke/RLS tests against a Postgres 16 service container; a separate
    non-blocking job publishes the full dependency report.
  - `security:deps` no longer swallows failures (`|| true` removed; a separate
    `security:deps:report` remains informational). Upgraded vitest 2.1 -> 3.2 and pinned
    `vite >= 6.4.3` via pnpm override, clearing the critical (vitest UI RCE) and high
    (vite fs.deny bypass) advisories; only 1 moderate advisory remains (documented).
  - `scripts/scan-secrets.mjs` rewritten: works without git (filesystem walk fallback),
    skips binaries/build output, allowlists documented safe examples by line context,
    adds GitHub/Slack/AWS-pair token patterns; verified to catch a planted key in a
    git-less directory.
  - `scripts/production-safety-check.mjs` + `pnpm production:safety-check`: boots each
    app entry point with production env and asserts refusal (api without tenant
    directory, control-plane without database, worker without queue), asserts unsigned
    releases are refused in prod, manifest consistency, and signature file presence.
  - Interim fail-closed guards added to `apps/api/src/main.ts`,
    `apps/control-plane/src/main.ts`, `apps/worker/src/main.ts` (replaced by full typed
    env validation in Pilot Batch 2).
  - Repo-wide Prettier pass — `format:check` is now enforced in CI.
- **Files:** `scripts/release-runner.mjs`, `scripts/scan-secrets.mjs`,
  `scripts/production-safety-check.mjs`, `.github/workflows/ci.yml`, `package.json`,
  `releases/1.0.0/*`, `apps/*/src/main.ts`, all `package.json` vitest bumps.
- **Migrations:** one file removed from the data plane set (never applied anywhere;
  manifest never listed it). 31 data-plane migrations remain.
- **Tests:** full suite green on vitest 3 (36 tasks). Migration dry-run + apply + 12
  smoke tests + 9 RLS tests verified against local Postgres 16.
- **Commands run:** `pnpm install --frozen-lockfile=true`, `pnpm format:check`,
  `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm security:secrets`,
  `pnpm security:deps`, `pnpm db:migrate:preflight`, `pnpm production:safety-check`,
  `db:migrate:dry-run/apply/smoke-test/rls-test --db postgresql://…` — all pass.
- **Remaining:** Pilot Batches 2–25.
- **Env vars:** `RELEASE_SIGNING_PRIVATE_KEY` (CI/release pipeline only),
  `RELEASE_SIGNING_PUBLIC_KEY` (stage/prod verification).
- **Security notes:** no unsigned release can pass preflight/apply in stage/prod; CI
  dependency audit now blocks on high/critical.
- **Status:** production-safe for the release pipeline; apps still need Batches 2+.

## Pilot Batch 2 — Environment validation and production fail-closed mode

- **Implemented:** `packages/config/src/app-config.ts` — typed `AppConfig` with five
  environment modes (local/demo/test/stage/prod via `APP_ENV`, `NODE_ENV` fallback).
  stage/prod require: APP_BASE_URL, API_BASE_URL, CONTROL_PLANE_DATABASE_URL or
  CONTROL_PLANE_URL, fail-closed tenant resolver, auth provider config (issuer +
  client id for entra/oidc/saml), SESSION_SECRET (web), DATA_PLANE_SERVICE_KEY_SOURCE,
  document storage + malware scanner providers, postgres audit/data-access sinks,
  queue provider + WORKER_QUEUE_URL, RELEASE_SIGNING_PUBLIC_KEY, BACKUP_PROVIDER.
  stage/prod forbid: `local_demo_shared`, demo data, demo tenant, in-memory
  control-plane/audit/data-access/queue, `disabled-local` scanner, local document
  storage, `supabase_auth` as primary auth, header auth without
  INTERNAL_AUTH_PROXY_TRUSTED + secret, `WORKER_MODE=noop`.
  `UBM_OFFICIAL_TRANSPORT` must stay `disabled` in every mode. All four apps consume
  the loader at startup (`apps/*/src/main.ts`, `apps/web/instrumentation.ts`) and exit
  on `UnsafeProductionConfigError`. `.env.example` rewritten with local/demo and
  stage/prod sections and [MANDATORY stage/prod] markers.
- **Files:** `packages/config/src/app-config.ts` (+ index export), four app entry
  points, `apps/web/instrumentation.ts`, `.env.example`,
  `scripts/production-safety-check.mjs` (now 13 checks).
- **Migrations:** none.
- **Tests:** `packages/config/src/app-config.test.ts` — 24 tests covering valid prod
  env, every forbidden provider, missing env reporting, mode aliases, official
  transport lockout; full suite green (36 tasks).
- **Commands run:** `pnpm --filter @ubm-klar/config test`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `pnpm production:safety-check` (13/13 PASS).
- **Remaining:** wire real providers behind the config (Batches 3–15).
- **Env vars:** documented in `.env.example`; new: APP_ENV, CONTROL_PLANE_STORE,
  CONTROL_PLANE_ADMIN_TOKEN, AUTH_PROVIDER/AUTH_ISSUER/AUTH_CLIENT_ID/AUTH_AUDIENCE/
  AUTH_JWKS_URI/AUTH_CLIENT_SECRET, SESSION_SECRET, INTERNAL_AUTH_PROXY_TRUSTED/SECRET,
  DATA_PLANE_SERVICE_KEY_SOURCE, DATA_PLANE_DATABASE_URL, AUDIT_SINK, DATA_ACCESS_SINK,
  QUEUE_PROVIDER, WORKER_MODE, BACKUP_PROVIDER, UBM_OFFICIAL_TRANSPORT,
  DOCUMENT_MAX_UPLOAD_BYTES.
- **Security notes:** apps refuse unsafe production startup before binding a port;
  local development needs no env vars at all.
- **Status:** production-safe (fail-closed validation active in all apps).

## Pilot Batch 3 — Control plane persistence

- **Implemented:** new `@ubm-klar/db` package (pg pool client, transactions, idempotent
  migration applier with per-schema ledger). `PostgresControlPlaneStore`
  (apps/control-plane/src/postgres-store.ts) implementing the full `ControlPlaneStore`
  interface against `apps/control-plane/migrations` (tenants, domains, environments,
  modules, auth providers, feature flags, support cases, readiness gates, health
  checks, release status, provisioning runs + steps). Store interface converted to
  async; provisioning runs now persist via the store instead of a service-local Map.
  `main.ts` selects Postgres when `CONTROL_PLANE_DATABASE_URL` is set (auto-applies
  control-plane migrations at boot) and refuses in-memory in stage/prod. Bearer-token
  admin auth on all routes except /health (timing-safe compare;
  `CONTROL_PLANE_ADMIN_TOKEN`, mandatory in stage/prod via config). New endpoints:
  `POST /tenants/:id/domains/:domainId/verify`, `GET /tenants/:id/environments`,
  `GET /tenants/:id/modules`, `PUT/GET /tenants/:id/auth-providers` (rejects secret
  references), `PUT/GET /tenants/:id/approvals` (pilot/production approval flags stored
  as readiness gates, approver+reason required, production allowed only when all
  required gates pass or are waived), `GET /directory/domains/:domain` (verified-only
  tenant directory lookup for the API resolver; unverified/unknown -> 404).
- **Files:** `packages/db/*`, `apps/control-plane/src/{store,postgres-store,server,provisioning,main,index}.ts`.
- **Migrations:** none new (uses existing 0001/0002 control-plane migrations, now
  actually applied and queried at runtime).
- **Tests:** 29 control-plane tests: 15 API, 7 admin-auth/approvals/domain-verify, 7
  Postgres repository tests against real Postgres 16 (tenant round-trip across store
  instances, domain verify, module idempotency, gate upsert, PII rejection at store
  level, environment key references, provisioning persistence). Runtime verification:
  tenant created via HTTP survived process restart; unauthenticated request got 401.
- **Commands run:** `pnpm --filter @ubm-klar/control-plane test` (with
  `CONTROL_PLANE_TEST_DATABASE_URL`), `pnpm typecheck`, `pnpm test` (37 tasks),
  `pnpm lint`, `pnpm production:safety-check` (13/13).
- **Remaining:** wire API tenant resolver to `/directory/domains/:domain` (Batch 4).
- **Env vars:** `CONTROL_PLANE_DATABASE_URL`, `CONTROL_PLANE_ADMIN_TOKEN`,
  `CONTROL_PLANE_TEST_DATABASE_URL` (tests only).
- **Security notes:** no-PII guard now enforced at three layers (API scan, store scan,
  schema); secret references rejected on environments and auth providers; directory
  endpoint never returns key values, only references.
- **Status:** production-safe.
