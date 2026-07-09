# Backup- och återläsningsrunbook

Gäller varje kommuns egen dataplan (Modell B: leverantörsdriftad isolerad
Supabase/Postgres; Modell C: kommunägd). Kontrollplanet (utan personuppgifter)
har egen backup.

## Krav (obligatoriska go-live-grindar)

| Krav                                                         | Grind            | Verifiering                              |
| ------------------------------------------------------------ | ---------------- | ---------------------------------------- |
| Databas-backup konfigurerad (PITR eller daglig dump + WAL)   | `backup_tested`  | backupleverantörens status + provläsning |
| Dokumentlagring versionerad/replikerad (Supabase Storage/S3) | `backup_tested`  | bucketkonfiguration + provläsning        |
| Backuper krypterade i vila                                   | `backup_tested`  | leverantörsintyg/konfiguration           |
| Backupretention ≥ 30 dagar (PITR ≥ 7 dagar)                  | `backup_tested`  | konfiguration                            |
| Återläsningstest genomfört och dokumenterat                  | `restore_tested` | detta dokument, avsnittet nedan          |

`BACKUP_PROVIDER` måste vara satt i stage/prod — apparna vägrar starta utan
(fail closed, `loadAppConfig`).

## Backup

1. **Databas (Modell B)**: Supabase PITR aktiverat per projekt. Verifiera i
   projektinställningarna; notera senaste recovery-punkt.
2. **Databas (Modell C)**: kommunens standard (pgBackRest/managed Postgres).
   Krav: daglig full + WAL-arkivering, kryptering, separat lagringskonto.
3. **Dokumentlagring**: bucketversionering + replikering enligt kommunens krav.
4. **Kontrollplan**: samma krav som databasen; innehåller inga personuppgifter.

## Återläsningstest (checklista — bevis till grinden `restore_tested`)

1. Skapa en tom måldatabas (aldrig produktionsdatabasen).
2. Återläs senaste backup/PITR-punkt till måldatabasen.
3. Kör `pnpm db:smoke-test -- --db <måldatabas>` — 15/15 ska passera.
4. Kör `pnpm db:rls-test -- --db <måldatabas>` — 17/17 ska passera.
5. Verifiera beviskedjan: `GET /audit/verify-chain` mot en API-instans pekad mot
   måldatabasen ska ge `valid: true`.
6. Dokumentera: datum, vem, backupens tidpunkt, tidsåtgång (RTO-mätning),
   eventuella avvikelser.
7. Registrera bevis: `PUT /onboarding/gates/restore_tested`
   med status `passed`, evidenceKind `test_run` och referens till protokollet.
8. Radera måldatabasen.

Frekvens: före pilotstart, före go-live och därefter minst halvårsvis
(SLA-bilagan kan kräva tätare).

## Roller

- Modell B: leverantören utför, kommunen godkänner protokollet.
- Modell C: kommunen utför, leverantören stödjer.
