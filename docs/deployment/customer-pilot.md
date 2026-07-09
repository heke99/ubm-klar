# Kundpilot — driftsättningsguide

Denna guide tar en kommun från noll till godkänd kundpilot. Piloten är en
kontrollerad utvärdering — INTE ett produktionsgodkännande. Se även
`docs/runbooks/customer-pilot-go-live.md` (steg-för-steg) och `/pilot` i
produkten (begränsningar).

## Arkitektur i piloten

| Tjänst               | Roll                                                 | Hälsa               |
| -------------------- | ---------------------------------------------------- | ------------------- |
| `apps/control-plane` | tenantregister utan personuppgifter (Postgres)       | `/health`, `/ready` |
| `apps/api`           | all affärslogik, tenantupplösning, behörighet, audit | `/health`, `/ready` |
| `apps/worker`        | beständig jobbkö (Postgres), regelkörningar          | `/health`, `/ready` |
| `apps/web`           | Next.js-gränssnitt, inloggning, sessioner            | `/health`           |
| Dataplan             | kommunens EGEN Postgres/Supabase (Modell B eller C)  | release-smoketester |

Varje kommun har en isolerad dataplan. Kontrollplanet innehåller aldrig
personuppgifter (PII-skanning vid API-gränsen och i lagringslagret).

## Miljökonfiguration

Alla variabler dokumenteras i `.env.example`. I stage/prod vägrar tjänsterna
starta med ofullständig eller osäker konfiguration (`loadAppConfig`), bland
annat: demo-läge, in-memory-lagring, avstängd virusskanning, osignerade
releaser, header-auth utan betrodd proxy och saknad backupkonfiguration.

Minsta stage/prod-uppsättning:

- `APP_ENV`, `APP_BASE_URL`, `API_BASE_URL`
- `CONTROL_PLANE_DATABASE_URL`, `CONTROL_PLANE_URL`,
  `CONTROL_PLANE_ADMIN_TOKEN`, `CONTROL_PLANE_DIRECTORY_TOKEN`
- `DATA_PLANE_DATABASE_URL__{SLUG}__{ENV}` (API/worker, per kommun)
- `DATA_PLANE_PUBLISHABLE_KEY__{SLUG}__{ENV}` (om Supabase-klient används)
- `AUTH_PROVIDER=entra_id`, `AUTH_ISSUER`, `AUTH_CLIENT_ID`,
  `AUTH_CLIENT_SECRET`, `SESSION_SECRET`
- `DATA_PLANE_SERVICE_KEY_SOURCE=env`
- `DOCUMENT_STORAGE_PROVIDER=supabase|s3` + provider-variabler
- `MALWARE_SCANNER_PROVIDER=clamav|external-api` + provider-variabler
- `AUDIT_SINK=postgres`, `DATA_ACCESS_SINK=postgres`
- `QUEUE_PROVIDER=postgres`, `WORKER_QUEUE_URL`
- `RELEASE_SIGNING_PUBLIC_KEY`, `BACKUP_PROVIDER`

## Releaser och migrationer

```bash
pnpm db:migrate:preflight                      # manifest + checksummor + signaturpolicy
node scripts/release-runner.mjs dry-run  --release 1.0.0 --db <dataplan>
node scripts/release-runner.mjs apply    --release 1.0.0 --db <dataplan>
pnpm db:smoke-test -- --db <dataplan>          # 15 tester (inkl. RLS-täckning)
pnpm db:rls-test   -- --db <dataplan>          # 17 RLS-tester
```

I stage/prod kräver preflight en signerad release
(`release-runner sign` i release-pipelinen, verifiering med
`RELEASE_SIGNING_PUBLIC_KEY`). Osignerat = vägran (fail closed).

## Tenant-setup (kontrollplanet)

1. `POST /tenants` — slug, kommunnamn, org.nr, driftmodell.
2. `POST /tenants/:id/domains` + `POST .../:domainId/verify` (overifierade
   domäner ger 421 i API/webb).
3. `PUT /tenants/:id/environments` — dataplanens URL + publik nyckelreferens.
4. `PUT /tenants/:id/modules` — aktivera moduler.
5. `PUT /tenants/:id/auth-providers` — Entra ID/OIDC-metadata (aldrig secrets).
6. Pilotgodkännande: `PUT /tenants/:id/approvals` (kind `pilot`, godkännare,
   skäl) — sätter tenantstatus `pilot` och tänder pilotbannern.

## Pilotens obligatoriska grindar

Följs under `/onboarding` i produkten (pilot- och produktionsgrindar separat).
Obligatoriska grindar kan endast förbigås med dokumenterad dispens (skäl,
godkännare, giltighetstid, risknivå) — allt loggas. Utgångna dispenser slutar
gälla automatiskt.

## Vad piloten INTE innehåller

- Officiell UBM-transport (går inte att aktivera någonstans i systemet).
- Återkommande rapportering 2029 (funktionsflaggad av; blockerad för
  pilottenants i kontrollplanet).
- Automatiska intag (API/e-post) — endast manuell registrering/filuppladdning.
- Systemspecifika källsystemsadaptrar (Procapita/Treserva m.fl. är markerade
  "ej tillgängliga" — använd generisk CSV/XLSX).
- Automatisk maskning av annat än textdokument (övriga format maskas manuellt).
- PDF-export av rapporter (CSV/XLSX/JSON finns).

## Demodata

`pnpm demo:pilot-seed -- --db <demoplan>` seedar ett tydligt syntetiskt
dataset (personnummer månad 90+, `is_synthetic`, `DEMO-`-prefix). Vägrar
produktion, kräver `--confirm-stage` i stage, vägrar dataplaner med riktiga
personer och kan återställas helt med `--reset`.

## Support under piloten

Se `/stod` i produkten och `docs/support/`. Leverantörssupport ser aldrig
personuppgifter; utökad åtkomst kräver kommungodkänd JIT-session och loggas.
