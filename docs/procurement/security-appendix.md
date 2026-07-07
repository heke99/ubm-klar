# Säkerhetsbilaga (upphandling)

## Arkitektur

- Isolerad dataplan per kommun: egen databas, egen lagring, egna nycklar, egna backuper,
  egna API-nycklar, egen auth-konfiguration. Delad databas förekommer aldrig i produktion.
- Strikt domänupplösning: okända domäner avvisas (fail-closed); myndighetsliknande
  domäner är tekniskt förbjudna.
- Radnivåsäkerhet (RLS) på alla känsliga tabeller; deny-by-default.

## Åtkomstkontroll

- SSO via kommunens Entra ID/SAML/OIDC; MFA hos kommunen; Supabase Auth endast som
  reservläge (demo/test/break-glass).
- RBAC + ABAC + behovsprövning (inre sekretess): ärendekoppling, förvaltningstillhörighet,
  dataklass, skyddad identitet, syfte och skäl.
- Maskning som standard; skälkrav och loggning för känsliga fält.
- Maker-checker för exporter, mottagarändringar, betalstopp, gallring, exit och go-live —
  skaparen kan aldrig ensam godkänna (även DB-trigger).

## Loggning och spårbarhet

- Append-only revisionslogg med hashkedja (manipulering upptäcks).
- Dataåtkomstlogg med skäl; nyfikenhetsdetektering med DPO-rapport.
- Beviskedja med kontrollsummor för kontrollärenden och UBM-exporter.

## Leverantörsåtkomst

- Support utan personuppgifter; JIT-åtkomst kräver kommunens godkännande, är
  tidsbegränsad (max 8 h), scopad och loggad. Break-glass max 4 h med efterhandsgranskning.

## Sårbarhets- och incidenthantering

- NIS2-anpassad incidentprocess (24 h/72 h), incidenttidslinje utan PII, SIEM-export av
  tekniska händelser, kontinuitetsplaner med RTO/RPO och övningar.
