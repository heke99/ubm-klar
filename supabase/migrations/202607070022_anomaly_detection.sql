-- ============================================================================
-- 202607070022_anomaly_detection.sql
-- Privacy/security anomaly detection: rules, events and review cases.
-- ============================================================================

create table anomaly_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  category text not null check (category in ('privacy','security','payment','data_quality')),
  title text not null,
  description text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  parameters jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  created_at timestamptz not null default now()
);

create table anomaly_events (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null references anomaly_rules(rule_key),
  category text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  subject_kind text not null,
  subject_id uuid,
  actor_user_id uuid,
  explanation text not null,
  window_start timestamptz,
  window_end timestamptz,
  event_count integer,
  status text not null default 'open' check (status in
    ('open','under_review','confirmed','dismissed')),
  review_case_id uuid,
  detected_at timestamptz not null default now()
);

create index anomaly_events_rule_idx on anomaly_events(rule_key, detected_at);
create index anomaly_events_actor_idx on anomaly_events(actor_user_id, detected_at);

create table anomaly_review_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  category text not null,
  severity text not null,
  assigned_to uuid references user_profiles(id),
  status text not null default 'open' check (status in
    ('open','investigating','resolved_ok','resolved_misuse','escalated')),
  resolution_note text,
  control_case_id uuid references control_cases(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table anomaly_events
  add constraint anomaly_events_review_case_fk
  foreign key (review_case_id) references anomaly_review_cases(id);

insert into anomaly_rules (rule_key, category, title, description, severity) values
  ('privacy_high_volume_person_access','privacy','Hög volym personåtkomster','Ovanligt många personposter öppnade av samma användare.','medium'),
  ('privacy_off_hours_access','privacy','Åtkomst utanför kontorstid','Känsliga åtkomster utanför kontorstid.','medium'),
  ('privacy_repeated_search_same_person','privacy','Upprepade sökningar på samma person','Samma person söks upprepade gånger utan ärendekoppling.','high'),
  ('privacy_protected_identity_access','privacy','Åtkomst till skyddad identitet utan ärende','Skyddade personuppgifter utan ärendekoppling.','critical'),
  ('security_failed_authorization_burst','security','Många nekade åtkomstförsök','Upprepade nekade behörighetsförsök från samma användare.','high'),
  ('security_role_change_burst','security','Ovanligt många rolländringar','Många rolländringar på kort tid.','high'),
  ('payment_recipient_change_burst','payment','Många mottagarändringar','Ovanligt många kontoändringar nära utbetalningar.','high'),
  ('security_break_glass_without_incident','security','Break-glass utan incidentreferens','Break-glass-session utan kopplad incident.','high');

alter table anomaly_rules enable row level security;
alter table anomaly_events enable row level security;
alter table anomaly_review_cases enable row level security;
