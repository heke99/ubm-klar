# SLA-bilaga (mall)

| Parameter | Bas | Utökad | Enterprise |
| --- | --- | --- | --- |
| Tillgänglighet (prod, Modell B) | 99,5 % | 99,7 % | 99,9 % |
| Servicefönster | Vardagar 22–06 | Föranmält | Föranmält, tenant-vis |
| Svarstid kritisk incident | 4 h | 1 h | 30 min |
| Svarstid hög | 8 h | 4 h | 2 h |
| Svarstid normal | 2 arbetsdagar | 1 arbetsdag | 4 h |
| RPO | 24 h | 4 h | 1 h |
| RTO | 24 h | 8 h | 4 h |
| Återläsningstest | Årligen | Halvår | Kvartal |
| Supportkanal | Portal | Portal + telefon | Dedikerad kontakt |

Anmärkningar:

- All support sker i no-PII-läge; PII-nära felsökning kräver kommunens JIT-godkännande.
- Underhåll som kräver migrering följer release-processen (preflight, dry-run, backup,
  smoke-test, rollback-plan) per kommun och miljö.
- Viten och mätmetod definieras i huvudavtalet.
