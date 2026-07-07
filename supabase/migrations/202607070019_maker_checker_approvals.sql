-- ============================================================================
-- 202607070019_maker_checker_approvals.sql
-- Maker-checker approval workflows. Mirrors @ubm-klar/approval-workflows.
-- ============================================================================

create table approval_workflows (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in
    ('ubm_export','document_export','payment_recipient_change','payment_stop','break_glass',
     'exit_export','e_archive_export','disposal_decision','go_live','rule_configuration_change')),
  subject_kind text not null,
  subject_id uuid not null,
  created_by uuid not null,
  status text not null default 'pending' check (status in
    ('pending','approved','rejected','returned_for_changes')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index approval_workflows_subject_idx on approval_workflows(subject_kind, subject_id);

create table approval_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references approval_workflows(id) on delete cascade,
  step_order integer not null,
  required_role text not null,
  decision text check (decision in ('approved','rejected','returned_for_changes')),
  decided_by uuid,
  decided_at timestamptz,
  comment text,
  unique (workflow_id, step_order)
);

-- DB-level maker-checker guard: approver can never be the workflow creator.
create or replace function app.enforce_maker_checker() returns trigger
language plpgsql as $$
declare
  v_created_by uuid;
begin
  if new.decision = 'approved' then
    select created_by into v_created_by from approval_workflows where id = new.workflow_id;
    if new.decided_by = v_created_by then
      raise exception 'maker-checker violation: creator cannot approve own workflow';
    end if;
    if exists (
      select 1 from approval_steps
      where workflow_id = new.workflow_id
        and id <> new.id
        and decision = 'approved'
        and decided_by = new.decided_by
    ) then
      raise exception 'maker-checker violation: same approver cannot approve multiple steps';
    end if;
  end if;
  return new;
end;
$$;

create trigger approval_steps_maker_checker
  before insert or update on approval_steps
  for each row execute function app.enforce_maker_checker();

-- Immutable decision log (audit)
create table approval_audit_log (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references approval_workflows(id),
  step_id uuid,
  actor_user_id uuid not null,
  action text not null check (action in ('created','approved','rejected','returned_for_changes','cancelled')),
  comment text,
  occurred_at timestamptz not null default now()
);

create trigger approval_audit_log_no_update
  before update or delete on approval_audit_log
  for each row execute function app.reject_mutation();

alter table approval_workflows enable row level security;
alter table approval_steps enable row level security;
alter table approval_audit_log enable row level security;

-- Deferred FKs from earlier migrations (tables created before approval_workflows existed)
alter table ubm_export_proposals
  add constraint ubm_export_proposals_workflow_fk
  foreign key (approval_workflow_id) references approval_workflows(id);
alter table support_access_sessions
  add constraint support_access_sessions_workflow_fk
  foreign key (approval_workflow_id) references approval_workflows(id);
alter table break_glass_sessions
  add constraint break_glass_sessions_workflow_fk
  foreign key (approval_workflow_id) references approval_workflows(id);
alter table retention_actions
  add constraint retention_actions_workflow_fk
  foreign key (approval_workflow_id) references approval_workflows(id);
alter table exit_exports
  add constraint exit_exports_workflow_fk
  foreign key (approval_workflow_id) references approval_workflows(id);
alter table disposal_decisions
  add constraint disposal_decisions_workflow_fk
  foreign key (approval_workflow_id) references approval_workflows(id);
alter table e_archive_export_packages
  add constraint e_archive_export_packages_workflow_fk
  foreign key (approval_workflow_id) references approval_workflows(id);
