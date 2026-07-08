# Ansvarsmatris per driftmodell

| Ansvar | Modell B (leverantörsdriftad isolerad) | C1 (kommunägd managed Supabase) | C2 (self-hosted Supabase) | C3 (Postgres + separat lagring) |
| --- | --- | --- | --- | --- |
| Produktionsdata | Kommunen (ansvarig), leverantören biträde | Kommunen | Kommunen | Kommunen |
| Databasdrift | Leverantören | Kommunen (managed) | Kommunen | Kommunen |
| Lagring/dokument | Leverantören (kommunens buckets) | Kommunen | Kommunen | Kommunen |
| Krypteringsnycklar | Leverantören (nyckelreferenser) | Kommunen | Kommunen | Kommunen |
| Backuper | Leverantören (per kommun) | Kommunen | Kommunen | Kommunen |
| Återläsningstest | Leverantören + kommunen godkänner | Kommunen | Kommunen | Kommunen |
| SSO/IdP och MFA | Kommunen | Kommunen | Kommunen | Kommunen |
| Applikationsuppdateringar | Leverantören | Leverantören levererar, kommunen applicerar | Samma | Samma |
| SQL-migreringar | Leverantören (runner) | Kommunen kör signerade paket | Samma | Samma |
| Revisionsloggar | I kommunens dataplan | Kommunen | Kommunen | Kommunen |
| UBM-exportpaket | I kommunens dataplan | Kommunen | Kommunen | Kommunen |
| SIEM | Kommunens SIEM (export) | Kommunen | Kommunen | Kommunen |
| Support | No-PII, JIT efter godkännande | Samma | Samma | Samma |
| Incidenthantering | Delad enligt incidentprocess | Kommunen leder, leverantören stödjer | Samma | Samma |
| Exit | Leverantören levererar exitexport | Kommunen äger redan datat | Samma | Samma |

Gemensamt för alla modeller: leverantörens kontrollplan innehåller aldrig
personuppgifter; fakturering innehåller aldrig medborgardata.
