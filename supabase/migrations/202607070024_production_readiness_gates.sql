-- ============================================================================
-- 202607070024_production_readiness_gates.sql
-- Production acceptance gates. Go-live is blocked until required gates pass.
-- Gate status (without PII) is mirrored to the control plane.
-- ============================================================================

create table production_readiness_gates (
  id uuid primary key default gen_random_uuid(),
  gate_key text not null unique,
  title_sv text not null,
  description_sv text not null,
  required boolean not null default true,
  gate_order integer not null
);

create table production_readiness_evidence (
  id uuid primary key default gen_random_uuid(),
  gate_key text not null references production_readiness_gates(gate_key),
  status text not null default 'not_started' check (status in
    ('not_started','in_progress','passed','failed','waived')),
  evidence_kind text check (evidence_kind in
    ('test_run','document','attestation','configuration','external_reference')),
  evidence_reference text,
  verified_by uuid references user_profiles(id),
  waiver_motivation text,
  approval_workflow_id uuid references approval_workflows(id),
  updated_at timestamptz not null default now(),
  unique (gate_key)
);

create or replace view production_go_live_status as
select
  count(*) filter (where g.required) as required_gates,
  count(*) filter (where g.required and e.status = 'passed') as passed_required_gates,
  count(*) filter (where g.required and coalesce(e.status,'not_started') not in ('passed','waived')) as blocking_gates,
  (count(*) filter (where g.required and coalesce(e.status,'not_started') not in ('passed','waived'))) = 0 as go_live_allowed
from production_readiness_gates g
left join production_readiness_evidence e on e.gate_key = g.gate_key;

insert into production_readiness_gates (gate_key, title_sv, description_sv, required, gate_order) values
  ('dpia_completed','DPIA genomförd','Konsekvensbedömning avseende dataskydd är genomförd och godkänd.',true,1),
  ('dpa_pub_signed','PUB-avtal/DPA signerat','Personuppgiftsbiträdesavtal är tecknat.',true,2),
  ('sso_tested','SSO testad','Inloggning via kommunens IdP är verifierad.',true,3),
  ('mfa_verified','MFA verifierad','Multifaktorautentisering är verifierad.',true,4),
  ('rls_tests_passed','RLS-tester godkända','Radnivåsäkerheten är testad och godkänd.',true,5),
  ('backup_tested','Backup testad','Säkerhetskopiering är konfigurerad och verifierad.',true,6),
  ('restore_tested','Återläsning testad','Återläsningstest är genomfört och godkänt.',true,7),
  ('siem_tested','SIEM testad','SIEM-export av tekniska händelser är verifierad.',false,8),
  ('exit_export_tested','Exit-export testad','Fullständig exit-export är testad.',true,9),
  ('accessibility_reviewed','Tillgänglighet granskad','WCAG/EN 301 549-granskning är genomförd.',true,10),
  ('archive_reviewed','Arkiv granskat','Arkiv- och gallringskonfiguration är granskad.',true,11),
  ('ubm_mock_tested','UBM-test genomförd','Testförfrågan och testexport är genomförda.',true,12),
  ('payment_reconciliation_tested','Betalningsavstämning testad','Avstämning mot betalningsfil är testad.',true,13),
  ('go_live_approved','Go-live godkänt','Slutligt go-live-beslut med maker-checker.',true,14);

alter table production_readiness_gates enable row level security;
alter table production_readiness_evidence enable row level security;
