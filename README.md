# UBM Klar

UBM Klar is a production-grade Swedish municipal readiness, payment-control, evidence, and export-preparation platform for municipalities preparing for UBM-related processes.

This repository is intentionally initialized with a real architecture foundation so Cursor can build against a structured project instead of an empty repository.

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
pnpm typecheck
pnpm lint
pnpm test
```

Most packages are currently scaffolded and should be implemented batch by batch.

## Security rules

- Never expose Supabase service role keys to frontend.
- Never log PII.
- Never put personal identity numbers, names, income records, LSS data, medical data, households, bank accounts, documents, UBM payloads, or case notes in the vendor control plane.
- Sensitive operations must go through backend and worker services.
- Use RLS on all sensitive data plane tables.
- Use maker-checker for exports, payment recipient changes, break-glass, support access, and go-live approvals.
