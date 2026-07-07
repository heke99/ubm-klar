-- ============================================================================
-- 202607070023_cybersecurity_readiness.sql
-- NIS2 readiness: cyber risk register, security controls, supplier risks,
-- continuity plans, incidents and exercises. No PII.
-- ============================================================================

create table cyber_risk_register (
  id uuid primary key default gen_random_uuid(),
  risk_key text not null unique,
  title text not null,
  description text not null,
  category text not null check (category in
    ('availability','integrity','confidentiality','supply_chain','personnel','physical','compliance')),
  likelihood smallint not null check (likelihood between 1 and 5),
  impact smallint not null check (impact between 1 and 5),
  risk_owner uuid references user_profiles(id),
  treatment text not null default 'mitigate' check (treatment in
    ('accept','mitigate','transfer','avoid')),
  status text not null default 'open' check (status in ('open','mitigating','accepted','closed')),
  review_due date,
  created_at timestamptz not null default now()
);

create table security_controls (
  id uuid primary key default gen_random_uuid(),
  control_key text not null unique,
  title text not null,
  framework_reference text, -- e.g. 'NIS2 art. 21', 'ISO 27002:8.2'
  description text not null,
  implementation_status text not null default 'planned' check (implementation_status in
    ('planned','implementing','implemented','verified','not_applicable')),
  owner uuid references user_profiles(id),
  last_verified_at date
);

create table security_control_evidence (
  id uuid primary key default gen_random_uuid(),
  control_key text not null references security_controls(control_key),
  evidence_kind text not null check (evidence_kind in
    ('document','configuration','test_result','attestation','audit_report')),
  reference text not null,
  document_id uuid references documents(id),
  added_by uuid,
  added_at timestamptz not null default now()
);

create table supplier_risks (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  service_description text not null,
  criticality text not null check (criticality in ('low','medium','high','critical')),
  data_processed text not null default 'none' check (data_processed in
    ('none','technical_metadata','personal_data','sensitive_personal_data')),
  dpa_signed boolean not null default false,
  security_review_done boolean not null default false,
  exit_plan_exists boolean not null default false,
  risk_notes text,
  reviewed_at date
);

create table continuity_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  title text not null,
  scope text not null,
  rto_hours integer,
  rpo_hours integer,
  last_tested_at date,
  test_result text check (test_result in ('passed','partial','failed')),
  owner uuid references user_profiles(id),
  document_id uuid references documents(id)
);

create table security_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_number text not null unique,
  title text not null,
  category text not null check (category in
    ('availability','data_breach','unauthorized_access','malware','phishing','supply_chain','other')),
  severity text not null check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in
    ('open','contained','eradicated','recovered','closed')),
  reported_to_authority boolean not null default false,
  authority_report_due timestamptz,
  detected_at timestamptz not null,
  closed_at timestamptz,
  -- description must never contain citizen PII; incident details reference the
  -- data plane, and personal-data breaches are handled in the GDPR module
  description_no_pii text not null
);

create table security_incident_timeline (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references security_incidents(id) on delete cascade,
  event_kind text not null check (event_kind in
    ('detected','triaged','contained','eradicated','recovered','authority_notified',
     'municipality_notified','post_mortem','closed','note')),
  detail_no_pii text not null,
  actor_user_id uuid,
  occurred_at timestamptz not null default now()
);

create trigger security_incident_timeline_no_update
  before update or delete on security_incident_timeline
  for each row execute function app.reject_mutation();

create table security_exercises (
  id uuid primary key default gen_random_uuid(),
  exercise_key text not null unique,
  exercise_kind text not null check (exercise_kind in
    ('tabletop','restore_test','failover_test','phishing_simulation','incident_drill','pen_test')),
  performed_at date not null,
  outcome text not null check (outcome in ('passed','partial','failed')),
  findings_no_pii text,
  owner uuid references user_profiles(id)
);

-- SIEM export state (no-PII technical events only)
create table siem_export_config (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default false,
  endpoint_reference text, -- secret store reference, never credentials
  format text not null default 'json_lines' check (format in ('json_lines','cef','syslog')),
  last_export_at timestamptz,
  last_export_status text check (last_export_status in ('ok','failed'))
);

alter table cyber_risk_register enable row level security;
alter table security_controls enable row level security;
alter table security_control_evidence enable row level security;
alter table supplier_risks enable row level security;
alter table continuity_plans enable row level security;
alter table security_incidents enable row level security;
alter table security_incident_timeline enable row level security;
alter table security_exercises enable row level security;
alter table siem_export_config enable row level security;
