-- ============================================================================
-- 202607070013_support_access_and_break_glass.sql
-- Support-mode without PII (JIT access) and break-glass emergency sessions.
-- ============================================================================

create table support_access_sessions (
  id uuid primary key default gen_random_uuid(),
  support_case_reference text not null, -- control-plane ticket id (no PII)
  requested_by_support_user text not null,
  approved_by uuid references user_profiles(id),
  approval_workflow_id uuid references approval_workflows(id),
  scope text not null check (scope in
    ('technical_status','import_status','integration_status','queue_status','schema_errors','logs_no_pii')),
  reason text not null check (length(reason) >= 10),
  pii_access boolean not null default false check (pii_access = false),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  check (expires_at > starts_at),
  check (expires_at <= starts_at + interval '8 hours')
);

create table support_access_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references support_access_sessions(id),
  event_kind text not null,
  detail_no_pii text,
  occurred_at timestamptz not null default now()
);

create trigger support_access_events_no_update
  before update or delete on support_access_events
  for each row execute function app.reject_mutation();

create table break_glass_sessions (
  id uuid primary key default gen_random_uuid(),
  initiated_by uuid not null references user_profiles(id),
  reason text not null check (length(reason) >= 20),
  incident_reference text,
  approval_workflow_id uuid references approval_workflows(id),
  scope text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  post_review_status text not null default 'pending' check (post_review_status in
    ('pending','under_review','approved','misuse_confirmed')),
  post_reviewed_by uuid references user_profiles(id),
  post_reviewed_at timestamptz,
  check (expires_at > starts_at),
  check (expires_at <= starts_at + interval '4 hours')
);

create table break_glass_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references break_glass_sessions(id),
  event_kind text not null,
  subject_kind text,
  subject_id uuid,
  detail text,
  occurred_at timestamptz not null default now()
);

create trigger break_glass_events_no_update
  before update or delete on break_glass_events
  for each row execute function app.reject_mutation();

alter table support_access_sessions enable row level security;
alter table support_access_events enable row level security;
alter table break_glass_sessions enable row level security;
alter table break_glass_events enable row level security;
