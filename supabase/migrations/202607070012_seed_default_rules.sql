-- ============================================================================
-- 202607070012_seed_default_rules.sql
-- Seeds the default risk rule catalogue (definitions only, no data).
-- Mirrors @ubm-klar/lss-domain ALL_LSS_RULES and
-- @ubm-klar/economic-assistance-domain ALL_EA_RULES, version 1.0.0.
-- ============================================================================

insert into risk_rule_definitions
  (rule_key, version, domain, title, description, severity, recommended_action, status, legal_source_key, legal_source_version)
values
  -- LSS rules (25)
  ('lss_payment_after_decision_end','1.0.0','lss','Utbetalning efter beslutets slutdatum','Utbetalning efter beslutsperiodens slut.','high','Utred och initiera återkrav vid behov.','active','lss_1993_387','2026-07-01'),
  ('lss_payment_before_decision_start','1.0.0','lss','Utbetalning före beslutets startdatum','Utbetalning innan beslutsperioden börjat.','high','Kontrollera beslutskopplingen.','active','lss_1993_387','2026-07-01'),
  ('lss_billed_hours_exceed_decision','1.0.0','lss','Fakturerade timmar överstiger beslutade','Fakturans timmar överstiger beslutet.','high','Begär rättelse och håll inne betalning.','active','lss_1993_387','2026-07-01'),
  ('lss_time_report_missing_for_invoice','1.0.0','lss','Tidrapport saknas för fakturerad period','Fakturerad period saknar tidrapport.','high','Begär tidrapport före godkännande.','active','lss_1993_387','2026-07-01'),
  ('lss_invoice_without_approved_provider','1.0.0','lss','Faktura saknar godkänd utförare','Utföraren är inte aktiv/godkänd.','critical','Stoppa betalning.','active','lss_1993_387','2026-07-01'),
  ('lss_provider_without_ivo_permit','1.0.0','lss','Utförare saknar aktivt IVO-tillstånd','Fakturering utan giltigt tillstånd.','critical','Stoppa betalningar, kontrollera mot IVO.','active','lss_1993_387','2026-07-01'),
  ('lss_invoice_org_number_mismatch','1.0.0','lss','Fakturans orgnr avviker från avtal','Organisationsnummer matchar inte avtalet.','critical','Stoppa betalning och utred.','active','lss_1993_387','2026-07-01'),
  ('lss_assistant_overlapping_time','1.0.0','lss','Assistent har överlappande tid','Överlappande arbetspass för samma assistent.','high','Begär rättelse av tidrapporter.','active','lss_1993_387','2026-07-01'),
  ('lss_assistant_unreasonable_hours','1.0.0','lss','Assistent rapporterar orimliga timmar','Mer än 16 timmar per dygn.','high','Kontrollera mot schema.','active','lss_1993_387','2026-07-01'),
  ('lss_duplicate_invoice','1.0.0','lss','Dubblettfaktura','Samma person och period faktureras två gånger.','high','Avvisa dubbletten.','active','lss_1993_387','2026-07-01'),
  ('lss_duplicate_payment','1.0.0','lss','Dubblettutbetalning','Samma person, belopp och datum.','critical','Stoppa/återkräv dubbletten.','active','lss_1993_387','2026-07-01'),
  ('lss_payment_despite_recovery_claim','1.0.0','lss','Utbetalning trots aktivt återkrav','Ny utbetalning med öppet återkrav.','high','Kontrollera kvittning.','active','lss_1993_387','2026-07-01'),
  ('lss_account_changed_near_payment','1.0.0','lss','Konto ändrat nära utbetalning','Kontobyte kort före utbetalning.','high','Verifiera kontobytet.','active','lss_1993_387','2026-07-01'),
  ('lss_protected_identity_without_elevated_protection','1.0.0','lss','Skyddad identitet utan förhöjt skydd','Åtkomstskydd saknas.','critical','Aktivera skydd omedelbart.','active','osl_2009_400','2026-07-01'),
  ('lss_medical_document_misclassified','1.0.0','lss','Medicinskt dokument felklassat','Medicinskt dokument utan medicinsk klassning.','high','Omklassificera och granska åtkomst.','active','osl_2009_400','2026-07-01'),
  ('lss_invoice_without_decision_link','1.0.0','lss','Faktura saknar beslutskoppling','Ingen beslutslänk.','high','Koppla till rätt beslut.','active','lss_1993_387','2026-07-01'),
  ('lss_payment_recipient_differs_from_provider','1.0.0','lss','Mottagare avviker från avtalad utförare','Fel mottagare.','critical','Stoppa och verifiera.','active','lss_1993_387','2026-07-01'),
  ('lss_ended_decision_still_invoiced','1.0.0','lss','Avslutat beslut faktureras','Fakturering efter beslutets slut.','high','Avvisa fakturan.','active','lss_1993_387','2026-07-01'),
  ('lss_time_report_without_approval','1.0.0','lss','Tidrapport saknar godkännande','Ogodkänd tidrapport som underlag.','medium','Begär godkännande.','active','lss_1993_387','2026-07-01'),
  ('lss_unusual_hours_increase','1.0.0','lss','Ovanlig ökning av timmar','>50% ökning mellan perioder.','medium','Kontrollera motiveringen.','active','lss_1993_387','2026-07-01'),
  ('lss_payment_file_unknown_recipient','1.0.0','lss','Okänd mottagare i betalningsfil','Mottagare matchar ingen godkänd utförare.','critical','Stoppa filen och utred.','active','lss_1993_387','2026-07-01'),
  ('lss_paid_without_approved_invoice','1.0.0','lss','Utbetald utan godkänd faktura','Betald utan fakturagodkännande.','critical','Utred och återkräv vid behov.','active','lss_1993_387','2026-07-01'),
  ('lss_recovery_claim_recipient_in_batch','1.0.0','lss','Återkravsmottagare i betalningsbatch','Mottagare med återkrav kvar i batch.','high','Ta bort eller dokumentera kvittning.','active','lss_1993_387','2026-07-01'),
  ('lss_provider_flag_without_review','1.0.0','lss','Utförarflagga utan granskning','Riskflaggor saknar manuell granskning.','medium','Genomför granskning.','active','lss_1993_387','2026-07-01'),
  ('lss_sensitive_document_access_without_reason','1.0.0','lss','Känsligt dokument utan skäl','Åtkomst utan registrerat skäl.','high','Granska enligt inre sekretess.','active','osl_2009_400','2026-07-01'),
  -- Economic assistance rules (25)
  ('ea_payment_without_decision','1.0.0','economic_assistance','Utbetalning saknar beslut','Ingen beslutskoppling.','critical','Stoppa och utred.','active','sol_2001_453','2026-07-01'),
  ('ea_payment_exceeds_approved_amount','1.0.0','economic_assistance','Utbetalning över beviljat belopp','Beloppet överstiger beslutet.','high','Utred mellanskillnaden.','active','sol_2001_453','2026-07-01'),
  ('ea_payment_after_decision_validity','1.0.0','economic_assistance','Utbetalning efter giltighetstid','Utbetalning efter beslutets slut.','high','Utred och återkräv vid behov.','active','sol_2001_453','2026-07-01'),
  ('ea_duplicate_payment_household_period','1.0.0','economic_assistance','Dubblettutbetalning','Samma hushåll, belopp och period.','critical','Stoppa/återkräv dubbletten.','active','sol_2001_453','2026-07-01'),
  ('ea_income_without_period','1.0.0','economic_assistance','Inkomst saknar period','Ingen period angiven.','medium','Komplettera uppgiften.','active','sol_2001_453','2026-07-01'),
  ('ea_income_verified_after_decision','1.0.0','economic_assistance','Inkomst verifierad efter beslut','Kan påverka biståndsrätten.','high','Ompröva beslutet.','active','sol_2001_453','2026-07-01'),
  ('ea_household_member_missing_from_calculation','1.0.0','economic_assistance','Medlem saknas i beräkning','Hushållsmedlem ej medräknad.','medium','Kontrollera beräkningen.','active','sol_2001_453','2026-07-01'),
  ('ea_housing_cost_without_document','1.0.0','economic_assistance','Boendekostnad utan underlag','Styrkande dokument saknas.','medium','Begär in underlag.','active','sol_2001_453','2026-07-01'),
  ('ea_application_missing_required_attachment','1.0.0','economic_assistance','Obligatorisk bilaga saknas','Krävda bilagor saknas.','medium','Begär komplettering.','active','sol_2001_453','2026-07-01'),
  ('ea_payment_despite_recovery_claim','1.0.0','economic_assistance','Utbetalning trots återkrav','Utan dokumenterad kontroll.','high','Dokumentera kontroll/kvittning.','active','sol_2001_453','2026-07-01'),
  ('ea_account_shared_across_households','1.0.0','economic_assistance','Konto delas av flera hushåll','Samma konto utan förklaring.','high','Utred kontokopplingen.','active','sol_2001_453','2026-07-01'),
  ('ea_account_changed_near_payment','1.0.0','economic_assistance','Konto ändrat nära utbetalning','Kontobyte kort före utbetalning.','high','Verifiera bytet.','active','sol_2001_453','2026-07-01'),
  ('ea_decision_changed_old_payment_details','1.0.0','economic_assistance','Gamla betalningsuppgifter','Ersatt beslut används.','high','Uppdatera uppgifterna.','active','sol_2001_453','2026-07-01'),
  ('ea_payment_despite_rejection','1.0.0','economic_assistance','Utbetalning trots avslag','Avslag men utbetalning skapades.','critical','Stoppa omedelbart.','active','sol_2001_453','2026-07-01'),
  ('ea_payment_during_reconsideration','1.0.0','economic_assistance','Utbetalning under omprövning','Omprövning pågår.','medium','Överväg paus.','active','sol_2001_453','2026-07-01'),
  ('ea_income_not_used_in_decision','1.0.0','economic_assistance','Inkomst ej använd i beslut','Registrerad inkomst ej beaktad.','high','Kontrollera och ompröva.','active','sol_2001_453','2026-07-01'),
  ('ea_household_changed_after_decision','1.0.0','economic_assistance','Hushåll ändrat efter beslut','Sammansättning ändrad.','medium','Ompröva vid behov.','active','sol_2001_453','2026-07-01'),
  ('ea_housing_cost_without_document_link','1.0.0','economic_assistance','Boendekostnad utan dokumentlänk','Länk till dokument saknas.','low','Koppla dokumentet.','active','sol_2001_453','2026-07-01'),
  ('ea_payment_recipient_outside_household','1.0.0','economic_assistance','Mottagare utanför hushållet','Ej verifierad tredje part.','high','Verifiera eller stoppa.','active','sol_2001_453','2026-07-01'),
  ('ea_application_decision_payment_period_mismatch','1.0.0','economic_assistance','Perioder matchar inte','Ansökan/beslut/utbetalning avviker.','medium','Kontrollera periodkedjan.','active','sol_2001_453','2026-07-01'),
  ('ea_payment_file_row_without_decision','1.0.0','economic_assistance','Filrad utan godkänt beslut','Rad kan inte kopplas till beslut.','critical','Stoppa raden.','active','sol_2001_453','2026-07-01'),
  ('ea_recipient_changed_after_decision','1.0.0','economic_assistance','Mottagare ändrad före utbetalning','Konto ändrat mellan beslut och betalning.','high','Verifiera ändringen.','active','sol_2001_453','2026-07-01'),
  ('ea_calculation_ignored_verified_income','1.0.0','economic_assistance','Verifierad inkomst ignorerad','Endast deklarerad inkomst användes.','high','Räkna om.','active','sol_2001_453','2026-07-01'),
  ('ea_protected_household_without_elevated_access','1.0.0','economic_assistance','Skyddat hushåll utan förhöjt skydd','Åtkomstskydd saknas.','critical','Aktivera skydd omedelbart.','active','osl_2009_400','2026-07-01'),
  ('ea_sensitive_field_reveal_without_reason','1.0.0','economic_assistance','Känsligt fält utan skäl','Visning utan registrerat skäl.','high','Granska enligt inre sekretess.','active','osl_2009_400','2026-07-01');

-- Seed SSBTEK-ready income sources
insert into ea_income_sources (source_key, title, ssbtek_code, income_kind) values
  ('salary','Lön','SSBTEK-LON','salary'),
  ('unemployment_benefit','Arbetslöshetsersättning','SSBTEK-AKASSA','unemployment_benefit'),
  ('sickness_benefit','Sjukpenning','SSBTEK-SJP','sickness_benefit'),
  ('parental_benefit','Föräldrapenning','SSBTEK-FP','parental_benefit'),
  ('pension','Pension','SSBTEK-PEN','pension'),
  ('student_aid','Studiestöd','SSBTEK-CSN','student_aid'),
  ('child_allowance','Barnbidrag','SSBTEK-BB','child_allowance'),
  ('housing_allowance','Bostadsbidrag','SSBTEK-BOB','housing_allowance'),
  ('maintenance_support','Underhållsstöd','SSBTEK-US','maintenance_support'),
  ('other','Övrig inkomst',null,'other');
