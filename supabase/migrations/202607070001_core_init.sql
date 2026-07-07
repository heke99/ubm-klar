-- UBM Klar core initialization scaffold.
-- This migration is intentionally minimal and safe.
-- Cursor must expand this using expand-migrate-contract in later batches.

create extension if not exists pgcrypto;

create table if not exists public.municipality_profile (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  org_number text not null,
  deployment_model text not null check (deployment_model in (
    'model_b_vendor_hosted_isolated',
    'model_c1_municipality_supabase',
    'model_c2_self_hosted_supabase',
    'model_c3_postgres_separate_storage'
  )),
  environment text not null check (environment in ('test', 'stage', 'prod')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references public.municipality_profile(id) on delete cascade,
  name text not null,
  code text,
  created_at timestamptz not null default now()
);

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references public.municipality_profile(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  code text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_type text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  purpose text,
  legal_basis text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.data_access_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  person_id uuid,
  case_id uuid,
  data_category text not null,
  fields_accessed text[] not null default array[]::text[],
  purpose text not null,
  access_reason text,
  created_at timestamptz not null default now()
);

alter table public.municipality_profile enable row level security;
alter table public.departments enable row level security;
alter table public.units enable row level security;
alter table public.audit_logs enable row level security;
alter table public.data_access_logs enable row level security;

comment on table public.audit_logs is 'Audit log. Do not store PII in metadata.';
comment on table public.data_access_logs is 'Data access log for sensitive access events.';
