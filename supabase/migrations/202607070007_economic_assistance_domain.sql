-- ============================================================================
-- 202607070007_economic_assistance_domain.sql
-- Economic assistance (ekonomiskt bistånd) domain model, including
-- SSBTEK/GIF-ready income metadata.
-- ============================================================================

create table ea_person_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id) unique,
  department_id uuid references departments(id),
  primary_case_worker uuid references user_profiles(id),
  created_at timestamptz not null default now()
);

create table ea_households (
  id uuid primary key default gen_random_uuid(),
  household_number text not null unique,
  household_kind text not null check (household_kind in
    ('single','single_with_children','couple','couple_with_children','other')),
  created_at timestamptz not null default now()
);

create table ea_household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references ea_households(id) on delete cascade,
  person_id uuid not null references persons(id),
  member_role text not null check (member_role in ('applicant','co_applicant','child','other_adult')),
  valid_from date not null,
  valid_to date,
  unique (household_id, person_id, valid_from)
);

create table ea_applications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references ea_households(id),
  application_number text not null unique,
  received_at date not null,
  application_kind text not null default 'monthly' check (application_kind in
    ('initial','monthly','emergency','supplement')),
  status text not null default 'received' check (status in
    ('received','under_investigation','awaiting_documents','decided','withdrawn')),
  department_id uuid references departments(id),
  created_at timestamptz not null default now()
);

create table ea_application_periods (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references ea_applications(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  check (period_end >= period_start)
);

create table ea_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references ea_applications(id) on delete cascade,
  document_id uuid not null references documents(id),
  document_role text not null check (document_role in
    ('application_form','income_statement','rent_contract','rent_receipt','bank_statement',
     'employment_certificate','medical_certificate','other')),
  required boolean not null default false
);

create table ea_income_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  title text not null,
  ssbtek_code text,
  income_kind text not null check (income_kind in
    ('salary','unemployment_benefit','sickness_benefit','parental_benefit','pension',
     'student_aid','child_allowance','housing_allowance','maintenance_support','other'))
);

create table ea_declared_income (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references ea_applications(id),
  person_id uuid not null references persons(id),
  income_source_key text references ea_income_sources(source_key),
  amount_sek numeric not null check (amount_sek >= 0),
  period_start date,
  period_end date,
  declared_at date not null,
  used_in_decision boolean not null default false,
  legal_basis text,
  purpose text,
  export_eligible boolean not null default false
);

create table ea_verified_income (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references ea_applications(id),
  person_id uuid not null references persons(id),
  income_source_key text references ea_income_sources(source_key),
  amount_sek numeric not null check (amount_sek >= 0),
  period_start date,
  period_end date,
  -- SSBTEK/GIF-ready metadata
  verification_source text not null check (verification_source in
    ('ssbtek','gif','skatteverket','forsakringskassan','af','csn','pensionsmyndigheten',
     'a_kassa','bank_statement','employer','manual')),
  verification_reference text,
  verified_at timestamptz not null default now(),
  used_in_decision boolean not null default false,
  legal_basis text,
  purpose text,
  export_eligible boolean not null default false
);

create table ea_housing_records (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references ea_households(id),
  housing_kind text not null check (housing_kind in
    ('rental','condominium','house','sublet','lodger','homeless','other')),
  monthly_cost_sek numeric check (monthly_cost_sek >= 0),
  landlord_organization_id uuid references organizations(id),
  contract_document_id uuid references documents(id),
  valid_from date not null,
  valid_to date
);

create table ea_rent_documents (
  id uuid primary key default gen_random_uuid(),
  housing_record_id uuid not null references ea_housing_records(id) on delete cascade,
  document_id uuid not null references documents(id),
  document_kind text not null check (document_kind in ('contract','receipt','invoice','other')),
  period_start date,
  period_end date
);

create table ea_address_history (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id),
  address_masked text not null,
  valid_from date not null,
  valid_to date,
  source_system_id uuid references source_systems(id)
);

create table ea_assets (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references ea_applications(id),
  person_id uuid references persons(id),
  asset_kind text not null check (asset_kind in
    ('bank_savings','vehicle','property','securities','other')),
  declared_value_sek numeric not null check (declared_value_sek >= 0),
  verified boolean not null default false
);

create table ea_expenses (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references ea_applications(id),
  expense_kind text not null check (expense_kind in
    ('housing','electricity','home_insurance','work_travel','childcare','union_fee',
     'medical','medication','other')),
  amount_sek numeric not null check (amount_sek >= 0),
  document_id uuid references documents(id),
  approved boolean
);

create table ea_norm_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  norm_year integer not null,
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  effective_from date not null,
  effective_to date,
  source text not null default 'riksnorm'
);

create table ea_norm_rules (
  id uuid primary key default gen_random_uuid(),
  norm_version_id uuid not null references ea_norm_versions(id) on delete cascade,
  rule_key text not null,
  household_kind text,
  age_min integer,
  age_max integer,
  amount_sek numeric not null,
  unique (norm_version_id, rule_key)
);

create table ea_calculations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references ea_applications(id),
  norm_version_id uuid references ea_norm_versions(id),
  period_start date not null,
  period_end date not null,
  total_needs_sek numeric not null default 0,
  total_income_sek numeric not null default 0,
  total_deductions_sek numeric not null default 0,
  calculated_amount_sek numeric not null default 0,
  calculated_by uuid,
  calculated_at timestamptz not null default now()
);

create table ea_calculation_rows (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid not null references ea_calculations(id) on delete cascade,
  row_kind text not null check (row_kind in ('need','income','deduction','expense')),
  description text not null,
  person_id uuid references persons(id),
  amount_sek numeric not null,
  source_reference text
);

create table ea_deductions (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid not null references ea_calculations(id) on delete cascade,
  deduction_kind text not null,
  amount_sek numeric not null check (amount_sek >= 0),
  motivation text
);

create table ea_approved_amounts (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null,
  period_start date not null,
  period_end date not null,
  amount_sek numeric not null check (amount_sek >= 0)
);

create table ea_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references ea_applications(id),
  household_id uuid not null references ea_households(id),
  decision_number text not null unique,
  decision_kind text not null check (decision_kind in
    ('approval','partial_approval','rejection','reconsideration','termination')),
  calculation_id uuid references ea_calculations(id),
  decided_by uuid references user_profiles(id),
  decided_at date not null,
  status text not null default 'active' check (status in
    ('active','superseded','terminated','under_reconsideration','appealed')),
  legal_basis text not null default 'SoL 4 kap. 1 §',
  created_at timestamptz not null default now()
);

alter table ea_approved_amounts
  add constraint ea_approved_amounts_decision_fk
  foreign key (decision_id) references ea_decisions(id) on delete cascade;

create table ea_decision_periods (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references ea_decisions(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  check (period_end >= period_start)
);

create table ea_decision_basis (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references ea_decisions(id) on delete cascade,
  basis_kind text not null check (basis_kind in
    ('declared_income','verified_income','housing_record','asset','expense','calculation','document','other')),
  reference_kind text not null,
  reference_id uuid not null,
  used_in_decision boolean not null default true
);

create table ea_payment_batches (
  id uuid primary key default gen_random_uuid(),
  batch_reference text not null unique,
  payment_file_id uuid references payment_files(id),
  scheduled_date date,
  status text not null default 'created' check (status in
    ('created','approved','sent','completed','cancelled')),
  created_at timestamptz not null default now()
);

create table ea_payments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references ea_payment_batches(id),
  decision_id uuid references ea_decisions(id),
  household_id uuid references ea_households(id),
  person_id uuid references persons(id),
  amount_sek numeric not null check (amount_sek >= 0),
  payment_date date,
  status text not null default 'created' check (status in
    ('created','pending_approval','approved','sent','paid','rejected','reversed','paused',
     'cancelled','stopped','recovery_started')),
  recipient_registry_id uuid references payment_recipient_registry(id),
  created_at timestamptz not null default now()
);

create index ea_payments_household_idx on ea_payments(household_id);

create table ea_payment_recipients (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references ea_payments(id) on delete cascade,
  recipient_kind text not null check (recipient_kind in
    ('applicant','household_member','landlord','other_verified')),
  person_id uuid references persons(id),
  organization_id uuid references organizations(id),
  account_reference text
);

create table ea_payment_account_references (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references ea_households(id),
  account_reference text not null,
  verified boolean not null default false,
  valid_from date not null default current_date,
  valid_to date,
  registry_id uuid references payment_recipient_registry(id)
);

create table ea_recovery_claims (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references ea_households(id),
  person_id uuid references persons(id),
  decision_id uuid references ea_decisions(id),
  claim_number text not null unique,
  amount_sek numeric not null check (amount_sek > 0),
  reason text not null,
  status text not null default 'open' check (status in
    ('open','partially_recovered','recovered','written_off','disputed','closed')),
  created_at timestamptz not null default now()
);

create table ea_recovery_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references ea_recovery_claims(id) on delete cascade,
  event_kind text not null check (event_kind in
    ('created','payment_received','reminder_sent','disputed','written_off','closed')),
  amount_sek numeric,
  note text,
  occurred_at timestamptz not null default now()
);

create table ea_appeals (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references ea_decisions(id),
  appealed_at date not null,
  court text,
  status text not null default 'pending' check (status in
    ('pending','upheld','overturned','partially_overturned','withdrawn')),
  outcome_summary text,
  closed_at date
);

do $$
declare t text;
begin
  foreach t in array array[
    'ea_person_profiles','ea_households','ea_household_members','ea_applications',
    'ea_application_periods','ea_application_documents','ea_income_sources','ea_declared_income',
    'ea_verified_income','ea_housing_records','ea_rent_documents','ea_address_history',
    'ea_assets','ea_expenses','ea_norm_versions','ea_norm_rules','ea_calculations',
    'ea_calculation_rows','ea_deductions','ea_approved_amounts','ea_decisions',
    'ea_decision_periods','ea_decision_basis','ea_payment_batches','ea_payments',
    'ea_payment_recipients','ea_payment_account_references','ea_recovery_claims',
    'ea_recovery_events','ea_appeals'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
