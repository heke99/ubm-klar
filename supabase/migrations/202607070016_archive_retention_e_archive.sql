-- ============================================================================
-- 202607070016_archive_retention_e_archive.sql
-- Archive classifications, retention rules, legal holds, disposal decisions
-- and e-archive export packages.
-- ============================================================================

create table archive_classifications (
  id uuid primary key default gen_random_uuid(),
  classification_key text not null unique,
  title text not null,
  process_reference text, -- klassificeringsstruktur/processreferens
  entity_kinds text[] not null default '{}',
  preservation text not null check (preservation in ('preserve','dispose_after_retention')),
  retention_years integer,
  legal_basis text
);

create table archive_retention_rules (
  id uuid primary key default gen_random_uuid(),
  classification_key text not null references archive_classifications(classification_key),
  rule_key text not null unique,
  trigger_event text not null check (trigger_event in
    ('case_closed','decision_expired','payment_completed','person_deceased','fixed_date')),
  retention_years integer not null,
  action text not null check (action in ('dispose','archive','review')),
  is_active boolean not null default true
);

create table legal_holds (
  id uuid primary key default gen_random_uuid(),
  hold_key text not null unique,
  title text not null,
  reason text not null,
  entity_kind text,
  entity_id uuid,
  classification_key text references archive_classifications(classification_key),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  released_by uuid,
  released_at timestamptz
);

create table disposal_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_number text not null unique,
  classification_key text not null references archive_classifications(classification_key),
  scope_description text not null,
  decided_by uuid not null,
  -- FK to approval_workflows added in 202607070019
  approval_workflow_id uuid,
  decided_at timestamptz not null default now(),
  executed_at timestamptz,
  entity_count integer,
  status text not null default 'decided' check (status in
    ('decided','scheduled','executing','executed','blocked_by_legal_hold','cancelled'))
);

create table e_archive_export_packages (
  id uuid primary key default gen_random_uuid(),
  package_number text not null unique,
  classification_key text references archive_classifications(classification_key),
  package_format text not null default 'fgs_paket' check (package_format in
    ('fgs_paket','oais_sip','zip_manifest')),
  manifest jsonb not null,
  manifest_hash_sha256 text not null,
  content_hash_sha256 text not null,
  storage_bucket text not null default 'archive-exports',
  storage_path text,
  -- FK to approval_workflows added in 202607070019
  approval_workflow_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  status text not null default 'created' check (status in
    ('created','approved','delivered','verified','failed'))
);

create table archive_audit_trail (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in
    ('classification_created','retention_rule_changed','legal_hold_created','legal_hold_released',
     'disposal_decided','disposal_executed','package_created','package_delivered','retention_review')),
  subject_kind text,
  subject_id uuid,
  actor_user_id uuid,
  detail text,
  occurred_at timestamptz not null default now()
);

create trigger archive_audit_trail_no_update
  before update or delete on archive_audit_trail
  for each row execute function app.reject_mutation();

alter table archive_classifications enable row level security;
alter table archive_retention_rules enable row level security;
alter table legal_holds enable row level security;
alter table disposal_decisions enable row level security;
alter table e_archive_export_packages enable row level security;
alter table archive_audit_trail enable row level security;
