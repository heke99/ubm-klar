-- ============================================================================
-- 202607070030_recurring_ubm_reporting_2029.sql
-- UBM Phase 2 (1 July 2029): recurring reporting readiness. Feature-flagged
-- (ubm_recurring_reporting_2029) and schema-status-gated: nothing here
-- hardcodes a final official UBM format.
-- ============================================================================

create table ubm_reporting_schedules (
  id uuid primary key default gen_random_uuid(),
  schedule_key text not null unique,
  domain text not null check (domain in ('lss','economic_assistance','common')),
  frequency text not null check (frequency in ('monthly','quarterly','yearly','unknown_pending_specification')),
  schema_key text not null,
  enabled boolean not null default false,
  feature_flag_key text not null default 'ubm_recurring_reporting_2029',
  effective_from date,
  note text
);

create table ubm_reporting_periods (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references ubm_reporting_schedules(id),
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in
    ('open','collecting','validating','proposal_created','in_review','approved','sent',
     'receipt_received','closed','failed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (schedule_id, period_start),
  check (period_end >= period_start)
);

create table ubm_recurring_dataset_definitions (
  id uuid primary key default gen_random_uuid(),
  dataset_key text not null unique,
  schedule_id uuid not null references ubm_reporting_schedules(id),
  schema_key text not null,
  schema_version text not null,
  source_query_reference text not null,
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  created_at timestamptz not null default now()
);

create table ubm_recurring_exports (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references ubm_reporting_periods(id),
  dataset_key text not null references ubm_recurring_dataset_definitions(dataset_key),
  proposal_id uuid references ubm_export_proposals(id),
  row_count integer not null default 0,
  payload_hash_sha256 text,
  status text not null default 'draft' check (status in
    ('draft','validated','in_review','approved','packaged','sent','receipt_received','failed')),
  created_at timestamptz not null default now()
);

create table ubm_export_differences (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references ubm_recurring_exports(id) on delete cascade,
  previous_export_id uuid references ubm_recurring_exports(id),
  difference_kind text not null check (difference_kind in
    ('added','removed','changed','volume_shift')),
  entity_kind text,
  entity_id uuid,
  field_key text,
  detail text,
  created_at timestamptz not null default now()
);

create table ubm_period_closures (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references ubm_reporting_periods(id) unique,
  closed_by uuid not null,
  approval_workflow_id uuid references approval_workflows(id),
  receipt_id uuid references ubm_receipts(id),
  evidence_chain_verified boolean not null default false,
  closed_at timestamptz not null default now()
);

alter table ubm_reporting_schedules enable row level security;
alter table ubm_reporting_periods enable row level security;
alter table ubm_recurring_dataset_definitions enable row level security;
alter table ubm_recurring_exports enable row level security;
alter table ubm_export_differences enable row level security;
alter table ubm_period_closures enable row level security;
