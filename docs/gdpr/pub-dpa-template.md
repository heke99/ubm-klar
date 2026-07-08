# Personuppgiftsbiträdesavtal (PUB/DPA) — mall

Gäller Modell B (leverantörsdriftad isolerad dataplan). För Modell C är kommunen både
ansvarig och driftansvarig; leverantören behandlar då inga produktionspersonuppgifter.

## Parter och roller

- Personuppgiftsansvarig: [Kommunen]
- Personuppgiftsbiträde: [Leverantören av UBM Klar]

## Instruktioner

Biträdet behandlar personuppgifter endast för att tillhandahålla UBM Klar enligt
dokumenterade instruktioner: drift av kommunens isolerade dataplan, säkerhetskopiering,
felavhjälpning i no-PII-läge, samt JIT-support efter kommunens godkännande.

## Tekniska och organisatoriska åtgärder

- Isolerad dataplan per kommun (separat databas, lagring, nycklar, backup)
- RLS, maskning som standard, skälkrav för känsliga fält
- Append-only revisions- och åtkomstloggar med hashkedjor
- Support utan personuppgifter; JIT-åtkomst tidsbegränsad, godkänd av kommunen, loggad
- Ingen PII i leverantörens kontrollplan, telemetri, supportpaket eller AI-prompter
- Incidentrapportering utan onödigt dröjsmål (mål < 24 h efter upptäckt)

## Underbiträden

Se `docs/gdpr/subprocessors.md`. Nya underbiträden förhandsmeddelas med invändningsrätt.

## Radering och exit

Vid avtalets upphörande levereras fullständig exitexport (13 datamängder med manifest och
kontrollsummor) varefter biträdets kopior raderas och raderingen intygas skriftligen.
