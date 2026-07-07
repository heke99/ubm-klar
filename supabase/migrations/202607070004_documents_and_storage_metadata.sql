-- ============================================================================
-- 202607070004_documents_and_storage_metadata.sql
-- Document vault metadata. File contents live in per-municipality storage
-- (Supabase Storage for Model B, municipality-owned storage for Model C).
-- Metadata, classification and access logging live here.
-- ============================================================================

create table storage_buckets_config (
  id uuid primary key default gen_random_uuid(),
  bucket_key text not null unique check (bucket_key in
    ('documents-lss','documents-economic-assistance','documents-ubm','documents-redacted',
     'ubm-exports','support-bundles-no-pii','archive-exports','public-record-disclosures',
     'exit-exports')),
  storage_provider text not null default 'supabase' check (storage_provider in
    ('supabase','municipality_s3','municipality_azure_blob','municipality_file_share')),
  encryption text not null default 'provider_managed' check (encryption in
    ('provider_managed','customer_managed_key')),
  encryption_key_reference text, -- key reference only, never key material
  allow_public_access boolean not null default false check (allow_public_access = false),
  retention_days integer,
  created_at timestamptz not null default now()
);

insert into storage_buckets_config (bucket_key) values
  ('documents-lss'),
  ('documents-economic-assistance'),
  ('documents-ubm'),
  ('documents-redacted'),
  ('ubm-exports'),
  ('support-bundles-no-pii'),
  ('archive-exports'),
  ('public-record-disclosures'),
  ('exit-exports');

create table documents (
  id uuid primary key default gen_random_uuid(),
  bucket_key text not null references storage_buckets_config(bucket_key),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  file_hash_sha256 text not null,
  document_type text not null,
  document_class text not null default 'standard' check (document_class in
    ('standard','sensitive','medical','protected_identity','children','disclosure','archive')),
  person_id uuid references persons(id),
  case_kind text,
  case_id uuid,
  source_system_id uuid references source_systems(id),
  malware_scan_status text not null default 'pending' check (malware_scan_status in
    ('pending','clean','infected','scan_failed','skipped_policy')),
  malware_scanned_at timestamptz,
  is_redacted_version boolean not null default false,
  original_document_id uuid references documents(id),
  redaction_status text check (redaction_status in
    ('not_required','required','in_progress','completed','approved')),
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bucket_key, storage_path)
);

create index documents_person_idx on documents(person_id);
create index documents_case_idx on documents(case_kind, case_id);

-- Export approval: no automatic export of sensitive full documents. References
-- first; full documents only after explicit approval.
create table document_export_approvals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  export_kind text not null check (export_kind in
    ('ubm_export','public_record_disclosure','e_archive','exit_export')),
  export_reference uuid,
  requested_by uuid not null,
  approved_by uuid,
  decision text check (decision in ('approved','rejected')),
  decision_reason text,
  export_mode text not null default 'reference_only' check (export_mode in
    ('reference_only','redacted_document','full_document')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint approver_not_requester check (approved_by is null or approved_by <> requested_by)
);

create table document_access_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  actor_user_id uuid not null,
  access_kind text not null check (access_kind in ('open','download','export','redact','delete')),
  reason text,
  session_kind text not null default 'normal',
  occurred_at timestamptz not null default now()
);

create trigger document_access_events_no_update
  before update or delete on document_access_events
  for each row execute function app.reject_mutation();

-- Redaction jobs (executed by worker; engine abstraction in packages/redaction-engine)
create table document_redaction_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  requested_by uuid not null,
  redaction_plan jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in
    ('queued','running','completed','failed','cancelled')),
  redacted_document_id uuid references documents(id),
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table documents enable row level security;
alter table document_export_approvals enable row level security;
alter table document_access_events enable row level security;
alter table document_redaction_jobs enable row level security;
alter table storage_buckets_config enable row level security;

create policy documents_block_no_pii_sessions on documents
  as restrictive for all
  using (not app.is_no_pii_session());
