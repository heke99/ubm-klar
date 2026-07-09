# Security checklist (per release / per tenant go-live)

## Service-role and secrets

- [ ] No service-role keys in frontend bundles (`createServiceConnection` throws in
      browser contexts; verified by tests)
- [ ] One service key per tenant per environment (`DATA_PLANE_SERVICE_KEY__<SLUG>__<ENV>`);
      no shared keys across municipalities
- [ ] Control plane stores key _references_ only (400 on `service_role|secret` references)
- [ ] `pnpm security:secrets` clean; `pnpm security:deps` reviewed

## Tenant isolation

- [ ] Tenant resolver fails closed (unknown/forbidden/unverified domains rejected — tests)
- [ ] Cross-tenant leakage test green (directory mismatch → `TenantConfigLeakError`)
- [ ] Production deployment mode is Model B or C (shared demo mode cannot be provisioned
      to prod — enforced in provisioning and by the `no_shared_prod` DB constraint)

## RLS and access control

- [ ] All 31 data-plane migrations applied; RLS enabled on all sensitive tables
      (release smoke test)
- [ ] `scripts/rls-tests.mjs` green: anonymous/no-PII/support sessions blocked, protected
      identity requires elevated role, case worker cannot write payments
- [ ] No-PII roles structurally barred from PII permissions (authorize() double-check)
- [ ] Maker-checker DB trigger active (`approval_steps_maker_checker` smoke test)

## Logs and telemetry

- [ ] Audit chain verification green (`verifyChain`)
- [ ] Everything leaving the data plane passes `sanitizeTechnicalLogEvent`/`assertNoPii`
- [ ] Support bundles contain no PII (bucket `support-bundles-no-pii` policy)

## AI

- [ ] AI disabled by default; PII in prompts impossible without approved provider
      (DB CHECK + guardrail tests)

## Operational

- [ ] Backup verified before prod migration (`BACKUP_VERIFIED=true` gate)
- [ ] Restore test recorded; SIEM export tested where enabled
- [ ] Production readiness gates all passed (`production_go_live_status.go_live_allowed`)
