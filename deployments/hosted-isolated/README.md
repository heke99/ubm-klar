# Model B — Vendor-hosted isolated data plane

One Supabase project **per municipality per environment** (test/stage/prod). Nothing is
shared between municipalities: separate Postgres, Auth, Storage, Edge Functions, RLS
policies, API keys and backups.

## Provisioning (per municipality)

1. Create three Supabase projects: `<slug>-test`, `<slug>-stage`, `<slug>-prod`.
2. Store the service keys in the vendor secret store under
   `DATA_PLANE_SERVICE_KEY__<SLUG>__<ENV>` (one secret per tenant per environment; the
   control plane stores only _references_).
3. Register tenant, domains (`<slug>.ubmklar.se`, `<slug>-test.ubmklar.se`,
   `<slug>-stage.ubmklar.se`) and environments in the control plane; verify domains
   (DNS TXT challenge).
4. Configure the municipality's Entra ID/SAML/OIDC in each project's Auth settings.
   Supabase Auth stays as fallback/break-glass only.
5. Create the nine storage buckets (see `@ubm-klar/document-vault` policies); public
   access must remain disabled (enforced by `storage_buckets_config` CHECK).
6. Run migrations: `node scripts/release-runner.mjs apply --release <v> --db <url>`
   (preflight + dry-run first; `BACKUP_VERIFIED=true` required for prod).
7. Seed roles/rules only. Synthetic demo data is allowed in test/demo only.
8. Run RLS tests, smoke tests, backup + restore test, SIEM configuration, support-mode
   configuration, then the production readiness gates.
9. Go-live requires maker-checker approval (`go_live` workflow).

## Isolation guarantees

- No shared tables, storage, auth config, service keys, logs, vector stores or support
  bundles across municipalities.
- Vendor telemetry receives only no-PII technical events (enforced by
  `sanitizeTechnicalLogEvent` / `assertNoPii`).
