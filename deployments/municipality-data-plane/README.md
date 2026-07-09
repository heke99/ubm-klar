# Model C — Municipality-owned data plane

The municipality owns production data, storage, keys, audit logs, backups and UBM export
packages. The vendor delivers code, release packages, SQL migrations, rule templates,
UBM schema versions, support and updates.

## Variants

| Variant | Data plane                                  | Storage                                                 | Operated by                    |
| ------- | ------------------------------------------- | ------------------------------------------------------- | ------------------------------ |
| C1      | Municipality-owned managed Supabase project | Supabase Storage (municipality account)                 | Municipality (vendor supports) |
| C2      | Self-hosted Supabase                        | Self-hosted storage                                     | Municipality                   |
| C3      | Plain Postgres                              | Separate storage (S3/Azure/file share) + vendor backend | Municipality                   |

## Deployment

1. Municipality provisions Postgres 15+ (and storage per variant) inside its own
   perimeter, owns encryption keys/key references and backups.
2. Vendor delivers the release package (`releases/<version>/`): migration manifest,
   checksums, signature, rollback plan, smoke tests.
3. Municipality verifies checksums (`node scripts/release-runner.mjs preflight`) and
   applies migrations with its own credentials. Vendor never holds production secrets.
4. App domain is a municipality-owned subdomain (e.g. `ubm-klar.malmo.se`), registered
   and verified in the control plane (metadata only).
5. SSO via the municipality's Entra ID/ADFS; MFA enforced by the municipality.
6. SIEM export goes to the municipality's SIEM; support runs in no-PII mode with JIT
   approval by the municipality.

## Vendor boundary

The vendor control plane stores tenant metadata, license/entitlement status, release
status and no-PII health/support data — never citizen data, decisions, documents,
payloads or logs containing personal data.
