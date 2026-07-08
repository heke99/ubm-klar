-- ============================================================================
-- 202607070001_core_init.sql
-- Data plane core schema. This schema is deployed to ONE municipality's own
-- isolated database (Model B: vendor-hosted Supabase project per municipality,
-- Model C: municipality-owned). It is NOT a shared multi-tenant schema.
-- ============================================================================

create extension if not exists pgcrypto;

create schema if not exists app;

-- ----------------------------------------------------------------------------
-- Session context helpers. Work both on Supabase (auth.uid()) and plain
-- Postgres (set via `set_config('app.user_id', ..., true)` by the backend).
-- ----------------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('app.user_id', true), '')::uuid,
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  );
$$;

create or replace function app.current_roles() returns text[]
language sql stable as $$
  select coalesce(
    string_to_array(nullif(current_setting('app.roles', true), ''), ','),
    array[]::text[]
  );
$$;

create or replace function app.has_role(role_name text) returns boolean
language sql stable as $$
  select role_name = any(app.current_roles());
$$;

create or replace function app.is_no_pii_session() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('app.no_pii_session', true), '')::boolean, false);
$$;

-- Standard updated_at trigger
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Municipality profile (single row: the data plane belongs to ONE municipality)
-- ----------------------------------------------------------------------------
create table municipality_profile (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization_number text not null check (organization_number ~ '^\d{6}-\d{4}$'),
  county text,
  environment text not null check (environment in ('test','stage','prod','demo','local')),
  is_demo boolean not null default false,
  dpo_contact_reference text,
  security_officer_reference text,
  system_owner_reference text,
  ubm_contact_reference text,
  legal_contact_reference text,
  finance_contact_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index municipality_profile_single_row on municipality_profile ((true));

create trigger municipality_profile_updated_at
  before update on municipality_profile
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- Organizational structure
-- ----------------------------------------------------------------------------
create table committees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table departments (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid references committees(id),
  name text not null,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table units (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  name text not null,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Source systems and integration connections
-- ----------------------------------------------------------------------------
create table source_systems (
  id uuid primary key default gen_random_uuid(),
  system_key text not null unique,
  name text not null,
  vendor text,
  domain text not null check (domain in
    ('lss','economic_assistance','economy_payment','document','archive','hr','other')),
  owner_department_id uuid references departments(id),
  is_system_of_record boolean not null default false,
  data_quality_status text not null default 'unknown' check (data_quality_status in
    ('unknown','poor','acceptable','good','verified')),
  created_at timestamptz not null default now()
);

create table integration_connections (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references source_systems(id),
  connection_kind text not null check (connection_kind in
    ('csv','excel','json','xml','rest_api','sftp','sql_readonly','manual_upload',
     'scheduled_import','inera_gif_adapter','ubm_transport_adapter')),
  schedule_cron text,
  -- secrets live in the municipality secret store; this is a reference name only
  credential_reference text,
  status text not null default 'configured' check (status in
    ('configured','tested','active','failed','disabled')),
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Import batches (details per row in import engine tables, migration 0021+)
-- ----------------------------------------------------------------------------
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid references source_systems(id),
  connection_id uuid references integration_connections(id),
  import_kind text not null check (import_kind in
    ('persons','lss','economic_assistance','payments','payment_file','documents','other')),
  file_name text,
  file_hash_sha256 text,
  row_count integer,
  status text not null default 'received' check (status in
    ('received','parsing','validating','mapping','loaded','failed','partially_loaded','rejected')),
  error_summary text,
  imported_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table import_errors (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references import_batches(id) on delete cascade,
  row_number integer,
  error_code text not null,
  error_message text not null,
  raw_fragment_masked text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Persons and identifiers (municipal citizens; SENSITIVE)
-- ----------------------------------------------------------------------------
create table persons (
  id uuid primary key default gen_random_uuid(),
  -- personal identity number: stored once, access controlled + masked by default
  personal_identity_number text unique,
  is_synthetic boolean not null default false, -- demo data marker; true means fake person
  given_name text,
  family_name text,
  protected_identity boolean not null default false,
  protected_identity_level text check (protected_identity_level in
    ('sekretessmarkering','skyddad_folkbokforing','fingerade_personuppgifter')),
  is_minor boolean not null default false,
  date_of_birth date,
  deceased_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger persons_updated_at
  before update on persons
  for each row execute function app.set_updated_at();

create table person_identifiers (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id) on delete cascade,
  identifier_kind text not null check (identifier_kind in
    ('personnummer','samordningsnummer','reservnummer','source_system_id')),
  identifier_value text not null,
  source_system_id uuid references source_systems(id),
  valid_from date,
  valid_to date,
  unique (identifier_kind, identifier_value, source_system_id)
);

create table protected_identity_events (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id),
  event_kind text not null check (event_kind in ('marked','unmarked','level_changed','access_reviewed')),
  reason text not null,
  decided_by uuid,
  occurred_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Organizations (providers, landlords, employers) and their people
-- ----------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  organization_number text unique,
  name text not null,
  org_kind text not null check (org_kind in
    ('assistance_provider','landlord','employer','supplier','other')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table organization_representatives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  person_id uuid references persons(id),
  role text not null,
  valid_from date,
  valid_to date
);

create table contact_persons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  department_id uuid references departments(id),
  name text not null,
  email text,
  phone text,
  role text
);

-- ----------------------------------------------------------------------------
-- RLS foundation: enable RLS and deny-by-default on all sensitive tables.
-- Detailed grant policies come with 202607070010_rls_policies.sql.
-- ----------------------------------------------------------------------------
alter table persons enable row level security;
alter table person_identifiers enable row level security;
alter table protected_identity_events enable row level security;
alter table organizations enable row level security;
alter table organization_representatives enable row level security;
alter table contact_persons enable row level security;
alter table import_batches enable row level security;
alter table import_errors enable row level security;

-- Deny-by-default: with RLS enabled and no policy, nothing is visible.
-- A no-PII session must never read person tables even after later policies:
create policy persons_block_no_pii_sessions on persons
  as restrictive for all
  using (not app.is_no_pii_session());

create policy person_identifiers_block_no_pii_sessions on person_identifiers
  as restrictive for all
  using (not app.is_no_pii_session());
