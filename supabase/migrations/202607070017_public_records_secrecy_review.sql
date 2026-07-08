-- ============================================================================
-- 202607070017_public_records_secrecy_review.sql
-- Public record requests (allmän handling), secrecy review (sekretessprövning)
-- and disclosure packages.
-- ============================================================================

create table public_record_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  received_at timestamptz not null,
  channel text not null check (channel in ('email','letter','phone','in_person','e_service')),
  -- requester identity may be anonymous by law; stored only when volunteered
  requester_reference text,
  description text not null,
  status text not null default 'received' check (status in
    ('received','identifying_records','secrecy_review','partially_approved','approved',
     'denied','disclosed','appealed','closed')),
  assigned_to uuid references user_profiles(id),
  due_at date,
  created_at timestamptz not null default now()
);

create table public_record_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public_record_requests(id) on delete cascade,
  document_id uuid references documents(id),
  entity_kind text,
  entity_id uuid,
  status text not null default 'identified' check (status in
    ('identified','under_review','releasable','releasable_redacted','withheld'))
);

create table secrecy_reviews (
  id uuid primary key default gen_random_uuid(),
  request_item_id uuid not null references public_record_request_items(id) on delete cascade,
  reviewer uuid not null references user_profiles(id),
  legal_basis text not null,       -- e.g. 'OSL 26 kap. 1 §'
  decision text not null check (decision in ('release','release_redacted','withhold')),
  motivation text not null,
  redaction_job_id uuid references document_redaction_jobs(id),
  reviewed_at timestamptz not null default now()
);

create table disclosure_packages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public_record_requests(id),
  package_number text not null unique,
  manifest jsonb not null,
  manifest_hash_sha256 text not null,
  storage_bucket text not null default 'public-record-disclosures',
  storage_path text,
  approved_by uuid references user_profiles(id),
  disclosed_at timestamptz,
  disclosure_method text check (disclosure_method in ('paper','email','e_service','pickup')),
  fee_sek numeric
);

create table disclosure_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public_record_requests(id),
  package_id uuid references disclosure_packages(id),
  action text not null,
  actor_user_id uuid,
  detail text,
  occurred_at timestamptz not null default now()
);

create trigger disclosure_logs_no_update
  before update or delete on disclosure_logs
  for each row execute function app.reject_mutation();

alter table public_record_requests enable row level security;
alter table public_record_request_items enable row level security;
alter table secrecy_reviews enable row level security;
alter table disclosure_packages enable row level security;
alter table disclosure_logs enable row level security;
