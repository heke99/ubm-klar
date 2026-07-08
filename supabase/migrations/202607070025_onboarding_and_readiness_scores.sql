-- ============================================================================
-- 202607070025_onboarding_and_readiness_scores.sql
-- Municipal onboarding program and readiness scores (data plane copy;
-- aggregate progress without PII is mirrored to the control plane).
-- ============================================================================

create table onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in
    ('organisation','deployment','authentication','source_systems','data_mapping',
     'payment_control','ubm_readiness','go_live')),
  step_key text not null unique,
  title_sv text not null,
  description_sv text not null,
  step_order integer not null,
  required boolean not null default true
);

create table onboarding_progress (
  id uuid primary key default gen_random_uuid(),
  step_key text not null references onboarding_steps(step_key),
  status text not null default 'not_started' check (status in
    ('not_started','in_progress','completed','blocked','skipped','not_applicable')),
  completed_by uuid references user_profiles(id),
  completed_at timestamptz,
  note text,
  unique (step_key)
);

create table onboarding_blockers (
  id uuid primary key default gen_random_uuid(),
  step_key text references onboarding_steps(step_key),
  title text not null,
  description text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  owner uuid references user_profiles(id),
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table onboarding_evidence (
  id uuid primary key default gen_random_uuid(),
  step_key text not null references onboarding_steps(step_key),
  evidence_kind text not null check (evidence_kind in
    ('document','test_run','attestation','configuration','external_reference')),
  reference text not null,
  document_id uuid references documents(id),
  added_by uuid,
  added_at timestamptz not null default now()
);

create table onboarding_assignments (
  id uuid primary key default gen_random_uuid(),
  step_key text not null references onboarding_steps(step_key),
  assigned_to uuid not null references user_profiles(id),
  assigned_by uuid references user_profiles(id),
  assigned_at timestamptz not null default now()
);

create table onboarding_readiness_scores (
  id uuid primary key default gen_random_uuid(),
  score_key text not null check (score_key in
    ('ubm_readiness','data_quality','source_system_mapping','payment_control_readiness',
     'legal_dpo_readiness','security_readiness','archive_readiness','production_readiness')),
  score numeric not null check (score between 0 and 100),
  basis jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

create table onboarding_recommendations (
  id uuid primary key default gen_random_uuid(),
  score_key text not null,
  recommendation_sv text not null,
  priority text not null check (priority in ('low','medium','high','critical')),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table onboarding_steps enable row level security;
alter table onboarding_progress enable row level security;
alter table onboarding_blockers enable row level security;
alter table onboarding_evidence enable row level security;
alter table onboarding_assignments enable row level security;
alter table onboarding_readiness_scores enable row level security;
alter table onboarding_recommendations enable row level security;
