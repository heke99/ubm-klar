-- Tenant provisioning tracking (no PII). Mirrors ProvisioningService semantics.

create table tenant_provisioning_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  target_environments text[] not null,
  modules text[] not null,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table tenant_provisioning_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tenant_provisioning_runs(id) on delete cascade,
  step_id text not null,
  step_name text not null,
  step_order integer not null,
  status text not null default 'pending' check (status in
    ('pending','running','succeeded','failed','skipped')),
  note_no_pii text,
  finished_at timestamptz,
  unique (run_id, step_id)
);

create table tenant_domain_verifications (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references tenant_domains(id) on delete cascade,
  method text not null check (method in ('dns_txt','http_well_known','manual_attestation')),
  challenge text not null,
  status text not null default 'pending' check (status in ('pending','verified','failed','expired')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table tenant_data_plane_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  connection_kind text not null check (connection_kind in
    ('vendor_hosted_supabase','municipality_managed_supabase','self_hosted_supabase','plain_postgres')),
  -- connection references point into the tenant's own secret store; never credentials
  connection_reference text not null,
  status text not null default 'unverified' check (status in ('unverified','verified','failed','disabled')),
  verified_at timestamptz,
  unique (tenant_id, environment)
);

create table tenant_environment_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  check_id text not null,
  status text not null check (status in ('passed','failed','skipped')),
  error_code text,
  checked_at timestamptz not null default now()
);

create table tenant_backup_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  backup_kind text not null check (backup_kind in ('database','storage')),
  status text not null check (status in ('configured','verified','failed')),
  last_backup_at timestamptz,
  checked_at timestamptz not null default now()
);

create table tenant_restore_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  status text not null check (status in ('passed','failed')),
  duration_seconds integer,
  tested_at timestamptz not null default now()
);

create table tenant_sso_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  provider_kind text not null,
  mfa_verified boolean not null default false,
  group_mapping_verified boolean not null default false,
  status text not null check (status in ('passed','failed')),
  tested_at timestamptz not null default now()
);

create table tenant_rls_test_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  release_version text not null,
  tests_total integer not null,
  tests_passed integer not null,
  status text not null check (status in ('passed','failed')),
  tested_at timestamptz not null default now()
);

create table tenant_smoke_test_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  release_version text not null,
  tests_total integer not null,
  tests_passed integer not null,
  status text not null check (status in ('passed','failed')),
  tested_at timestamptz not null default now()
);
