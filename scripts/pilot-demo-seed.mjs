#!/usr/bin/env node
/**
 * Pilot demo seed: a small, clearly synthetic dataset for demo/test tenants.
 *
 * SAFETY:
 *  - every person uses a structurally INVALID personnummer (month 90+) and
 *    is marked is_synthetic = true
 *  - seeding is HARD-BLOCKED when the environment is prod/production
 *  - stage requires --confirm-stage
 *  - a data plane containing real (non-synthetic) persons is refused
 *  - demo case numbers are prefixed DEMO- so reset can remove exactly this data
 *
 * Usage:
 *   node scripts/pilot-demo-seed.mjs --db postgresql://...          # seed
 *   node scripts/pilot-demo-seed.mjs --db postgresql://... --reset  # remove demo data
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const dbIndex = args.indexOf('--db');
const db = dbIndex !== -1 ? args[dbIndex + 1] : process.env.DATA_PLANE_DATABASE_URL;
const reset = args.includes('--reset');
const confirmStage = args.includes('--confirm-stage');

if (!db) {
  console.error('Missing --db <url> (or DATA_PLANE_DATABASE_URL).');
  process.exit(1);
}

const environment = (process.env.APP_ENV ?? process.env.ENVIRONMENT ?? 'local').toLowerCase();
if (['prod', 'production'].includes(environment)) {
  console.error('REFUSED: the demo seed can NEVER run against a production environment.');
  process.exit(1);
}
if (environment === 'stage' && !confirmStage) {
  console.error('REFUSED: stage seeding requires the explicit flag --confirm-stage.');
  process.exit(1);
}

function psql(sql) {
  return execFileSync('psql', [db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A'], {
    input: sql,
    encoding: 'utf8',
  }).trim();
}

// Refuse to touch a data plane that contains real people.
const realPersons = Number(psql(`select count(*) from persons where is_synthetic = false;`));
if (realPersons > 0 && !reset) {
  console.error(
    `REFUSED: the data plane contains ${realPersons} non-synthetic person(s). ` +
      'The demo seed only runs against empty/demo databases.',
  );
  process.exit(1);
}

if (reset) {
  psql(`
begin;
delete from ubm_export_rows where proposal_id in
  (select id from ubm_export_proposals where proposal_number like 'DEMO-%');
delete from ubm_submissions where proposal_id in
  (select id from ubm_export_proposals where proposal_number like 'DEMO-%');
delete from ubm_export_proposals where proposal_number like 'DEMO-%';
delete from ubm_request_subjects where request_id in
  (select id from ubm_requests where request_number like 'DEMO-%');
delete from ubm_request_items where request_id in
  (select id from ubm_requests where request_number like 'DEMO-%');
delete from ubm_requests where request_number like 'DEMO-%';
delete from ubm_notification_outcomes where notification_id in
  (select id from ubm_notifications where notification_number like 'DEMO-%');
delete from ubm_notification_confidence_scores where notification_id in
  (select id from ubm_notifications where notification_number like 'DEMO-%');
update ubm_notifications set control_case_id = null where notification_number like 'DEMO-%';
delete from control_case_events where case_id in
  (select id from control_cases where case_number like 'DEMO-%');
delete from control_case_status_history where case_id in
  (select id from control_cases where case_number like 'DEMO-%');
delete from control_case_notes where case_id in
  (select id from control_cases where case_number like 'DEMO-%');
update risk_flags set control_case_id = null where control_case_id in
  (select id from control_cases where case_number like 'DEMO-%');
delete from control_cases where case_number like 'DEMO-%';
delete from ubm_notifications where notification_number like 'DEMO-%';
delete from risk_flags where person_id in (select id from persons where is_synthetic = true);
delete from lss_payments where person_id in (select id from persons where is_synthetic = true);
delete from lss_decision_periods where decision_id in
  (select id from lss_decisions where person_id in (select id from persons where is_synthetic = true));
delete from lss_decisions where person_id in (select id from persons where is_synthetic = true);
delete from lss_person_profiles where person_id in (select id from persons where is_synthetic = true);
delete from ea_payments where person_id in (select id from persons where is_synthetic = true)
  or household_id in (select household_id from ea_household_members m
                      join persons p on p.id = m.person_id where p.is_synthetic = true);
delete from ea_decisions where household_id in
  (select m.household_id from ea_household_members m join persons p on p.id = m.person_id where p.is_synthetic = true);
delete from ea_applications where household_id in
  (select m.household_id from ea_household_members m join persons p on p.id = m.person_id where p.is_synthetic = true);
delete from ea_household_members where person_id in (select id from persons where is_synthetic = true);
delete from ea_households where household_number like 'DEMO-%';
delete from ea_person_profiles where person_id in (select id from persons where is_synthetic = true);
delete from persons where is_synthetic = true;
commit;
`);
  console.info('Pilot demo data removed (synthetic persons + DEMO-* records).');
  process.exit(0);
}

// --- Seed -----------------------------------------------------------------
// Synthetic personnummer: month 90+ can never be a real Swedish identity number.
psql(`
begin;

-- 12 synthetic persons (LSS + EA)
insert into persons (personal_identity_number, is_synthetic, given_name, family_name, protected_identity)
select
  '1975' || lpad((90 + s % 9)::text, 2, '0') || lpad((10 + s)::text, 2, '0') || '-' || lpad((1000 + s * 7)::text, 4, '0'),
  true,
  'Demoperson' || s,
  'Testfamilj',
  s = 11
from generate_series(1, 12) as s
on conflict (personal_identity_number) do nothing;

insert into lss_person_profiles (person_id)
select id from persons where is_synthetic = true and given_name in
  ('Demoperson1','Demoperson2','Demoperson3','Demoperson4','Demoperson5','Demoperson6')
on conflict (person_id) do nothing;

insert into ea_person_profiles (person_id)
select id from persons where is_synthetic = true and given_name in
  ('Demoperson7','Demoperson8','Demoperson9','Demoperson10','Demoperson11','Demoperson12')
on conflict (person_id) do nothing;

-- LSS decisions with periods (one expired to trigger control rules)
insert into lss_decisions (person_id, decision_number, insats_kind, decision_kind, decided_at, status)
select id, 'DEMO-LSS-' || given_name, 'personlig_assistans', 'approval', '2025-06-01',
       case when given_name = 'Demoperson1' then 'expired' else 'active' end
from persons where is_synthetic = true and given_name like 'Demoperson_' and given_name similar to 'Demoperson[1-6]'
on conflict (decision_number) do nothing;

insert into lss_decision_periods (decision_id, period_start, period_end)
select d.id, '2025-06-01',
       case when d.status = 'expired' then '2025-12-31'::date else '2026-12-31'::date end
from lss_decisions d where d.decision_number like 'DEMO-LSS-%'
on conflict do nothing;

-- LSS payments (one AFTER the expired decision period => rule finding)
insert into lss_payments (person_id, decision_id, amount_sek, payment_date, status)
select d.person_id, d.id, 24000 + (row_number() over ()) * 500, '2026-06-25', 'paid'
from lss_decisions d where d.decision_number like 'DEMO-LSS-%';

-- EA households + members + applications + decisions + payments
insert into ea_households (household_number, household_kind)
select 'DEMO-HH-' || s, case when s % 2 = 0 then 'single' else 'single_with_children' end
from generate_series(1, 6) as s
on conflict (household_number) do nothing;

insert into ea_household_members (household_id, person_id, member_role, valid_from)
select h.id, p.id, 'applicant', '2026-01-01'
from (select id, row_number() over (order by household_number) as rn from ea_households where household_number like 'DEMO-HH-%') h
join (select id, row_number() over (order by given_name) as rn from persons where is_synthetic = true and given_name similar to 'Demoperson(7|8|9|10|11|12)') p
  on p.rn = h.rn
on conflict do nothing;

insert into ea_applications (household_id, application_number, received_at, application_kind)
select id, 'DEMO-ANS-' || household_number, '2026-05-01', 'monthly'
from ea_households where household_number like 'DEMO-HH-%'
on conflict (application_number) do nothing;

insert into ea_decisions (application_id, household_id, decision_number, decision_kind, decided_at)
select a.id, a.household_id, 'DEMO-EB-' || a.application_number, 'approval', '2026-05-10'
from ea_applications a where a.application_number like 'DEMO-ANS-%'
on conflict (decision_number) do nothing;

insert into ea_payments (household_id, decision_id, amount_sek, payment_date, status)
select d.household_id, d.id, 9800, '2026-06-25', 'paid'
from ea_decisions d where d.decision_number like 'DEMO-EB-%';

-- A demo UBM request with a matched subject and requested items
insert into ubm_requests (request_number, intake_channel, received_at, domain, status, deadline_at, legal_source_key)
values ('DEMO-UBM-2026-001', 'manual_registration', now(), 'lss', 'registered', current_date + 30, 'lag_2024_ubm')
on conflict (request_number) do nothing;

insert into ubm_request_items (request_id, item_key, description, requested_data_kind)
select id, 'beslut', 'Gällande LSS-beslut (demo)', 'decisions' from ubm_requests where request_number = 'DEMO-UBM-2026-001'
on conflict do nothing;

insert into ubm_request_subjects (request_id, subject_kind, person_id, match_status, match_confidence, matched_at)
select r.id, 'person', p.id, 'matched', 1.0, now()
from ubm_requests r, persons p
where r.request_number = 'DEMO-UBM-2026-001' and p.is_synthetic = true and p.given_name = 'Demoperson1'
on conflict do nothing;

-- A demo notification
insert into ubm_notifications (notification_number, intake_channel, received_at, domain, summary, status)
values ('DEMO-UN-2026-001', 'manual_registration', now(), 'economic_assistance',
        'Demo: möjlig parallell utbetalning i annan kommun.', 'received')
on conflict (notification_number) do nothing;

commit;
`);

const counts = psql(`
select 'persons=' || (select count(*) from persons where is_synthetic = true)
  || ' lss_decisions=' || (select count(*) from lss_decisions where decision_number like 'DEMO-%')
  || ' lss_payments=' || (select count(*) from lss_payments p join lss_decisions d on d.id = p.decision_id where d.decision_number like 'DEMO-%')
  || ' ea_households=' || (select count(*) from ea_households where household_number like 'DEMO-%')
  || ' ubm_requests=' || (select count(*) from ubm_requests where request_number like 'DEMO-%')
  || ' notifications=' || (select count(*) from ubm_notifications where notification_number like 'DEMO-%');
`);
console.info(`Pilot demo seed complete: ${counts}`);
console.info(
  'All personnummer are structurally invalid (month 90+) and marked is_synthetic. ' +
    'Run payment-control to generate demo risk flags and control cases.',
);
