-- ============================================================================
-- 202607070008_ubm_schema_registry.sql
-- UBM schema registry: versioned dataset schemas, field definitions, code
-- lists, validation rules and mappings. NO final official UBM format is
-- hardcoded; schemas carry statuses and effective dates, and Phase 2 schemas
-- remain awaiting_official_specification until published.
-- ============================================================================

create table ubm_schemas (
  id uuid primary key default gen_random_uuid(),
  schema_key text not null unique,
  title text not null,
  domain text not null check (domain in ('lss','economic_assistance','common')),
  obligation_kind text not null check (obligation_kind in ('request_based','recurring_reporting')),
  description text
);

create table ubm_schema_versions (
  id uuid primary key default gen_random_uuid(),
  schema_key text not null references ubm_schemas(schema_key),
  version text not null,
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  effective_from date,
  effective_to date,
  legal_source_key text,
  legal_source_version text,
  transport_profile text check (transport_profile in
    ('manual_download','sftp','api','ubm_official_transport_pending')),
  transport_approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (schema_key, version)
);

create table ubm_schema_fields (
  id uuid primary key default gen_random_uuid(),
  schema_version_id uuid not null references ubm_schema_versions(id) on delete cascade,
  field_key text not null,
  title text not null,
  data_type text not null check (data_type in
    ('string','integer','decimal','date','boolean','code','personal_identity_number','org_number','amount_sek')),
  required boolean not null default false,
  code_list_key text,
  max_length integer,
  data_class text,
  description text,
  unique (schema_version_id, field_key)
);

create table ubm_code_lists (
  id uuid primary key default gen_random_uuid(),
  code_list_key text not null,
  version text not null,
  title text not null,
  codes jsonb not null default '[]'::jsonb,
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  unique (code_list_key, version)
);

create table ubm_schema_validation_rules (
  id uuid primary key default gen_random_uuid(),
  schema_version_id uuid not null references ubm_schema_versions(id) on delete cascade,
  rule_key text not null,
  rule_kind text not null check (rule_kind in
    ('required','format','range','code_list','cross_field','custom')),
  expression jsonb not null default '{}'::jsonb,
  error_message_sv text not null,
  unique (schema_version_id, rule_key)
);

-- Field mappings: canonical municipal fields -> UBM schema fields
create table ubm_field_mappings (
  id uuid primary key default gen_random_uuid(),
  schema_version_id uuid not null references ubm_schema_versions(id) on delete cascade,
  ubm_field_key text not null,
  source_entity_kind text not null,
  source_field_key text not null,
  transformation text,
  mapping_status text not null default 'draft' check (mapping_status in
    ('draft','reviewed','approved','needs_fix')),
  approved_by uuid,
  approved_at timestamptz,
  unique (schema_version_id, ubm_field_key)
);

-- Seed: internal working schemas (NOT official UBM formats).
insert into ubm_schemas (schema_key, title, domain, obligation_kind, description) values
  ('ubm_request_response_lss', 'Svar på UBM-förfrågan – LSS', 'lss', 'request_based',
   'Internt arbetsformat för svar på förfrågningar. Ersätts/valideras mot officiellt format när sådant finns.'),
  ('ubm_request_response_ea', 'Svar på UBM-förfrågan – Ekonomiskt bistånd', 'economic_assistance', 'request_based',
   'Internt arbetsformat för svar på förfrågningar.'),
  ('ubm_recurring_lss', 'Återkommande rapportering – LSS (2029)', 'lss', 'recurring_reporting',
   'Platshållare. Officiellt format ej publicerat.'),
  ('ubm_recurring_ea', 'Återkommande rapportering – Ekonomiskt bistånd (2029)', 'economic_assistance', 'recurring_reporting',
   'Platshållare. Officiellt format ej publicerat.');

insert into ubm_schema_versions (schema_key, version, status, effective_from, legal_source_key, legal_source_version, transport_profile, transport_approved) values
  ('ubm_request_response_lss', '1.0.0', 'active', '2026-07-01', 'lag_2023_456_uppgiftsskyldighet', '2026-07-01', 'manual_download', true),
  ('ubm_request_response_ea', '1.0.0', 'active', '2026-07-01', 'lag_2023_456_uppgiftsskyldighet', '2026-07-01', 'manual_download', true),
  ('ubm_recurring_lss', '0.0.1', 'awaiting_official_specification', '2029-07-01', 'lag_2023_456_uppgiftsskyldighet', '2029-07-01', 'ubm_official_transport_pending', false),
  ('ubm_recurring_ea', '0.0.1', 'awaiting_official_specification', '2029-07-01', 'lag_2023_456_uppgiftsskyldighet', '2029-07-01', 'ubm_official_transport_pending', false);

alter table ubm_schemas enable row level security;
alter table ubm_schema_versions enable row level security;
alter table ubm_schema_fields enable row level security;
alter table ubm_code_lists enable row level security;
alter table ubm_schema_validation_rules enable row level security;
alter table ubm_field_mappings enable row level security;
