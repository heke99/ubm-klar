-- ============================================================================
-- 202607070028_ai_guardrails.sql
-- AI assistance with strict guardrails. AI never decides; output is always
-- suggestion-only with mandatory human review and source references.
-- ============================================================================

create table ai_model_configurations (
  id uuid primary key default gen_random_uuid(),
  config_key text not null unique,
  provider text not null check (provider in
    ('disabled','municipality_hosted','vendor_hosted_no_pii','vendor_hosted_pii_approved')),
  model_reference text,
  -- PII in prompts requires explicit municipal approval AND a data plane that supports it
  pii_in_prompts_allowed boolean not null default false,
  municipality_approval_reference text,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  check (pii_in_prompts_allowed = false or provider in ('municipality_hosted','vendor_hosted_pii_approved'))
);

create table ai_prompt_policy (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique,
  use_case text not null check (use_case in
    ('summarize_import_errors','explain_risk_flags','draft_internal_notes',
     'suggest_data_quality_fixes','explain_export_block','suggest_mapping_candidates',
     'draft_review_checklists','support_summary_no_pii')),
  allowed boolean not null default true,
  requires_no_pii_scan boolean not null default true,
  max_context_classification smallint not null default 1 check (max_context_classification between 0 and 3)
);

create table ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  use_case text not null,
  subject_kind text,
  subject_id uuid,
  model_config_key text references ai_model_configurations(config_key),
  suggestion_text text not null,
  marking text not null default 'suggestion_only' check (marking = 'suggestion_only'),
  requires_human_review boolean not null default true check (requires_human_review = true),
  confidence_level text not null check (confidence_level in ('low','medium','high')),
  created_for_user uuid,
  created_at timestamptz not null default now()
);

create table ai_source_references (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references ai_suggestions(id) on delete cascade,
  reference_kind text not null,
  reference text not null
);

create table ai_review_status (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references ai_suggestions(id) unique,
  status text not null default 'pending' check (status in
    ('pending','approved','rejected','edited_and_approved')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_comment text
);

create table ai_guardrail_flags (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid references ai_suggestions(id),
  flag_kind text not null check (flag_kind in
    ('pii_detected_in_prompt','pii_detected_in_output','forbidden_use_case',
     'protected_identity_context','classification_exceeded','missing_source_references',
     'attempted_decision_language')),
  detail text not null,
  blocked boolean not null default true,
  created_at timestamptz not null default now()
);

create table ai_assistance_logs (
  id uuid primary key default gen_random_uuid(),
  use_case text not null,
  actor_user_id uuid,
  suggestion_id uuid references ai_suggestions(id),
  action text not null check (action in ('generated','approved','rejected','blocked')),
  occurred_at timestamptz not null default now()
);

create trigger ai_assistance_logs_no_update
  before update or delete on ai_assistance_logs
  for each row execute function app.reject_mutation();

insert into ai_prompt_policy (policy_key, use_case, allowed, requires_no_pii_scan, max_context_classification) values
  ('p_import_errors','summarize_import_errors',true,true,1),
  ('p_risk_flags','explain_risk_flags',true,true,1),
  ('p_internal_notes','draft_internal_notes',true,true,1),
  ('p_dq_fixes','suggest_data_quality_fixes',true,true,1),
  ('p_export_block','explain_export_block',true,true,1),
  ('p_mapping','suggest_mapping_candidates',true,true,1),
  ('p_checklists','draft_review_checklists',true,true,1),
  ('p_support','support_summary_no_pii',true,true,0);

alter table ai_model_configurations enable row level security;
alter table ai_prompt_policy enable row level security;
alter table ai_suggestions enable row level security;
alter table ai_source_references enable row level security;
alter table ai_review_status enable row level security;
alter table ai_guardrail_flags enable row level security;
alter table ai_assistance_logs enable row level security;
