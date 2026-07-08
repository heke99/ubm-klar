-- ============================================================================
-- 202607070026_commercial_billing_entitlements.sql
-- Data-plane copies of plan/entitlement state used for feature gating.
-- Billing itself lives in the vendor control plane and NEVER stores citizen
-- data; this table set holds only the tenant's own subscription state.
-- ============================================================================

create table billing_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  name_sv text not null,
  description_sv text not null,
  is_active boolean not null default true
);

create table billing_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null references billing_plans(plan_key),
  version text not null,
  price_model jsonb not null default '{}'::jsonb,
  included_modules text[] not null default '{}',
  effective_from date not null,
  effective_to date,
  unique (plan_key, version)
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null references billing_plans(plan_key),
  plan_version text not null,
  status text not null default 'active' check (status in
    ('trial','active','past_due','cancelled','expired')),
  starts_at date not null,
  ends_at date
);

create table subscription_items (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  item_key text not null,
  quantity integer not null default 1,
  unit text not null default 'unit'
);

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  entitlement_key text not null unique,
  value jsonb not null default 'true'::jsonb,
  source text not null default 'subscription' check (source in ('subscription','manual','trial')),
  expires_at timestamptz
);

create table usage_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null,
  period_start date not null,
  period_end date not null,
  value numeric not null,
  unique (metric_key, period_start)
);

create table billing_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  amount_sek numeric,
  reference text,
  occurred_at timestamptz not null default now()
);

create table invoices_no_pii (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  period_start date not null,
  period_end date not null,
  amount_sek numeric not null,
  status text not null default 'draft' check (status in ('draft','sent','paid','overdue','credited')),
  -- invoices reference the municipality organization, never citizens
  issued_at date
);

create table contract_terms (
  id uuid primary key default gen_random_uuid(),
  term_key text not null unique,
  title text not null,
  content_reference text not null,
  signed_at date,
  valid_from date,
  valid_to date
);

create table implementation_packages (
  id uuid primary key default gen_random_uuid(),
  package_key text not null unique,
  name_sv text not null,
  description_sv text not null,
  status text not null default 'available' check (status in ('available','ordered','delivered'))
);

create table support_packages (
  id uuid primary key default gen_random_uuid(),
  package_key text not null unique,
  name_sv text not null,
  description_sv text not null,
  response_time_hours integer,
  status text not null default 'available' check (status in ('available','active','expired'))
);

insert into billing_plans (plan_key, name_sv, description_sv) values
  ('ubm_klar_start','UBM Klar Start','Beredskapsbedömning, importmallar, manuell förfrågningshantering, grundläggande dashboards. Inga produktionsintegrationer.'),
  ('ubm_klar_lss','UBM Klar LSS','LSS-datamodell, LSS-betalningskontroll, utförarkontroller, UBM-exportförslag för LSS.'),
  ('ubm_klar_eb','UBM Klar Ekonomiskt Bistånd','Hushålls-/ansöknings-/besluts-/betalningsmodell, inkomst- och boendekontroller, UBM-exportförslag.'),
  ('ubm_klar_kontroll','UBM Klar Kontroll','Betalningsfilsimport, avstämning, riskregler, kontrollärenden, återkravsuppföljning.'),
  ('ubm_klar_enterprise','UBM Klar Enterprise','Modell B isolerad driftad dataplan, Modell C-stöd, SSO, SIEM, JIT-support, produktionsgrindar, exit-export, arkiv/e-arkiv.');

alter table billing_plans enable row level security;
alter table billing_plan_versions enable row level security;
alter table subscriptions enable row level security;
alter table subscription_items enable row level security;
alter table entitlements enable row level security;
alter table usage_metrics enable row level security;
alter table billing_events enable row level security;
alter table invoices_no_pii enable row level security;
alter table contract_terms enable row level security;
alter table implementation_packages enable row level security;
alter table support_packages enable row level security;
