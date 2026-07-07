-- UBM Klar control-plane scaffold.
-- This schema must not contain municipal personal data.

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  org_number text not null,
  deployment_mode text not null,
  status text not null default 'onboarding',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  domain text not null unique,
  environment text not null check (environment in ('test', 'stage', 'prod')),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_modules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  module_code text not null,
  enabled boolean not null default false,
  enabled_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  unique (tenant_id, module_code)
);

create table if not exists public.tenant_production_readiness (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  environment text not null check (environment in ('test', 'stage', 'prod')),
  gate_code text not null,
  status text not null default 'not_started',
  evidence_reference_no_pii text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, environment, gate_code)
);

comment on table public.tenants is 'Control-plane tenant registry. No citizen PII allowed.';
comment on table public.tenant_domains is 'Control-plane domain registry. No citizen PII allowed.';
comment on table public.tenant_modules is 'Control-plane module entitlements. No citizen PII allowed.';
comment on table public.tenant_production_readiness is 'Control-plane production readiness gates. Evidence references must not contain PII.';
