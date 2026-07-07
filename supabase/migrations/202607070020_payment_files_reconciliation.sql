-- ============================================================================
-- 202607070020_payment_files_reconciliation.sql
-- Payment file import, recipient registry, blocklists, reconciliation and
-- payment status tracking.
-- ============================================================================

create table payment_files (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references import_batches(id),
  file_name text not null,
  file_hash_sha256 text not null,
  file_format text not null check (file_format in
    ('iso20022_pain','iso20022_camt','bgmax','csv','excel','other')),
  economy_system text,
  period_start date,
  period_end date,
  row_count integer not null default 0,
  total_amount_sek numeric,
  status text not null default 'imported' check (status in
    ('imported','parsing','parsed','reconciling','reconciled','failed')),
  imported_by uuid,
  imported_at timestamptz not null default now()
);

create table payment_file_rows (
  id uuid primary key default gen_random_uuid(),
  payment_file_id uuid not null references payment_files(id) on delete cascade,
  row_number integer not null,
  external_payment_reference text,
  recipient_name_masked text,
  recipient_account_reference text,
  recipient_org_number text,
  person_id uuid references persons(id),
  organization_id uuid references organizations(id),
  amount_sek numeric not null,
  currency text not null default 'SEK',
  payment_date date,
  booked_status text check (booked_status in ('pending','booked','confirmed','rejected','reversed')),
  domain_hint text check (domain_hint in ('lss','economic_assistance','other')),
  matched_payment_kind text,
  matched_payment_id uuid,
  match_status text not null default 'unmatched' check (match_status in
    ('unmatched','matched','ambiguous','no_decision','manual')),
  unique (payment_file_id, row_number)
);

create index payment_file_rows_person_idx on payment_file_rows(person_id);

create table payment_recipient_registry (
  id uuid primary key default gen_random_uuid(),
  recipient_kind text not null check (recipient_kind in ('person','organization')),
  person_id uuid references persons(id),
  organization_id uuid references organizations(id),
  account_kind text not null check (account_kind in ('bankgiro','plusgiro','bank_account','other')),
  account_reference text not null,
  verified boolean not null default false,
  verified_by uuid,
  verified_at timestamptz,
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  check (
    (recipient_kind = 'person' and person_id is not null and organization_id is null) or
    (recipient_kind = 'organization' and organization_id is not null and person_id is null)
  )
);

create table payment_account_change_logs (
  id uuid primary key default gen_random_uuid(),
  recipient_registry_id uuid not null references payment_recipient_registry(id),
  old_account_reference text,
  new_account_reference text not null,
  changed_by uuid,
  change_source text not null check (change_source in ('manual','import','api')),
  approval_workflow_id uuid references approval_workflows(id),
  changed_at timestamptz not null default now()
);

create trigger payment_account_change_logs_no_update
  before update or delete on payment_account_change_logs
  for each row execute function app.reject_mutation();

create table payment_blocklists (
  id uuid primary key default gen_random_uuid(),
  blocked_kind text not null check (blocked_kind in ('person','organization','account_reference')),
  person_id uuid references persons(id),
  organization_id uuid references organizations(id),
  account_reference text,
  reason text not null,
  blocked_by uuid not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  lifted_by uuid,
  lifted_at timestamptz
);

create table payment_status_history (
  id uuid primary key default gen_random_uuid(),
  payment_kind text not null check (payment_kind in ('lss_payment','ea_payment')),
  payment_id uuid not null,
  old_status text,
  new_status text not null check (new_status in
    ('created','pending_approval','approved','sent','paid','rejected','reversed','paused',
     'cancelled','stopped','recovery_started')),
  changed_by uuid,
  change_reason text,
  occurred_at timestamptz not null default now()
);

create index payment_status_history_payment_idx on payment_status_history(payment_kind, payment_id);

create trigger payment_status_history_no_update
  before update or delete on payment_status_history
  for each row execute function app.reject_mutation();

create table payment_pause_decisions (
  id uuid primary key default gen_random_uuid(),
  payment_kind text not null,
  payment_id uuid not null,
  reason text not null,
  decided_by uuid not null,
  approval_workflow_id uuid references approval_workflows(id),
  paused_at timestamptz not null default now(),
  resumed_at timestamptz,
  resumed_by uuid
);

create table payment_stop_actions (
  id uuid primary key default gen_random_uuid(),
  payment_kind text not null,
  payment_id uuid not null,
  reason text not null,
  control_case_id uuid,
  decided_by uuid not null,
  approval_workflow_id uuid references approval_workflows(id),
  stopped_at timestamptz not null default now()
);

create table payment_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  payment_file_id uuid references payment_files(id),
  scope text not null check (scope in ('lss','economic_assistance','all')),
  rule_set_version text not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  rows_total integer not null default 0,
  rows_matched integer not null default 0,
  rows_flagged integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table payment_reconciliation_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references payment_reconciliation_runs(id) on delete cascade,
  payment_file_row_id uuid references payment_file_rows(id),
  result_kind text not null check (result_kind in
    ('matched','duplicate_payment','missing_decision','outside_decision_period',
     'blocked_recipient','account_changed_near_payment','recipient_mismatch',
     'recovery_claim_conflict','amount_mismatch','unmatched')),
  severity text not null check (severity in ('info','low','medium','high','critical')),
  explanation text not null,
  risk_flag_id uuid,
  control_case_id uuid,
  created_at timestamptz not null default now()
);

create table recovery_claim_links (
  id uuid primary key default gen_random_uuid(),
  claim_kind text not null check (claim_kind in ('lss_recovery_claim','ea_recovery_claim')),
  claim_id uuid not null,
  linked_kind text not null check (linked_kind in
    ('payment','payment_file_row','control_case','ubm_notification')),
  linked_id uuid not null,
  note text,
  created_at timestamptz not null default now(),
  unique (claim_kind, claim_id, linked_kind, linked_id)
);

alter table payment_files enable row level security;
alter table payment_file_rows enable row level security;
alter table payment_recipient_registry enable row level security;
alter table payment_account_change_logs enable row level security;
alter table payment_blocklists enable row level security;
alter table payment_status_history enable row level security;
alter table payment_pause_decisions enable row level security;
alter table payment_stop_actions enable row level security;
alter table payment_reconciliation_runs enable row level security;
alter table payment_reconciliation_results enable row level security;
alter table recovery_claim_links enable row level security;
