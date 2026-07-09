-- 202607070033_import_staging.sql
-- Import pipeline staging: raw + mapped rows between upload and commit.
-- Rows are removed on rollback and kept (with committed entity references,
-- forming row-level lineage) after commit.

create table import_staging_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references import_batches(id) on delete cascade,
  row_number integer not null,
  raw jsonb not null,
  mapped jsonb,
  errors text[] not null default '{}',
  warnings text[] not null default '{}',
  committed_entity_kind text,
  committed_entity_id uuid,
  created_at timestamptz not null default now(),
  unique (batch_id, row_number)
);

create index import_staging_rows_batch_idx on import_staging_rows(batch_id);

create table import_mappings (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references import_batches(id) on delete cascade unique,
  import_type_key text not null,
  source_system_key text not null,
  mapping jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table import_staging_rows enable row level security;
alter table import_mappings enable row level security;

comment on table import_staging_rows is
  'Staged import rows (raw + mapped). May contain PII; access is backend-only via service role and logged.';
comment on table import_mappings is
  'Column mapping chosen per import batch (no PII).';
