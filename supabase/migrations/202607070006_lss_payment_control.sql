-- ============================================================================
-- 202607070006_lss_payment_control.sql
-- Shared risk rule registry, risk flags and control cases (created here since
-- LSS payment control is the first consumer; used by all domains), plus LSS
-- matching support.
-- ============================================================================

create table risk_rule_definitions (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  version text not null,
  domain text not null check (domain in ('lss','economic_assistance','payment_control','common')),
  title text not null,
  description text not null,
  severity text not null check (severity in ('info','low','medium','high','critical')),
  recommended_action text not null,
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  legal_source_key text,
  legal_source_version text,
  parameters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (rule_key, version)
);

create table risk_flags (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  rule_version text not null,
  domain text not null,
  severity text not null check (severity in ('info','low','medium','high','critical')),
  subject_kind text not null,
  subject_id uuid not null,
  person_id uuid references persons(id),
  explanation text not null,
  recommended_action text not null,
  amount_at_risk_sek numeric,
  evidence_references text[] not null default '{}',
  legal_source_key text,
  legal_source_version text,
  dry_run boolean not null default false,
  status text not null default 'open' check (status in
    ('open','under_review','confirmed','dismissed','resolved')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  control_case_id uuid,
  flagged_at timestamptz not null default now()
);

create index risk_flags_subject_idx on risk_flags(subject_kind, subject_id);
create index risk_flags_rule_idx on risk_flags(rule_key, flagged_at);

create table control_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  source_kind text not null check (source_kind in
    ('risk_flag','ubm_notification','manual','import_error','payment_anomaly','access_anomaly')),
  source_reference text not null,
  domain text not null check (domain in ('lss','economic_assistance','payment_control','security','common')),
  title text not null,
  severity text not null check (severity in ('info','low','medium','high','critical')),
  status text not null default 'open' check (status in
    ('open','assigned','investigating','awaiting_decision','decided','closed','reopened')),
  person_id uuid references persons(id),
  amount_at_risk_sek numeric,
  assigned_to uuid references user_profiles(id),
  outcome text check (outcome in
    ('recovery_claim','payment_stopped','no_action','police_report','corrected_source_data','other_action')),
  outcome_note text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table risk_flags
  add constraint risk_flags_control_case_fk
  foreign key (control_case_id) references control_cases(id);

create table control_case_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references control_cases(id) on delete cascade,
  assigned_to uuid not null references user_profiles(id),
  assigned_by uuid not null references user_profiles(id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz
);

create table control_case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references control_cases(id) on delete cascade,
  author_user_id uuid not null,
  note text not null,
  created_at timestamptz not null default now()
);

create table control_case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references control_cases(id) on delete cascade,
  document_id uuid not null references documents(id),
  added_by uuid not null,
  added_at timestamptz not null default now(),
  unique (case_id, document_id)
);

create table control_case_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references control_cases(id),
  decision text not null,
  decided_by uuid not null,
  motivation text not null,
  decided_at timestamptz not null default now()
);

create table control_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references control_cases(id) on delete cascade,
  event_kind text not null,
  actor_user_id uuid,
  detail text,
  occurred_at timestamptz not null default now()
);

create trigger control_case_events_no_update
  before update or delete on control_case_events
  for each row execute function app.reject_mutation();

create table control_case_status_history (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references control_cases(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid not null,
  reason text,
  occurred_at timestamptz not null default now()
);

create trigger control_case_status_history_no_update
  before update or delete on control_case_status_history
  for each row execute function app.reject_mutation();

-- Evidence chain entries (generic across subjects)
create table evidence_chain_entries (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null,
  subject_id uuid not null,
  sequence integer not null,
  entry_kind text not null,
  artifact_reference text not null,
  artifact_hash_sha256 text,
  actor_user_id uuid,
  occurred_at timestamptz not null default now(),
  previous_entry_hash text,
  entry_hash text not null,
  unique (subject_kind, subject_id, sequence)
);

create trigger evidence_chain_entries_no_update
  before update or delete on evidence_chain_entries
  for each row execute function app.reject_mutation();

alter table risk_rule_definitions enable row level security;
alter table risk_flags enable row level security;
alter table control_cases enable row level security;
alter table control_case_assignments enable row level security;
alter table control_case_notes enable row level security;
alter table control_case_documents enable row level security;
alter table control_case_decisions enable row level security;
alter table control_case_events enable row level security;
alter table control_case_status_history enable row level security;
alter table evidence_chain_entries enable row level security;
