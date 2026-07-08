# DPIA — mall för UBM Klar (per kommun)

Konsekvensbedömning enligt GDPR art. 35. Fylls i av kommunen med stöd av leverantören
innan produktionssättning (produktionsgrind `dpia_completed`).

## 1. Beskrivning av behandlingen

- System: UBM Klar, driftmodell: [Modell B / C1 / C2 / C3]
- Ändamål: strukturera, kvalitetssäkra, kontrollera och förbereda uppgifter inför
  UBM-processer; betalningskontroll; ärendestöd LSS/ekonomiskt bistånd.
- Kategorier av registrerade: sökande/brukare, hushållsmedlemmar (inkl. barn),
  assistenter, företrädare.
- Särskilda kategorier: hälsouppgifter (LSS-behovsbedömningar, intyg); skyddad identitet.

## 2. Nödvändighet och proportionalitet

- Uppgiftsskyldighet enligt lag (2023:456) från 2026-07-01 (fas 1) och 2029-07-01 (fas 2).
- Dataminimering: behörighetsmotorn (27 kontrollfrågor) blockerar icke-nödvändiga
  uppgifter; dokumentreferenser före dokument; maskning före export.

## 3. Risker och åtgärder

| Risk | Åtgärd i UBM Klar |
| --- | --- |
| Obehörig intern åtkomst (nyfikenhet) | Behovsprövad åtkomst, ärendekoppling, skälkrav, nyfikenhetsdetektering, DPO-rapport |
| Skyddad identitet röjs | Förhöjd behörighet + skäl + kritisk flagga vid saknat skydd; AI får aldrig behandla |
| Felaktig UBM-export | Behörighetsmotor, juridisk/DPO-granskning, maker-checker, hash + kvittens |
| Sammanblandning av kommuner | Isolerad dataplan per kommun (ingen delad produktion) |
| Leverantörsåtkomst | Support utan PII, JIT-godkännande, tidsgräns, loggning |
| Dataförlust | Backup per kommun, återläsningstest, exitexport |

## 4. Slutsats och godkännande

- Bedömning: [ ] Behandlingen kan genomföras med angivna åtgärder
- DPO-yttrande: ______  Datum: ______
- Beslut (personuppgiftsansvarig): ______  Datum: ______
