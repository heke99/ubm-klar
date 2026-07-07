-- ============================================================================
-- 202607070003_audit_and_data_access_logs.sql
-- Append-only audit log and data access log. These logs stay in the
-- municipality's own data plane; vendor telemetry only ever receives no-PII
-- technical events.
-- ============================================================================

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  actor_user_id uuid,
  actor_role text,
  subject_kind text,          -- e.g. 'person','case','document','export','rule_config'
  subject_id uuid,
  action text not null,       -- e.g. 'create','update','approve','export','reveal'
  outcome text not null default 'success' check (outcome in ('success','denied','failed')),
  reason text,                -- required for sensitive reveals / break-glass
  context jsonb not null default '{}'::jsonb,
  correlation_id uuid,
  occurred_at timestamptz not null default now(),
  -- evidence chain: each event carries hash of the previous one
  previous_hash text,
  event_hash text
);

create index audit_events_subject_idx on audit_events(subject_kind, subject_id);
create index audit_events_actor_idx on audit_events(actor_user_id, occurred_at);
create index audit_events_key_idx on audit_events(event_key, occurred_at);

-- Append-only enforcement
create or replace function app.reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'table % is append-only', tg_table_name;
end;
$$;

create trigger audit_events_no_update
  before update or delete on audit_events
  for each row execute function app.reject_mutation();

create table data_access_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  actor_role text,
  access_kind text not null check (access_kind in
    ('person_search','person_record_open','case_open','document_open','document_download',
     'medical_data_view','protected_identity_view','children_data_view','income_view',
     'bank_account_view','sensitive_field_reveal','export_view','support_access','break_glass_access')),
  person_id uuid,
  case_kind text,
  case_id uuid,
  document_id uuid,
  field_key text,
  reason text,
  purpose text,
  business_need_reference text,
  session_kind text not null default 'normal' check (session_kind in
    ('normal','support_jit','break_glass')),
  occurred_at timestamptz not null default now()
);

create index data_access_events_actor_idx on data_access_events(actor_user_id, occurred_at);
create index data_access_events_person_idx on data_access_events(person_id, occurred_at);

create trigger data_access_events_no_update
  before update or delete on data_access_events
  for each row execute function app.reject_mutation();

-- Sensitive field reveal log (reason-required reveal of masked fields)
create table sensitive_field_reveals (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  person_id uuid,
  entity_kind text not null,
  entity_id uuid not null,
  field_key text not null,
  data_class text not null,
  reason text not null check (length(reason) >= 10),
  revealed_at timestamptz not null default now()
);

create trigger sensitive_field_reveals_no_update
  before update or delete on sensitive_field_reveals
  for each row execute function app.reject_mutation();

alter table audit_events enable row level security;
alter table data_access_events enable row level security;
alter table sensitive_field_reveals enable row level security;
