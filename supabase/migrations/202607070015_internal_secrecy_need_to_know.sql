-- ============================================================================
-- 202607070015_internal_secrecy_need_to_know.sql
-- Inre sekretess: need-to-know access based on case assignment, department/unit
-- affiliation and recorded business need. Curiosity-browsing detection support.
-- ============================================================================

-- Explicit case-linked access grants (assignment = business need)
create table case_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  case_kind text not null check (case_kind in
    ('lss_case','economic_assistance_case','control_case','ubm_request','public_record_request')),
  case_id uuid not null,
  grant_kind text not null check (grant_kind in
    ('assigned_handler','supervisor','reviewer','legal_review','dpo_review','temporary')),
  reason text,
  granted_by uuid references user_profiles(id),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  revoked_at timestamptz,
  unique (user_id, case_kind, case_id, grant_kind)
);

create index case_access_grants_case_idx on case_access_grants(case_kind, case_id);

create or replace function app.has_case_access(p_case_kind text, p_case_id uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from case_access_grants g
    where g.user_id = app.current_user_id()
      and g.case_kind = p_case_kind
      and g.case_id = p_case_id
      and g.revoked_at is null
      and g.valid_from <= now()
      and (g.valid_to is null or g.valid_to > now())
  );
$$;

-- Time-limited access with recorded purpose (beyond standing case assignment)
create table purpose_bound_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  target_kind text not null,
  target_id uuid not null,
  purpose text not null check (length(purpose) >= 10),
  approved_by uuid references user_profiles(id),
  valid_from timestamptz not null default now(),
  valid_to timestamptz not null,
  created_at timestamptz not null default now()
);

-- Curiosity browsing detection: unusual person-record access patterns are
-- aggregated per user per day for DPO review (fed by data_access_events).
create table access_review_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  finding_kind text not null check (finding_kind in
    ('high_volume_person_access','off_hours_access','unrelated_department_access',
     'protected_identity_access_without_case','repeated_search_same_person',
     'access_without_case_assignment')),
  severity text not null check (severity in ('low','medium','high','critical')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  event_count integer not null,
  status text not null default 'open' check (status in
    ('open','reviewed_ok','escalated','confirmed_misuse')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- DPO access review report source
create or replace view dpo_access_review as
select
  dae.actor_user_id,
  dae.access_kind,
  count(*) as access_count,
  min(dae.occurred_at) as first_access,
  max(dae.occurred_at) as last_access,
  count(*) filter (where dae.reason is null) as accesses_without_reason
from data_access_events dae
group by dae.actor_user_id, dae.access_kind;

alter table case_access_grants enable row level security;
alter table purpose_bound_access enable row level security;
alter table access_review_findings enable row level security;
