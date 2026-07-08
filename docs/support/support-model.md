# Supportmodell utan personuppgifter

## Vad support ser

Version, hälsostatus, importstatus (batchnivå), felkoder, köstatus, schemafel, senaste
migrering, API-status, tekniska loggar utan PII, integrationsstatus utan PII,
backupstatus utan innehåll, återläsningstestatus.

## Vad support aldrig ser

Personnummer, namn, hushåll, inkomster, LSS-beslut, dokument, bankkonton,
UBM-exportinnehåll, kontrollärendens innehåll, ärendeanteckningar, medicinska uppgifter,
uppgifter om skyddad identitet.

Tekniskt upprätthålls detta av: no-PII-roller som är strukturellt spärrade från
PII-behörigheter, `pii_access = false`-CHECK i supportsessionstabellen, no-PII-scanning
av allt som lämnar dataplanen och RLS-spärr för no-PII-sessioner.

## Eskalerad åtkomst (JIT)

1. Kommunen skapar supportärende (utan PII) i kontrollplanen.
2. Kommunen godkänner JIT-åtkomst (självgodkännande är tekniskt omöjligt).
3. Maker-checker där kommunen konfigurerat det.
4. Åtkomsten är tidsbegränsad (max 8 h), scopad till ett område och kräver skäl.
5. Allt loggas append-only; sessionen upphör automatiskt.
6. Kommunen kan exportera hela supportloggen.
