-- ============================================================================
-- 202607070005_lss_domain.sql
-- LSS / personal assistance domain model.
-- ============================================================================

create table lss_person_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id) unique,
  department_id uuid references departments(id),
  primary_case_worker uuid references user_profiles(id),
  created_at timestamptz not null default now()
);

create table lss_personkreis_assessments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id),
  personkreis smallint not null check (personkreis in (1,2,3)),
  assessed_by uuid references user_profiles(id),
  assessed_at date not null,
  basis_summary text,
  valid_from date not null,
  valid_to date
);

create table lss_applications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id),
  application_number text not null unique,
  insats_kind text not null check (insats_kind in
    ('personlig_assistans','ledsagarservice','kontaktperson','avlosarservice',
     'korttidsvistelse','korttidstillsyn','boende_barn','boende_vuxna','daglig_verksamhet')),
  received_at date not null,
  status text not null default 'received' check (status in
    ('received','under_investigation','decided','withdrawn','appealed')),
  department_id uuid references departments(id),
  created_at timestamptz not null default now()
);

create table lss_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references lss_applications(id) on delete cascade,
  document_id uuid not null references documents(id),
  document_role text not null check (document_role in
    ('application_form','medical_certificate','power_of_attorney','need_description','other'))
);

create table lss_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references lss_applications(id),
  person_id uuid not null references persons(id),
  decision_number text not null unique,
  insats_kind text not null,
  decision_kind text not null check (decision_kind in ('approval','partial_approval','rejection','termination')),
  decided_by uuid references user_profiles(id),
  decided_at date not null,
  status text not null default 'active' check (status in
    ('active','expired','terminated','superseded','appealed')),
  legal_basis text not null default 'LSS 9 §',
  created_at timestamptz not null default now()
);

create table lss_decision_periods (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references lss_decisions(id) on delete cascade,
  period_start date not null,
  period_end date,
  check (period_end is null or period_end >= period_start)
);

create table lss_decision_hours (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references lss_decisions(id) on delete cascade,
  period_id uuid references lss_decision_periods(id),
  hours_per_week numeric not null check (hours_per_week >= 0),
  hours_kind text not null check (hours_kind in ('basic_needs','other_personal_needs','total')),
  valid_from date not null,
  valid_to date
);

create table lss_need_assessments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id),
  application_id uuid references lss_applications(id),
  assessed_by uuid references user_profiles(id),
  assessed_at date not null,
  assessment_document_id uuid references documents(id),
  summary text
);

create table lss_basic_needs (
  id uuid primary key default gen_random_uuid(),
  need_assessment_id uuid not null references lss_need_assessments(id) on delete cascade,
  need_kind text not null check (need_kind in
    ('personal_hygiene','meals','dressing','communication','other_close_needs')),
  hours_per_week numeric not null check (hours_per_week >= 0),
  motivation text
);

create table lss_other_personal_needs (
  id uuid primary key default gen_random_uuid(),
  need_assessment_id uuid not null references lss_need_assessments(id) on delete cascade,
  need_description text not null,
  hours_per_week numeric not null check (hours_per_week >= 0)
);

create table lss_decision_basis (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references lss_decisions(id) on delete cascade,
  basis_kind text not null check (basis_kind in
    ('need_assessment','medical_certificate','personkreis_assessment','prior_decision','other')),
  reference_kind text not null,
  reference_id uuid not null,
  used_in_decision boolean not null default true
);

create table lss_appeals (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references lss_decisions(id),
  appealed_at date not null,
  court text,
  status text not null default 'pending' check (status in
    ('pending','upheld','overturned','partially_overturned','withdrawn')),
  outcome_summary text,
  closed_at date
);

-- ----------------------------------------------------------------------------
-- Providers
-- ----------------------------------------------------------------------------
create table assistance_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) unique,
  provider_status text not null default 'active' check (provider_status in
    ('active','suspended','under_review','terminated')),
  approved_at date,
  created_at timestamptz not null default now()
);

create table provider_ivo_permits (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references assistance_providers(id) on delete cascade,
  permit_number text not null,
  permit_kind text not null default 'personlig_assistans',
  issued_at date not null,
  valid_from date not null,
  valid_to date,
  revoked_at date,
  status text not null default 'active' check (status in ('active','expired','revoked','pending')),
  unique (provider_id, permit_number)
);

create table provider_contracts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references assistance_providers(id),
  contract_number text not null unique,
  valid_from date not null,
  valid_to date,
  hourly_rate_sek numeric,
  status text not null default 'active' check (status in ('active','expired','terminated'))
);

create table provider_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references assistance_providers(id),
  account_kind text not null check (account_kind in ('bankgiro','plusgiro','bank_account')),
  account_reference text not null,
  valid_from date not null default current_date,
  valid_to date,
  registry_id uuid references payment_recipient_registry(id)
);

create table provider_status_history (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references assistance_providers(id),
  old_status text,
  new_status text not null,
  reason text,
  changed_by uuid,
  occurred_at timestamptz not null default now()
);

create table provider_risk_flags (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references assistance_providers(id),
  risk_flag_id uuid,
  flag_kind text not null,
  severity text not null check (severity in ('info','low','medium','high','critical')),
  explanation text not null,
  manually_reviewed boolean not null default false,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Assistants and time reporting
-- ----------------------------------------------------------------------------
create table personal_assistants (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references assistance_providers(id),
  person_id uuid references persons(id),
  assistant_reference text not null,
  employed_from date,
  employed_to date,
  unique (provider_id, assistant_reference)
);

create table assistant_assignments (
  id uuid primary key default gen_random_uuid(),
  assistant_id uuid not null references personal_assistants(id),
  lss_person_id uuid not null references persons(id),
  decision_id uuid references lss_decisions(id),
  valid_from date not null,
  valid_to date
);

create table assistance_time_reports (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references assistance_providers(id),
  person_id uuid not null references persons(id),
  decision_id uuid references lss_decisions(id),
  period_start date not null,
  period_end date not null,
  total_hours numeric not null check (total_hours >= 0),
  status text not null default 'submitted' check (status in
    ('submitted','approved','rejected','corrected')),
  submitted_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table time_report_rows (
  id uuid primary key default gen_random_uuid(),
  time_report_id uuid not null references assistance_time_reports(id) on delete cascade,
  assistant_id uuid references personal_assistants(id),
  work_date date not null,
  start_time time not null,
  end_time time not null,
  hours numeric not null check (hours >= 0)
);

create table time_report_approvals (
  id uuid primary key default gen_random_uuid(),
  time_report_id uuid not null references assistance_time_reports(id),
  approved_by uuid not null,
  approval_kind text not null check (approval_kind in ('municipal_review','provider_attest','user_attest')),
  approved_at timestamptz not null default now(),
  comment text
);

create table time_report_anomalies (
  id uuid primary key default gen_random_uuid(),
  time_report_id uuid not null references assistance_time_reports(id),
  anomaly_kind text not null check (anomaly_kind in
    ('overlapping_time','unreasonable_hours','hours_exceed_decision','missing_approval','sudden_increase')),
  severity text not null check (severity in ('info','low','medium','high','critical')),
  explanation text not null,
  risk_flag_id uuid,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Invoices and payments
-- ----------------------------------------------------------------------------
create table provider_invoices (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references assistance_providers(id),
  invoice_number text not null,
  invoice_org_number text,
  person_id uuid references persons(id),
  decision_id uuid references lss_decisions(id),
  period_start date not null,
  period_end date not null,
  total_hours numeric,
  total_amount_sek numeric not null,
  status text not null default 'received' check (status in
    ('received','validated','approved','rejected','paid','credited')),
  received_at date not null default current_date,
  unique (provider_id, invoice_number)
);

create table provider_invoice_rows (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references provider_invoices(id) on delete cascade,
  row_kind text not null check (row_kind in ('assistance_hours','oncall','travel','other')),
  description text,
  hours numeric,
  unit_price_sek numeric,
  amount_sek numeric not null
);

create table invoice_payment_links (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references provider_invoices(id),
  payment_id uuid not null,
  linked_at timestamptz not null default now(),
  unique (invoice_id, payment_id)
);

create table invoice_validation_results (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references provider_invoices(id),
  check_key text not null,
  status text not null check (status in ('passed','warning','failed')),
  explanation text,
  validated_at timestamptz not null default now()
);

create table lss_payment_batches (
  id uuid primary key default gen_random_uuid(),
  batch_reference text not null unique,
  payment_file_id uuid references payment_files(id),
  scheduled_date date,
  status text not null default 'created' check (status in
    ('created','approved','sent','completed','cancelled')),
  created_at timestamptz not null default now()
);

create table lss_payments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references lss_payment_batches(id),
  person_id uuid references persons(id),
  provider_id uuid references assistance_providers(id),
  invoice_id uuid references provider_invoices(id),
  decision_id uuid references lss_decisions(id),
  amount_sek numeric not null,
  payment_date date,
  status text not null default 'created' check (status in
    ('created','pending_approval','approved','sent','paid','rejected','reversed','paused',
     'cancelled','stopped','recovery_started')),
  recipient_registry_id uuid references payment_recipient_registry(id),
  created_at timestamptz not null default now()
);

create index lss_payments_person_idx on lss_payments(person_id);
create index lss_payments_provider_idx on lss_payments(provider_id);

create table lss_payment_recipients (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references lss_payments(id) on delete cascade,
  recipient_kind text not null check (recipient_kind in ('provider','person','estate','other')),
  organization_id uuid references organizations(id),
  person_id uuid references persons(id),
  account_reference text
);

create table lss_recovery_claims (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references persons(id),
  provider_id uuid references assistance_providers(id),
  decision_id uuid references lss_decisions(id),
  claim_number text not null unique,
  amount_sek numeric not null check (amount_sek > 0),
  reason text not null,
  status text not null default 'open' check (status in
    ('open','partially_recovered','recovered','written_off','disputed','closed')),
  created_at timestamptz not null default now()
);

create table lss_recovery_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references lss_recovery_claims(id) on delete cascade,
  event_kind text not null check (event_kind in
    ('created','payment_received','reminder_sent','disputed','written_off','closed')),
  amount_sek numeric,
  note text,
  occurred_at timestamptz not null default now()
);

-- RLS on all LSS tables
do $$
declare t text;
begin
  foreach t in array array[
    'lss_person_profiles','lss_personkreis_assessments','lss_applications','lss_application_documents',
    'lss_decisions','lss_decision_periods','lss_decision_hours','lss_need_assessments','lss_basic_needs',
    'lss_other_personal_needs','lss_decision_basis','lss_appeals','assistance_providers',
    'provider_ivo_permits','provider_contracts','provider_payment_accounts','provider_status_history',
    'provider_risk_flags','personal_assistants','assistant_assignments','assistance_time_reports',
    'time_report_rows','time_report_approvals','time_report_anomalies','provider_invoices',
    'provider_invoice_rows','invoice_payment_links','invoice_validation_results','lss_payment_batches',
    'lss_payments','lss_payment_recipients','lss_recovery_claims','lss_recovery_events'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
