-- 202607070032_onboarding_pilot_gates.sql
-- Customer pilot hardening: full 26-step onboarding checklist, pilot vs
-- production gate scopes, and a formal waiver model (reason, approver, expiry,
-- risk level). Waivers are audited by the API layer.

alter table production_readiness_gates
  add column if not exists scope text not null default 'production'
    check (scope in ('pilot', 'production', 'both'));

alter table production_readiness_evidence
  add column if not exists waiver_approved_by uuid references user_profiles(id),
  add column if not exists waiver_expires_at date,
  add column if not exists waiver_risk_level text
    check (waiver_risk_level in ('low', 'medium', 'high', 'critical'));

comment on column production_readiness_gates.scope is
  'pilot: required before customer pilot; production: required before go-live; both: required for both.';

-- Existing gates: assign scopes.
update production_readiness_gates set scope = 'both'
  where gate_key in ('dpa_pub_signed', 'dpia_completed', 'sso_tested', 'backup_tested',
                     'restore_tested', 'ubm_mock_tested');
update production_readiness_gates set scope = 'production'
  where gate_key in ('mfa_verified', 'rls_tests_passed', 'siem_tested', 'exit_export_tested',
                     'accessibility_reviewed', 'archive_reviewed',
                     'payment_reconciliation_tested', 'go_live_approved');

-- Full onboarding checklist (26 steps; merged with the 14 original gates).
insert into production_readiness_gates (gate_key, title_sv, description_sv, required, gate_order, scope) values
  ('tenant_information','Tenantuppgifter registrerade','Kommunens uppgifter (namn, organisationsnummer, kontakter) är registrerade i kontrollplanet.',true,20,'both'),
  ('deployment_model_selected','Driftmodell vald','Modell B (leverantörsdriftad isolerad dataplan) eller Modell C (kommunägd dataplan) är vald och dokumenterad.',true,21,'both'),
  ('domain_verified','Domän verifierad','Kommunens domän är registrerad och verifierad i kontrollplanet.',true,22,'both'),
  ('auth_configured','Inloggning konfigurerad','Entra ID/OIDC är konfigurerad, eller godkänd pilotinloggning är beslutad.',true,23,'both'),
  ('roles_groups_mapped','Roller och grupper mappade','IdP-grupper är mappade till systemets roller och behörigheter.',true,24,'both'),
  ('legal_basis_confirmed','Rättslig grund bekräftad','Rättslig grund per modul är bekräftad och dokumenterad i registerförteckningen.',true,25,'production'),
  ('retention_configured','Gallring konfigurerad','Bevarande- och gallringsregler per informationsklass är konfigurerade.',true,26,'production'),
  ('document_storage_configured','Dokumentlagring konfigurerad','Dokumentlagring (Supabase Storage/S3) med kryptering i vila är konfigurerad.',true,27,'production'),
  ('malware_scanning_configured','Virusskanning konfigurerad','Skanningstjänst är konfigurerad; disabled-local är förbjudet i produktion.',true,28,'production'),
  ('audit_log_verified','Revisionslogg verifierad','Beständig revisionslogg är verifierad med hash-kedja.',true,29,'both'),
  ('data_access_log_verified','Dataåtkomstlogg verifierad','Beständig dataåtkomstlogg är verifierad.',true,30,'both'),
  ('import_dry_run_completed','Provimport genomförd','Import-dry-run med avgränsad datamängd är genomförd.',true,31,'both'),
  ('export_dry_run_completed','Exportövning genomförd','Exportförslag har skapats, godkänts och paketerats som övning.',true,32,'both'),
  ('maker_checker_tested','Fyra-ögon-test genomfört','Maker–checker-flödet är verifierat: skaparen kan inte godkänna själv.',true,33,'production'),
  ('support_process_agreed','Supportprocess överenskommen','Supportmodell utan personuppgifter samt JIT/break-glass-process är överenskommen.',true,34,'both'),
  ('incident_contact_runbook','Incidentkontakt och runbook','Incidentkontakter och runbook är fastställda för kommun och leverantör.',true,35,'both'),
  ('pilot_scope_approved','Pilotomfattning godkänd','Pilotens omfattning, datamängder och begränsningar är godkända av kommunen.',true,36,'pilot')
on conflict (gate_key) do update
  set title_sv = excluded.title_sv,
      description_sv = excluded.description_sv,
      required = excluded.required,
      scope = excluded.scope;
