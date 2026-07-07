-- ============================================================================
-- 202607070021_system_of_record_data_lineage.sql
-- System-of-record tracking, source record links, data conflicts,
-- reconciliation statuses and data lineage. Every field used in a UBM export
-- or payment control decision must be traceable to its source.
-- ============================================================================

create table system_of_record_definitions (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null,          -- e.g. 'lss_decision','ea_income','payment'
  field_key text,                     -- null = whole entity
  source_system_id uuid not null references source_systems(id),
  valid_from date not null default current_date,
  valid_to date,
  motivation text,
  unique (entity_kind, field_key, source_system_id, valid_from)
);

create table source_record_links (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null,
  entity_id uuid not null,
  source_system_id uuid not null references source_systems(id),
  source_record_id text not null,
  import_batch_id uuid references import_batches(id),
  record_hash_sha256 text,
  linked_at timestamptz not null default now(),
  unique (entity_kind, entity_id, source_system_id, source_record_id)
);

create index source_record_links_entity_idx on source_record_links(entity_kind, entity_id);

create table data_conflicts (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null,
  entity_id uuid not null,
  field_key text not null,
  source_a_system_id uuid not null references source_systems(id),
  source_b_system_id uuid not null references source_systems(id),
  value_a_masked text,
  value_b_masked text,
  detected_at timestamptz not null default now(),
  resolution_status text not null default 'open' check (resolution_status in
    ('open','resolved_source_a','resolved_source_b','resolved_manual','escalated')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text
);

create table reconciliation_statuses (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null,
  entity_id uuid not null,
  status text not null check (status in
    ('reconciled','pending','conflict','failed','not_applicable')),
  last_reconciled_at timestamptz,
  detail text,
  unique (entity_kind, entity_id)
);

create table data_lineage_records (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null,
  entity_id uuid not null,
  field_key text not null,
  source_system_id uuid references source_systems(id),
  source_record_link_id uuid references source_record_links(id),
  import_batch_id uuid references import_batches(id),
  transformation text,               -- e.g. 'direct','mapped:code_list_v2','calculated:norm_v3'
  used_in_decision boolean not null default false,
  used_in_payment boolean not null default false,
  lineage_complete boolean not null default false,
  recorded_at timestamptz not null default now()
);

create index data_lineage_entity_idx on data_lineage_records(entity_kind, entity_id, field_key);

-- Hashes for evidence chain
create table record_hashes (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null,
  entity_id uuid not null,
  hash_sha256 text not null,
  hashed_at timestamptz not null default now(),
  unique (entity_kind, entity_id, hash_sha256)
);

create table export_hashes (
  id uuid primary key default gen_random_uuid(),
  export_kind text not null,
  export_id uuid not null,
  manifest_hash_sha256 text not null,
  payload_hash_sha256 text not null,
  signature text,
  hashed_at timestamptz not null default now()
);

alter table system_of_record_definitions enable row level security;
alter table source_record_links enable row level security;
alter table data_conflicts enable row level security;
alter table reconciliation_statuses enable row level security;
alter table data_lineage_records enable row level security;
alter table record_hashes enable row level security;
alter table export_hashes enable row level security;
