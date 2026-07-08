-- ============================================================================
-- 202607070014_retention_and_exit_export.sql
-- Retention policies, data subject requests and exit export.
-- ============================================================================

create table retention_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique,
  entity_kind text not null,
  retention_years integer,
  retention_basis text not null,
  action_at_expiry text not null check (action_at_expiry in
    ('delete','anonymize','archive','manual_review')),
  legal_source_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  request_kind text not null check (request_kind in
    ('access','rectification','erasure','restriction','portability','objection')),
  person_id uuid references persons(id),
  received_at date not null,
  due_at date not null,
  status text not null default 'received' check (status in
    ('received','identity_verification','processing','completed','rejected','extended')),
  handled_by uuid references user_profiles(id),
  outcome_summary text,
  completed_at timestamptz
);

create table retention_actions (
  id uuid primary key default gen_random_uuid(),
  policy_key text references retention_policies(policy_key),
  entity_kind text not null,
  entity_id uuid not null,
  action text not null check (action in ('deleted','anonymized','archived','held','reviewed')),
  legal_hold_blocked boolean not null default false,
  executed_by uuid,
  -- FK to approval_workflows added in 202607070019
  approval_workflow_id uuid,
  executed_at timestamptz not null default now()
);

create trigger retention_actions_no_update
  before update or delete on retention_actions
  for each row execute function app.reject_mutation();

create table exit_exports (
  id uuid primary key default gen_random_uuid(),
  export_number text not null unique,
  requested_by uuid not null references user_profiles(id),
  -- FK to approval_workflows added in 202607070019
  approval_workflow_id uuid,
  scope text[] not null default array[
    'structured_data','documents','document_metadata','audit_logs','data_access_logs',
    'ubm_exports_receipts','control_cases','rule_configs','import_history','mappings',
    'source_record_links','data_lineage','evidence_chain'
  ],
  status text not null default 'requested' check (status in
    ('requested','approved','running','completed','failed','cancelled')),
  package_manifest jsonb,
  manifest_hash_sha256 text,
  storage_bucket text default 'exit-exports',
  storage_path text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table exit_export_items (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references exit_exports(id) on delete cascade,
  item_kind text not null,
  row_count integer,
  file_reference text,
  file_hash_sha256 text,
  status text not null default 'pending' check (status in ('pending','exported','failed'))
);

alter table retention_policies enable row level security;
alter table data_subject_requests enable row level security;
alter table retention_actions enable row level security;
alter table exit_exports enable row level security;
alter table exit_export_items enable row level security;
