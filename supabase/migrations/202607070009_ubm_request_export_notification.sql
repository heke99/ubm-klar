-- ============================================================================
-- 202607070009_ubm_request_export_notification.sql
-- UBM request manager, export proposals/submissions and notification inbox.
-- ============================================================================

create table ubm_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  intake_channel text not null check (intake_channel in
    ('manual_registration','file_upload','api_webhook','email_intake','official_transport')),
  external_reference text,
  received_at timestamptz not null,
  registered_by uuid,
  domain text check (domain in ('lss','economic_assistance','other','unknown')),
  status text not null default 'received' check (status in
    ('received','registered','validated','matching','data_collection','eligibility_review',
     'proposal_created','in_review','approved','exported','receipt_received','closed','rejected')),
  deadline_at date,
  legal_source_key text,
  legal_source_version text,
  obligation_key text,
  obligation_version text,
  created_at timestamptz not null default now()
);

create table ubm_request_subjects (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references ubm_requests(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('person','organization')),
  person_id uuid references persons(id),
  organization_id uuid references organizations(id),
  match_status text not null default 'unmatched' check (match_status in
    ('unmatched','matched','ambiguous','not_found','manual')),
  match_confidence numeric check (match_confidence between 0 and 1),
  matched_by uuid,
  matched_at timestamptz
);

create table ubm_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references ubm_requests(id) on delete cascade,
  item_key text not null,
  description text not null,
  requested_data_kind text not null,
  status text not null default 'pending' check (status in
    ('pending','data_found','no_data','blocked','answered')),
  answer_reference text
);

create table ubm_request_deadlines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references ubm_requests(id) on delete cascade,
  deadline_kind text not null check (deadline_kind in ('statutory','internal','extended')),
  due_at timestamptz not null,
  met boolean,
  note text
);

create table ubm_request_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references ubm_requests(id) on delete cascade,
  review_kind text not null check (review_kind in ('legal','dpo','export_manager','manual')),
  reviewer uuid,
  decision text check (decision in ('approved','rejected','needs_changes')),
  comment text,
  reviewed_at timestamptz
);

-- Export proposals and submissions
create table ubm_export_proposals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references ubm_requests(id),
  proposal_number text not null unique,
  domain text not null check (domain in ('lss','economic_assistance')),
  schema_key text not null,
  schema_version text not null,
  eligibility_outcome text not null,
  eligibility_outcomes text[] not null default '{}',
  eligibility_explanations text[] not null default '{}',
  status text not null default 'draft' check (status in
    ('draft','eligibility_blocked','in_review','approved','rejected','packaged','sent','receipt_received','closed')),
  created_by uuid,
  -- FK to approval_workflows added in 202607070019
  approval_workflow_id uuid,
  legal_source_key text,
  legal_source_version text,
  rule_set_version text,
  created_at timestamptz not null default now()
);

create table ubm_export_rows (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references ubm_export_proposals(id) on delete cascade,
  person_id uuid references persons(id),
  entity_kind text not null,
  entity_id uuid not null,
  payload jsonb not null,
  lineage_complete boolean not null default false,
  classification_checked boolean not null default false,
  included boolean not null default true,
  exclusion_reason text
);

create table ubm_export_documents (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references ubm_export_proposals(id) on delete cascade,
  document_id uuid not null references documents(id),
  export_mode text not null default 'reference_only' check (export_mode in
    ('reference_only','redacted_document','full_document')),
  export_approval_id uuid references document_export_approvals(id)
);

create table ubm_submissions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references ubm_export_proposals(id),
  submission_number text not null unique,
  package_manifest jsonb not null,
  manifest_hash_sha256 text not null,
  payload_hash_sha256 text not null,
  signature text,
  transport_profile text not null check (transport_profile in
    ('manual_download','sftp','api','ubm_official_transport_pending')),
  sent_by uuid,
  sent_at timestamptz,
  status text not null default 'packaged' check (status in
    ('packaged','approved','sent','delivered','failed','receipt_received')),
  created_at timestamptz not null default now()
);

create table ubm_receipts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references ubm_submissions(id),
  receipt_kind text not null check (receipt_kind in
    ('transport_receipt','processing_receipt','error_receipt','manual_confirmation')),
  receipt_reference text,
  receipt_hash_sha256 text,
  received_at timestamptz not null default now(),
  raw_receipt_document_id uuid references documents(id)
);

create table ubm_approval_logs (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references ubm_export_proposals(id),
  actor_user_id uuid not null,
  action text not null check (action in
    ('created','eligibility_evaluated','review_requested','approved','rejected','packaged','sent','receipt_registered')),
  detail text,
  occurred_at timestamptz not null default now()
);

create trigger ubm_approval_logs_no_update
  before update or delete on ubm_approval_logs
  for each row execute function app.reject_mutation();

-- Notification inbox
create table ubm_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_number text not null unique,
  intake_channel text not null check (intake_channel in
    ('manual_registration','file_upload','api_webhook','email_intake','official_transport')),
  received_at timestamptz not null,
  domain text check (domain in ('lss','economic_assistance','other','unknown')),
  subject_person_id uuid references persons(id),
  subject_organization_id uuid references organizations(id),
  summary text not null,
  status text not null default 'received' check (status in
    ('received','matching','manual_review','matched','case_created','investigating','outcome_registered','feedback_sent','closed')),
  control_case_id uuid references control_cases(id),
  created_at timestamptz not null default now()
);

create table ubm_notification_confidence_scores (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references ubm_notifications(id) on delete cascade,
  candidate_kind text not null check (candidate_kind in ('person','case','decision','payment')),
  candidate_id uuid not null,
  score numeric not null check (score between 0 and 1),
  score_basis text not null,
  selected boolean not null default false
);

create table ubm_notification_manual_reviews (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references ubm_notifications(id) on delete cascade,
  reviewer uuid,
  decision text check (decision in ('match_confirmed','match_rejected','no_match_found','needs_more_data')),
  selected_candidate_kind text,
  selected_candidate_id uuid,
  comment text,
  reviewed_at timestamptz
);

create table ubm_notification_outcomes (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references ubm_notifications(id),
  outcome text not null check (outcome in
    ('recovery_claim','payment_stopped','no_action','police_report','corrected_source_data','other_action')),
  detail text,
  decided_by uuid not null,
  decided_at timestamptz not null default now()
);

create table ubm_feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references ubm_notifications(id),
  feedback_reference text,
  content_summary text not null,
  sent_by uuid,
  sent_at timestamptz,
  status text not null default 'draft' check (status in ('draft','approved','sent','confirmed'))
);

do $$
declare t text;
begin
  foreach t in array array[
    'ubm_requests','ubm_request_subjects','ubm_request_items','ubm_request_deadlines',
    'ubm_request_reviews','ubm_export_proposals','ubm_export_rows','ubm_export_documents',
    'ubm_submissions','ubm_receipts','ubm_approval_logs','ubm_notifications',
    'ubm_notification_confidence_scores','ubm_notification_manual_reviews',
    'ubm_notification_outcomes','ubm_feedback_submissions'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
