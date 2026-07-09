-- 202607070034_ubm_internal_pilot_schemas.sql
-- Internal pilot export schemas. These are UBM Klar's INTERNAL structured
-- formats for manual (download) responses to request-based UBM enquiries.
-- They are NOT official Utbetalningsmyndigheten formats: official schemas stay
-- in awaiting_official_specification until real specifications exist, and the
-- transport profile is manual_download only.

insert into ubm_schemas (schema_key, title, domain, obligation_kind, description) values
  ('internal_lss_request', 'Internt svarschema – LSS (pilot, manuell export)', 'lss', 'request_based',
   'Internt UBM Klar-format för manuellt exporterade svar på förfrågningar inom LSS. Ej officiellt UBM-format.'),
  ('internal_ea_request', 'Internt svarschema – ekonomiskt bistånd (pilot, manuell export)', 'economic_assistance', 'request_based',
   'Internt UBM Klar-format för manuellt exporterade svar på förfrågningar inom ekonomiskt bistånd. Ej officiellt UBM-format.')
on conflict (schema_key) do nothing;

insert into ubm_schema_versions
  (schema_key, version, status, effective_from, transport_profile, transport_approved) values
  ('internal_lss_request', '1.0.0', 'active', '2026-07-01', 'manual_download', true),
  ('internal_ea_request', '1.0.0', 'active', '2026-07-01', 'manual_download', true)
on conflict (schema_key, version) do nothing;
