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
