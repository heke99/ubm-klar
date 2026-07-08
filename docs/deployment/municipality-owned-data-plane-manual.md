# Manual: kommunägd dataplan (Modell C)

Steg-för-steg för kommuner som kör UBM Klar på egen infrastruktur.

## Förutsättningar

- PostgreSQL 15+ (C3) eller Supabase-projekt/instans (C1/C2)
- Objektlagring för dokument (S3-kompatibel, Azure Blob eller filserver)
- Entra ID/annan IdP för SSO med MFA
- Node.js 22+ för api/worker/web (eller container-drift via Helm)

## Installation

1. Verifiera releasepaketet: `node scripts/release-runner.mjs preflight --release <v>`
   (kontrollsummor + signatur).
2. Skapa databasen och kör migreringarna:
   `node scripts/release-runner.mjs dry-run --release <v> --db <url>` följt av
   `node scripts/release-runner.mjs apply --release <v> --db <url>`.
3. Kör smoke-tester: `node scripts/release-runner.mjs smoke-test --release <v> --db <url>`.
4. Konfigurera lagringsbuckets enligt dokumentvalvets policyer (nio buckets; publik
   åtkomst är förbjuden).
5. Registrera er domän (t.ex. `ubm-klar.<kommun>.se`) hos leverantörens kontrollplan
   (endast metadata) och verifiera med DNS TXT.
6. Konfigurera SSO (issuer/metadata-URL), testa inloggning + MFA + gruppmappning.
7. Sätt miljövariabler: `DATABASE_URL`, `DATA_PLANE_SERVICE_KEY__<SLUG>__<ENV>`
   (i kommunens hemlighetshantering), `SIEM_EXPORT_ENDPOINT` (valfritt).
8. Genomför onboarding-programmet (8 steg) och produktionsgrindarna innan go-live.

## Drift

- Uppdateringar: nya releasepaket verifieras och appliceras av kommunen (leverantören
  assisterar i no-PII-läge).
- Backup/återläsning: kommunens rutiner; återläsningstest minst årligen (grind).
- Support: JIT-åtkomst godkänns av kommunen per ärende, alltid utan personuppgifter.

## Kommunens ägarskap

Databasen, dokumentlagringen, nycklarna, revisionsloggarna, backuperna och alla
UBM-exportpaket ägs och kontrolleras av kommunen. Leverantören ser endast teknisk
status utan personuppgifter.
