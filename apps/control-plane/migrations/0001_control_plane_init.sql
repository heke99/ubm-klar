-- Control plane schema. HARD RULE: no municipal personal data, ever.
-- Only tenant metadata, technical status, licensing and no-PII operational data.

create extension if not exists pgcrypto;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  municipality_name text not null,
  organization_number text not null check (organization_number ~ '^\d{6}-\d{4}$'),
  deployment_mode text not null check (deployment_mode in (
    'model_b_vendor_hosted_isolated',
    'model_c1_municipality_managed_supabase',
    'model_c2_self_hosted_supabase',
    'model_c3_postgres_separate_storage',
    'local_demo_shared'
  )),
  status text not null default 'prospect' check (status in
    ('prospect','onboarding','pilot','live','suspended','offboarding','exited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  domain text not null unique,
  environment text not null check (environment in ('test','stage','prod','demo','local')),
  domain_model text not null check (domain_model in ('model_b_subdomain','model_c_municipality_domain')),
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table tenant_environments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null check (environment in ('test','stage','prod','demo','local')),
  data_plane_url text not null,
  -- publishable (anon) key reference only; service-role keys are NEVER stored here
  publishable_key_reference text,
  status text not null default 'provisioning' check (status in
    ('provisioning','ready','degraded','disabled')),
  created_at timestamptz not null default now(),
  unique (tenant_id, environment)
);

create table tenant_modules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  module_id text not null,
  enabled boolean not null default false,
  enabled_at timestamptz,
  unique (tenant_id, module_id)
);

create table tenant_auth_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  provider_kind text not null check (provider_kind in ('entra_id','saml','oidc','supabase_auth')),
  is_primary boolean not null default false,
  -- metadata endpoints only; client secrets live in the tenant's own secret store
  issuer_url text,
  metadata_url text,
  status text not null default 'configured' check (status in ('configured','tested','failed','disabled')),
  created_at timestamptz not null default now()
);

create table release_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name in ('stable','candidate','pilot')),
  description text not null
);

create table release_artifacts (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  channel text not null references release_channels(name),
  manifest jsonb not null,
  checksum_sha256 text not null,
  signature text,
  released_at timestamptz not null default now()
);

create table tenant_release_status (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  current_version text,
  target_version text,
  status text not null default 'up_to_date' check (status in
    ('up_to_date','update_available','updating','failed','rolled_back')),
  updated_at timestamptz not null default now(),
  unique (tenant_id, environment)
);

create table migration_runs_no_pii (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  release_version text not null,
  migration_name text not null,
  phase text not null check (phase in ('preflight','dry_run','apply','smoke_test','rollback')),
  status text not null check (status in ('pending','running','succeeded','failed','skipped')),
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table tenant_support_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,
  category text not null check (category in
    ('technical','import','integration','release','access','billing','other')),
  severity text not null check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in
    ('open','in_progress','waiting_on_municipality','resolved','closed')),
  -- descriptions are validated no-PII at the API boundary before insert
  description_no_pii text not null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tenant_production_readiness (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  gate_id text not null,
  gate_name text not null,
  required boolean not null default true,
  status text not null default 'not_started' check (status in
    ('not_started','in_progress','passed','failed','waived')),
  evidence_reference text, -- reference into the tenant's own data plane, never content
  updated_at timestamptz not null default now(),
  unique (tenant_id, gate_id)
);

create table tenant_feature_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  flag_key text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (tenant_id, environment, flag_key)
);

create table tenant_health_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null,
  check_id text not null,
  status text not null check (status in ('healthy','degraded','down','unknown')),
  latency_ms integer,
  error_code text,
  checked_at timestamptz not null default now()
);

create table tenant_onboarding_progress (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  stage text not null,
  step text not null,
  status text not null default 'not_started' check (status in
    ('not_started','in_progress','completed','blocked','skipped')),
  updated_at timestamptz not null default now(),
  unique (tenant_id, stage, step)
);

create table tenant_onboarding_blockers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  stage text not null,
  title text not null,
  description_no_pii text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  name text not null,
  description text not null,
  is_active boolean not null default true
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_key text not null references plans(plan_key),
  status text not null default 'active' check (status in
    ('trial','active','past_due','cancelled','expired')),
  starts_at date not null,
  ends_at date,
  created_at timestamptz not null default now()
);

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entitlement_key text not null,
  value jsonb not null default 'true'::jsonb,
  source text not null default 'subscription' check (source in ('subscription','manual','trial')),
  expires_at timestamptz,
  unique (tenant_id, entitlement_key)
);

create table usage_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  metric_key text not null,
  period_start date not null,
  period_end date not null,
  -- aggregate counts only, never row-level municipal data
  value numeric not null,
  created_at timestamptz not null default now()
);

create table billing_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_type text not null,
  amount_sek numeric,
  reference text,
  occurred_at timestamptz not null default now()
);

create table implementation_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  package_key text not null,
  status text not null default 'planned' check (status in
    ('planned','running','on_hold','completed','cancelled')),
  started_at date,
  completed_at date
);

create table support_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  package_key text not null,
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  starts_at date not null,
  ends_at date
);

-- Versioned regulatory metadata distributed to tenants (definitions only, no data).
create table legal_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  version text not null,
  title text not null,
  url text,
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  unique (source_key, version)
);

create table ubm_schema_versions_control (
  id uuid primary key default gen_random_uuid(),
  schema_key text not null,
  version text not null,
  domain text not null check (domain in ('lss','economic_assistance','common')),
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  definition jsonb not null default '{}'::jsonb,
  effective_from date,
  created_at timestamptz not null default now(),
  unique (schema_key, version)
);

create table ubm_obligation_versions_control (
  id uuid primary key default gen_random_uuid(),
  obligation_key text not null,
  version text not null,
  obligation_kind text not null check (obligation_kind in ('request_based','recurring_reporting')),
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  legal_source_key text,
  legal_source_version text,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  unique (obligation_key, version)
);

insert into release_channels (name, description) values
  ('stable', 'Production-approved releases'),
  ('candidate', 'Release candidates in stage validation'),
  ('pilot', 'Early pilot builds for selected tenants');
