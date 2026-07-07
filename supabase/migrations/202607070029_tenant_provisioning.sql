-- ============================================================================
-- 202607070029_tenant_provisioning.sql
-- Data-plane-side provisioning/environment metadata. The authoritative
-- provisioning state lives in the vendor control plane (no PII); this local
-- copy lets the data plane verify its own identity and environment.
-- ============================================================================

create table data_plane_identity (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null,
  environment text not null check (environment in ('test','stage','prod','demo','local')),
  deployment_mode text not null check (deployment_mode in
    ('model_b_vendor_hosted_isolated',
     'model_c1_municipality_managed_supabase',
     'model_c2_self_hosted_supabase',
     'model_c3_postgres_separate_storage',
     'local_demo_shared')),
  provisioned_at timestamptz not null default now(),
  release_version text,
  -- demo data may only be seeded when this is true
  demo_data_allowed boolean not null default false,
  check (demo_data_allowed = false or environment in ('demo','test','local'))
);

create unique index data_plane_identity_single_row on data_plane_identity ((true));

-- Shared production databases are structurally forbidden.
alter table data_plane_identity
  add constraint no_shared_prod check (
    not (deployment_mode = 'local_demo_shared' and environment in ('stage','prod'))
  );

create table environment_checks (
  id uuid primary key default gen_random_uuid(),
  check_key text not null,
  status text not null check (status in ('passed','failed','skipped')),
  detail text,
  checked_at timestamptz not null default now()
);

alter table data_plane_identity enable row level security;
alter table environment_checks enable row level security;
