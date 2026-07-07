-- ============================================================================
-- 202607070002_auth_and_access_control.sql
-- Identity providers, users, roles, permissions, scopes.
-- Primary production auth: municipality Entra ID / SAML / OIDC. Supabase Auth is
-- fallback only (demo, local, break-glass, selected pilots).
-- ============================================================================

create table identity_providers (
  id uuid primary key default gen_random_uuid(),
  provider_kind text not null check (provider_kind in ('entra_id','saml','oidc','supabase_auth')),
  display_name text not null,
  issuer_url text,
  metadata_url text,
  is_primary boolean not null default false,
  mfa_enforced_by_idp boolean not null default false,
  allowed_for_production boolean not null default false,
  status text not null default 'configured' check (status in
    ('configured','tested','active','failed','disabled')),
  created_at timestamptz not null default now()
);

create table user_profiles (
  id uuid primary key default gen_random_uuid(),
  -- Supabase auth.users.id or backend-issued subject id
  subject_id text not null unique,
  display_name text not null,
  email text not null unique,
  department_id uuid references departments(id),
  unit_id uuid references units(id),
  employment_reference text,
  is_active boolean not null default true,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_profiles_updated_at
  before update on user_profiles
  for each row execute function app.set_updated_at();

create table external_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  provider_id uuid not null references identity_providers(id),
  external_subject text not null,
  external_groups text[] not null default '{}',
  last_login_at timestamptz,
  unique (provider_id, external_subject)
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique,
  display_name_sv text not null,
  description_sv text not null,
  is_no_pii_role boolean not null default false,
  is_break_glass boolean not null default false,
  created_at timestamptz not null default now()
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique,
  description text not null
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- Maps IdP groups/claims to local roles (configured per identity provider).
create table role_mappings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references identity_providers(id) on delete cascade,
  claim_name text not null default 'groups',
  claim_value text not null,
  role_id uuid not null references roles(id),
  department_id uuid references departments(id),
  unit_id uuid references units(id),
  created_at timestamptz not null default now(),
  unique (provider_id, claim_name, claim_value, role_id)
);

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  role_id uuid not null references roles(id),
  department_id uuid references departments(id),
  unit_id uuid references units(id),
  granted_by uuid references user_profiles(id),
  granted_reason text,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  unique (user_id, role_id, department_id, unit_id)
);

-- ABAC scopes: fine-grained attribute constraints attached to a user
create table access_scopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  scope_kind text not null check (scope_kind in
    ('module','case_type','committee','department','unit','data_class','purpose')),
  scope_value text not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  granted_by uuid references user_profiles(id)
);

create index access_scopes_user_idx on access_scopes(user_id, scope_kind);

alter table user_profiles enable row level security;
alter table external_identities enable row level security;
alter table user_roles enable row level security;
alter table access_scopes enable row level security;
alter table role_mappings enable row level security;
