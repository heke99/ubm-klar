-- ============================================================================
-- 202607070018_information_classification.sql
-- C/I/A information classification for fields, documents, integrations and
-- exports. Classification drives access control, masking, export gating and
-- retention.
-- ============================================================================

create table information_classifications (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('field','document_type','integration','export','table')),
  target_key text not null,          -- e.g. 'persons.personal_identity_number'
  confidentiality smallint not null check (confidentiality between 0 and 3),
  integrity smallint not null check (integrity between 0 and 3),
  availability smallint not null check (availability between 0 and 3),
  data_class text not null check (data_class in
    ('public','internal','personal_data','protected_identity','children_data','health_medical',
     'income_data','housing_social_circumstance','bank_account_payment_recipient','security_classified')),
  masked_by_default boolean not null default true,
  reveal_requires_reason boolean not null default true,
  export_requires_approval boolean not null default true,
  classified_by uuid,
  motivation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_kind, target_key)
);

create trigger information_classifications_updated_at
  before update on information_classifications
  for each row execute function app.set_updated_at();

-- Default field classifications for the core schema
insert into information_classifications
  (target_kind, target_key, confidentiality, integrity, availability, data_class,
   masked_by_default, reveal_requires_reason, export_requires_approval, motivation)
values
  ('field','persons.personal_identity_number',3,3,2,'personal_data',true,true,true,'Direct identifier'),
  ('field','persons.protected_identity',3,3,2,'protected_identity',true,true,true,'Protected identity marker'),
  ('field','persons.given_name',2,2,2,'personal_data',false,false,true,'Name'),
  ('field','persons.family_name',2,2,2,'personal_data',false,false,true,'Name'),
  ('field','persons.date_of_birth',2,2,2,'personal_data',true,false,true,'Birth date'),
  ('table','audit_events',2,3,3,'internal',false,false,true,'Integrity-critical log'),
  ('table','data_access_events',2,3,3,'internal',false,false,true,'Integrity-critical log');

alter table information_classifications enable row level security;
