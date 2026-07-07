# Exitbilaga

## Exitexportens innehåll (13 datamängder)

structured_data, documents, document_metadata, audit_logs, data_access_logs,
ubm_exports_receipts, control_cases, rule_configs, import_history, mappings,
source_record_links, data_lineage, evidence_chain.

## Format

- Strukturerad data: JSON Lines per tabell med schemabeskrivning
- Dokument: originalfiler + metadata (hash, klassning, ärendekoppling)
- Manifest med kontrollsumma per fil och för hela paketet (verifierbart med
  `verifyExitExport`)

## Process

1. Kommunen begär exit; exitexport kräver maker-checker-godkännande.
2. Leverantören producerar paketet till bucketen `exit-exports` (eller kommunens
   angivna mål för Modell C).
3. Kommunen verifierar manifest och kontrollsummor; eventuella avvikelser åtgärdas.
4. Efter skriftlig bekräftelse raderar leverantören samtliga kopior (Modell B) och
   intygar radering. Kontrollplanens metadata anonymiseras till statistik.
5. Exit-exporttest är en produktionsgrind (`exit_export_tested`) — förmågan verifieras
   före go-live, inte först vid exit.

## Tidsramar

Exitexport levereras senast 30 dagar efter begäran; passiv läsbehörighet kan avtalas
under en övergångsperiod.
