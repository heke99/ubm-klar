# UBM Klar

UBM Klar is a Swedish municipal readiness, payment-control, evidence, and export-preparation platform for municipalities preparing for UBM-related processes.

**Current status: ready for CONTROLLED CUSTOMER PILOTS.** The platform has real
authentication (Entra ID/OIDC), persistent multi-service runtime (control plane,
API, worker, web) against isolated per-municipality Postgres data planes,
hash-chained audit logging, maker-checker export controls and fail-closed
production configuration. Production go-live per municipality is additionally
gated by the production readiness gates (see `/onboarding` and
[docs/production-readiness-report.md](docs/production-readiness-report.md) for
an honest breakdown of what is pilot-ready versus production-blocked).

## Product scope

UBM Klar helps municipalities:

- prepare for UBM request-based handling
- prepare for future recurring UBM reporting
- structure and validate municipal payment-related data
- control incorrect payments
- manage LSS/personlig assistans data
- manage economic assistance data
- handle UBM requests
- create UBM export proposals
- review and approve UBM exports
- receive and process UBM notifications
- manage control cases
- reconcile payments
- manage evidence chains
- support audit, data access logs, archive, retention, DPIA, PUB/DPA, accessibility, cybersecurity, and exit export

## Important positioning

UBM Klar is not an official Utbetalningsmyndigheten service. It is a municipal readiness and control platform that helps municipalities prepare, structure, review, and document their own data and internal processes.

## Architecture principle

Do not build production as a normal shared multi-tenant SaaS.

Production must support isolated municipal data planes:

- **Model B:** vendor-hosted isolated Supabase/Postgres project per municipality
- **Model C:** municipality-owned data plane, including managed Supabase, self-hosted Supabase, or Postgres plus separate storage

The central control plane must never store municipal personal data.

## Repository layout

```txt
apps/
  web/            Next.js municipal UI
  api/            Backend API for sensitive operations
  worker/         Background jobs
  control-plane/  No-PII tenant, release, billing, support and health control plane
packages/
  shared packages for tenant resolution, access control, audit, UBM, LSS, economic assistance, payment control, etc.
supabase/
  migrations, seed and edge function placeholders
docs/
  architecture, security, GDPR, DPIA, procurement, deployment, support, accessibility, archive and exit plan docs
releases/
  release package metadata and migration manifests
```

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Domain and brand rules](docs/architecture/domain-rules.md)
- [Build log per batch](docs/build-log.md)
- `docs/` contains security, GDPR, DPIA, procurement, deployment, incident-response,
  support, accessibility, archive, e-archive, user-manual, onboarding, legal-source and
  exit-plan documentation.

## Local setup

```bash
pnpm install
pnpm build        # all packages + Next.js web app
pnpm typecheck
pnpm lint
pnpm test         # 36 packages, 300+ tests

# database verification (requires a local PostgreSQL, e.g. deployments/docker)
pnpm db:migrate:preflight
pnpm db:migrate:dry-run -- --db postgresql://ubm:ubm@localhost/ubm_dataplane
pnpm db:migrate:apply -- --db postgresql://ubm:ubm@localhost/ubm_dataplane
pnpm db:smoke-test -- --db postgresql://ubm:ubm@localhost/ubm_dataplane
pnpm db:rls-test -- --db postgresql://ubm:ubm@localhost/ubm_dataplane

pnpm security:secrets   # secret scanner
```

No environment variables are required for build/test. Deployment variables are
documented in `.env.example` and `docs/deployment/`.

See [docs/production-readiness-report.md](docs/production-readiness-report.md) for the
release verification status and [docs/build-log.md](docs/build-log.md) for the
batch-by-batch implementation log.

## Security rules

- Never expose Supabase service role keys to frontend.
- Never log PII.
- Never put personal identity numbers, names, income records, LSS data, medical data, households, bank accounts, documents, UBM payloads, or case notes in the vendor control plane.
- Sensitive operations must go through backend and worker services.
- Use RLS on all sensitive data plane tables.
- Use maker-checker for exports, payment recipient changes, break-glass, support access, and go-live approvals.
