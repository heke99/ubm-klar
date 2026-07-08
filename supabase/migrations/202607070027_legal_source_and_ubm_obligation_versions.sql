-- ============================================================================
-- 202607070027_legal_source_and_ubm_obligation_versions.sql
-- Legal source register, regulatory obligations and UBM obligation versioning.
-- Every UBM assessment/export/flag records which versions produced it.
-- ============================================================================

create table legal_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  title text not null,
  source_kind text not null check (source_kind in
    ('law','ordinance','regulation','guidance','court_practice','official_specification')),
  publisher text,
  url text
);

create table legal_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references legal_sources(source_key),
  version text not null,
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  effective_from date,
  effective_to date,
  summary_of_changes text,
  created_at timestamptz not null default now(),
  unique (source_key, version)
);

create table regulatory_obligations (
  id uuid primary key default gen_random_uuid(),
  obligation_key text not null unique,
  title text not null,
  description text not null,
  domain text not null check (domain in ('lss','economic_assistance','common')),
  authority text not null default 'Utbetalningsmyndigheten'
);

create table regulatory_obligation_versions (
  id uuid primary key default gen_random_uuid(),
  obligation_key text not null references regulatory_obligations(obligation_key),
  version text not null,
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  legal_source_key text references legal_sources(source_key),
  legal_source_version text,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  unique (obligation_key, version)
);

create table ubm_obligation_versions (
  id uuid primary key default gen_random_uuid(),
  obligation_key text not null,
  version text not null,
  obligation_kind text not null check (obligation_kind in ('request_based','recurring_reporting')),
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  legal_source_key text,
  legal_source_version text,
  schema_key text,
  schema_version text,
  effective_from date,
  effective_to date,
  requires_manual_review_reason text,
  created_at timestamptz not null default now(),
  unique (obligation_key, version)
);

create table ubm_effective_dates (
  id uuid primary key default gen_random_uuid(),
  milestone_key text not null unique,
  description text not null,
  effective_date date not null,
  legal_source_key text,
  legal_source_version text
);

create table ubm_phase_configurations (
  id uuid primary key default gen_random_uuid(),
  phase_key text not null unique check (phase_key in ('phase_1_request_based_2026','phase_2_recurring_2029')),
  enabled boolean not null default false,
  feature_flag_key text,
  effective_from date not null,
  configuration jsonb not null default '{}'::jsonb,
  note text
);

create table ubm_guidance_documents (
  id uuid primary key default gen_random_uuid(),
  guidance_key text not null unique,
  title text not null,
  issuer text not null,
  version text not null,
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  url text,
  document_id uuid references documents(id),
  published_at date
);

create table ubm_schema_statuses (
  id uuid primary key default gen_random_uuid(),
  schema_key text not null,
  version text not null,
  status text not null check (status in
    ('draft','proposed','pilot','active','deprecated','superseded',
     'requires_manual_review','awaiting_official_specification')),
  status_reason text,
  changed_at timestamptz not null default now()
);

-- Seed the two known effective dates and phase configurations.
insert into ubm_effective_dates (milestone_key, description, effective_date) values
  ('ubm_phase_1_request_based', 'Kommuner ska kunna hantera förfrågningar från Utbetalningsmyndigheten', '2026-07-01'),
  ('ubm_phase_2_recurring_reporting', 'Kommuner ska kunna lämna återkommande uppgifter (format ej fastställt)', '2029-07-01');

insert into ubm_phase_configurations (phase_key, enabled, feature_flag_key, effective_from, note) values
  ('phase_1_request_based_2026', true, null, '2026-07-01', 'Aktiv: förfrågningsbaserad hantering'),
  ('phase_2_recurring_2029', false, 'ubm_recurring_reporting_2029', '2029-07-01',
   'Avstängd tills officiella specifikationer finns. Slutliga UBM-scheman får inte hårdkodas.');

insert into legal_sources (source_key, title, source_kind, publisher) values
  ('lag_2023_455_ubm', 'Lag (2023:455) om Utbetalningsmyndighetens granskning av utbetalningar', 'law', 'Riksdagen'),
  ('lag_2023_456_uppgiftsskyldighet', 'Lag (2023:456) om skyldighet att lämna uppgifter till Utbetalningsmyndigheten', 'law', 'Riksdagen'),
  ('lss_1993_387', 'Lag (1993:387) om stöd och service till vissa funktionshindrade', 'law', 'Riksdagen'),
  ('sol_2001_453', 'Socialtjänstlag (2001:453)', 'law', 'Riksdagen'),
  ('osl_2009_400', 'Offentlighets- och sekretesslag (2009:400)', 'law', 'Riksdagen'),
  ('gdpr_2016_679', 'Dataskyddsförordningen (EU) 2016/679', 'regulation', 'EU');

insert into legal_source_versions (source_key, version, status, effective_from) values
  ('lag_2023_455_ubm', '2026-07-01', 'active', '2026-07-01'),
  ('lag_2023_456_uppgiftsskyldighet', '2026-07-01', 'active', '2026-07-01'),
  ('lag_2023_456_uppgiftsskyldighet', '2029-07-01', 'awaiting_official_specification', '2029-07-01'),
  ('lss_1993_387', '2026-07-01', 'active', '2026-07-01'),
  ('sol_2001_453', '2026-07-01', 'active', '2026-07-01'),
  ('osl_2009_400', '2026-07-01', 'active', '2026-07-01'),
  ('gdpr_2016_679', '2018-05-25', 'active', '2018-05-25');

alter table legal_sources enable row level security;
alter table legal_source_versions enable row level security;
alter table regulatory_obligations enable row level security;
alter table regulatory_obligation_versions enable row level security;
alter table ubm_obligation_versions enable row level security;
alter table ubm_effective_dates enable row level security;
alter table ubm_phase_configurations enable row level security;
alter table ubm_guidance_documents enable row level security;
alter table ubm_schema_statuses enable row level security;
