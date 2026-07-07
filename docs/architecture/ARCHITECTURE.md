# UBM Klar Architecture

## Core principle

UBM Klar is not a normal shared multi-tenant SaaS in production.

It uses:

- shared product code
- central no-PII control plane
- isolated municipal data planes
- strict domain-based tenant resolution
- backend/worker controlled sensitive operations
- RLS and authorization defense in depth

## Deployment models

### Model B: vendor-hosted isolated data plane

Each municipality gets separate:

- Supabase project
- Postgres database
- Auth configuration
- Storage
- API keys
- backups
- environments
- RLS policies

### Model C: municipality-owned data plane

The municipality owns the data plane and all production data.

Supported variants:

- C1: municipality-owned managed Supabase
- C2: self-hosted Supabase
- C3: Postgres + separate storage + vendor backend

## Control plane

The control plane may store:

- tenant metadata
- domains
- deployment mode
- environments
- active modules
- product versions
- release status
- migration status without PII
- technical health without PII
- support cases without PII
- production readiness gates without PII
- billing and entitlements without citizen data

The control plane must not store:

- personal identity numbers
- names
- LSS decisions
- income records
- households
- bank accounts
- documents
- UBM payloads
- control case content
- case notes
- protected identity details

## Request flow

Frontend → backend API → authorization → data plane → audit/data access log → response.

Sensitive operations must go through backend and workers.

## Worker responsibilities

Workers handle:

- imports
- mappings
- validation
- data quality checks
- rule engine
- payment control
- reconciliation
- UBM export packages
- document redaction
- archive export
- exit export
- SIEM export
- anomaly detection

## Security model

- Entra ID / OIDC / SAML primary for production.
- Supabase Auth only for demo, local, fallback or approved pilot.
- RBAC + ABAC + need-to-know.
- RLS on sensitive tables.
- Sensitive reveal requires reason.
- Audit and data access logs for all sensitive access.
- Maker-checker for high-risk actions.
- Support mode without PII by default.
- Break-glass must be exceptional, time-limited and reviewed.
