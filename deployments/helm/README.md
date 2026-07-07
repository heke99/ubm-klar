# Helm deployment (Model C2/C3 self-hosted)

Charts for self-hosted deployments (api, worker, web) are published with each release.
Values are per-municipality; a chart instance serves exactly one municipality.

Required values:

- `tenant.slug`, `tenant.environment`
- `dataPlane.postgresSecretRef` (municipality-managed secret)
- `storage.provider` + credentials secret ref
- `sso.issuerUrl`, `sso.metadataUrl`
- `siem.endpointSecretRef` (optional)

No shared multi-tenant install is supported for production.
