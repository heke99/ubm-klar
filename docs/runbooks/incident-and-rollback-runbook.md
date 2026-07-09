# Runbook: incidenter och rollback

Operativ handbok för drift under kundpilot. Processen och rapporteringskraven
(IMY 72h, NIS2 24h/72h) finns i `docs/incident-response/incident-process.md` —
detta dokument är de konkreta handgreppen.

## Snabbdiagnos

| Symptom                             | Första kontroll                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| Webben svarar inte                  | `GET /health` på web; `GET /ready` på api                                          |
| 421 för kommunens domän             | domänverifiering i kontrollplanet (`GET /tenants/:id`); directory-token på API     |
| 401 vid inloggning                  | `AUTH_ISSUER`/`AUTH_CLIENT_ID`; IdP-metadata; klockskev; `SESSION_SECRET` roterad? |
| 503 `audit_unavailable`             | dataplanens `DATA_PLANE_DATABASE_URL__{SLUG}__{ENV}` saknas eller databasen nere   |
| Jobb fastnar                        | worker `GET /health` (ködjup, dead letter, senaste fel); `/installningar/jobb`     |
| Röd manipulationsvarning i Revision | eskalera OMEDELBART som kritisk incident — rör inte loggtabellerna                 |

Alla API-fel bär ett correlation id (`x-correlation-id`) som kan sökas i de
tekniska loggarna (inga personuppgifter loggas där).

## Innesluta

1. **Stoppa trafik till en tenant** (påverkar inte andra kommuner):
   sätt tenantstatus `suspended` eller ta bort domänverifieringen i
   kontrollplanet — resolvern failar closed med 421 inom TTL:en.
2. **Stäng av en funktion**: funktionsflaggor per tenant
   (`PUT /tenants/:id/feature-flags`).
3. **Stoppa bakgrundsjobb**: stoppa worker-processen (kön är beständig i
   Postgres; inga jobb tappas, de återupptas vid start).
4. **Misstänkt läckt hemlighet**: rotera omedelbart (`SESSION_SECRET`,
   `CONTROL_PLANE_ADMIN_TOKEN`, `CONTROL_PLANE_DIRECTORY_TOKEN`,
   dataplans-URL:ens lösenord) och starta om tjänsterna. Sessioner blir
   ogiltiga när `SESSION_SECRET` roteras — det är avsikten.

## Release-rollback

Migrationerna är expand-only (preflight blockerar destruktiv SQL), så en
felaktig release rullas tillbaka i två steg:

1. **Kod**: driftsätt föregående release-artefakt för api/worker/web/kontrollplan.
   Äldre kod fungerar mot det nyare schemat (expand-only-garantin).
2. **Data (endast vid datakorruption)**: PITR-återställning av dataplanen enligt
   `releases/1.0.0/rollback-plan.md` och `docs/runbooks/backup-restore-runbook.md`.
   Efter återställning: `pnpm db:smoke-test` + `pnpm db:rls-test` +
   `GET /audit/verify-chain` innan trafiken släpps på.

Ledgern (`schema_migrations`-tabellen via release-runnern) visar exakt vilka
migrationer som är applicerade per dataplan.

## Återstart efter incident

1. `GET /ready` grönt på kontrollplan, api och worker; `GET /health` på web.
2. Smoke- och RLS-tester mot berörd dataplan.
3. Evidenskedjan verifierad (`/revision` eller `GET /audit/verify-chain`).
4. Incidentens tidslinje komplett i `security_incidents` (utan personuppgifter).
5. Post mortem inom 5 arbetsdagar; åtgärder in i cyberriskregistret;
   eventuella break-glass-sessioner efterhandsgranskas.
