# Runbook: kundpilot go-live

Mål: en kontrollerad kundpilot enligt pilotgrindarna. Piloten är INTE ett
produktionsgodkännande; produktions-go-live har egna grindar.

## Förutsättningar

- Release 1.0.0 med preflight PASS (`pnpm db:migrate:preflight`).
- I stage/prod: signerad release (`release-runner verify-signature` med
  `RELEASE_SIGNING_PUBLIC_KEY`), annars vägrar preflight.
- Miljövariabler enligt `.env.example`, sektionen STAGE/PROD — apparna vägrar
  starta med ofullständig eller osäker konfiguration.

## Steg

1. **Kontrollplan**: starta med `CONTROL_PLANE_DATABASE_URL` +
   `CONTROL_PLANE_ADMIN_TOKEN` (+ `CONTROL_PLANE_DIRECTORY_TOKEN`).
   Migrationsschemat appliceras automatiskt. Verifiera `GET /ready`.
2. **Tenant**: `POST /tenants` (slug, kommunnamn, org.nr, driftmodell).
3. **Domän**: `POST /tenants/:id/domains` + `POST .../verify` efter
   DNS-/ägarskapskontroll. Overifierade domäner är osynliga för resolvern.
4. **Dataplan**: kör releasen mot kommunens databas
   (`release-runner dry-run` -> `apply` -> `smoke-test` -> `rls-test`).
   Sätt `DATA_PLANE_DATABASE_URL__{SLUG}__{ENV}` på API/worker.
5. **API/worker/web**: starta med full stage/prod-konfiguration. Verifiera
   `/ready` på api, worker och kontrollplan samt `/health` på web.
6. **Inloggning**: konfigurera Entra ID/OIDC (issuer, client id/secret) eller
   fatta dokumenterat beslut om pilotinloggning. Verifiera login/logout.
7. **Roller**: mappa IdP-grupper till roller under Inställningar -> Användare.
8. **Pilotgrindar**: gå igenom checklistan under /onboarding. Obligatoriska
   grindar kan endast förbigås med dokumenterad dispens (skäl, godkännare,
   giltighetstid, risknivå — allt loggas).
9. **Övningar** (grindbevis): provimport (dry-run + commit av avgränsad fil),
   UBM-övningsförfrågan hela vägen till paket + kvittens, exportövning med
   fyra-ögon-godkännande, verifiering av revisions- och dataåtkomstloggar
   (`GET /audit/verify-chain`).
10. **Pilotgodkännande**: `PUT /tenants/:id/approvals` med kind `pilot`,
    godkännare och skäl. Tenantstatus blir `pilot` och pilotbannern visas.

## Avbrytande/rollback

- Stoppa trafik: ta bort domänverifieringen (`verified=false` ->
  resolvern failar closed med 421) eller sätt tenantstatus `suspended`.
- Data: piloten kan avslutas med exit-export + radering enligt pilotavtalet.
- Release-rollback: `releases/1.0.0/rollback-plan.md` (PITR-återställning;
  migrationer är icke-destruktiva expand-only).
- Funktionsbrytare: funktionsflaggor per tenant i kontrollplanet
  (`PUT /tenants/:id/feature-flags`).

## Incidenter

Se `docs/incident-response/incident-process.md`. Kontaktvägar och eskalering
fastställs i pilotgrinden `incident_contact_runbook`.
