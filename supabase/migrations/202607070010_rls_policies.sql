-- ============================================================================
-- 202607070010_rls_policies.sql
-- Row-level security policies. RLS is enabled deny-by-default in each domain
-- migration; this migration grants least-privilege access per role and adds
-- restrictive no-PII blocks. Session context comes from app.current_user_id(),
-- app.current_roles() and app.is_no_pii_session().
-- ============================================================================

-- Convenience: which roles may read person-level data at all
create or replace function app.has_any_role(roles text[]) returns boolean
language sql stable as $$
  select coalesce(app.current_roles() && roles, false);
$$;

-- ----------------------------------------------------------------------------
-- persons: PII roles only; no-PII sessions blocked by restrictive policy (0001)
-- ----------------------------------------------------------------------------
create policy persons_read on persons
  for select using (
    app.has_any_role(array[
      'municipality_admin','system_owner','social_services_manager','lss_case_worker',
      'economic_assistance_case_worker','controller','lawyer','dpo','internal_auditor',
      'ubm_export_manager','control_investigator','read_only_reviewer','break_glass_admin'
    ])
  );

create policy persons_write on persons
  for insert with check (
    app.has_any_role(array['lss_case_worker','economic_assistance_case_worker','municipality_admin'])
  );

create policy persons_update on persons
  for update using (
    app.has_any_role(array['lss_case_worker','economic_assistance_case_worker','municipality_admin'])
  );

-- Protected identity rows require elevated roles (restrictive: ANDed with above)
create policy persons_protected_identity_elevated on persons
  as restrictive for select using (
    protected_identity = false
    or app.has_any_role(array[
      'social_services_manager','dpo','lawyer','control_investigator','break_glass_admin'
    ])
  );

-- ----------------------------------------------------------------------------
-- LSS domain: LSS roles; case workers additionally scoped by case grants in app code
-- ----------------------------------------------------------------------------
create policy lss_decisions_read on lss_decisions
  for select using (
    app.has_any_role(array[
      'lss_case_worker','social_services_manager','controller','control_investigator',
      'lawyer','dpo','internal_auditor','ubm_export_manager','read_only_reviewer'
    ])
  );

create policy lss_decisions_write on lss_decisions
  for all using (app.has_any_role(array['lss_case_worker','municipality_admin']))
  with check (app.has_any_role(array['lss_case_worker','municipality_admin']));

create policy lss_payments_read on lss_payments
  for select using (
    app.has_any_role(array[
      'controller','finance_officer','control_investigator','social_services_manager',
      'internal_auditor','read_only_reviewer'
    ])
  );

create policy lss_payments_write on lss_payments
  for all using (app.has_any_role(array['finance_officer','controller']))
  with check (app.has_any_role(array['finance_officer','controller']));

create policy lss_payments_block_no_pii on lss_payments
  as restrictive for all using (not app.is_no_pii_session());

-- ----------------------------------------------------------------------------
-- Economic assistance domain
-- ----------------------------------------------------------------------------
create policy ea_decisions_read on ea_decisions
  for select using (
    app.has_any_role(array[
      'economic_assistance_case_worker','social_services_manager','controller',
      'control_investigator','lawyer','dpo','internal_auditor','ubm_export_manager',
      'read_only_reviewer'
    ])
  );

create policy ea_decisions_write on ea_decisions
  for all using (app.has_any_role(array['economic_assistance_case_worker','municipality_admin']))
  with check (app.has_any_role(array['economic_assistance_case_worker','municipality_admin']));

create policy ea_payments_read on ea_payments
  for select using (
    app.has_any_role(array[
      'controller','finance_officer','control_investigator','social_services_manager',
      'internal_auditor','read_only_reviewer'
    ])
  );

create policy ea_payments_write on ea_payments
  for all using (app.has_any_role(array['finance_officer','controller']))
  with check (app.has_any_role(array['finance_officer','controller']));

create policy ea_payments_block_no_pii on ea_payments
  as restrictive for all using (not app.is_no_pii_session());

create policy ea_verified_income_read on ea_verified_income
  for select using (
    app.has_any_role(array[
      'economic_assistance_case_worker','social_services_manager','control_investigator','dpo'
    ])
  );

create policy ea_verified_income_block_no_pii on ea_verified_income
  as restrictive for all using (not app.is_no_pii_session());

-- ----------------------------------------------------------------------------
-- Documents: role-gated; no-PII sessions blocked (0004 restrictive policy)
-- ----------------------------------------------------------------------------
create policy documents_read on documents
  for select using (
    app.has_any_role(array[
      'lss_case_worker','economic_assistance_case_worker','social_services_manager',
      'lawyer','dpo','ubm_export_manager','control_investigator'
    ])
  );

create policy documents_write on documents
  for insert with check (
    app.has_any_role(array['lss_case_worker','economic_assistance_case_worker','ubm_export_manager','lawyer'])
  );

-- ----------------------------------------------------------------------------
-- UBM: export managers, legal, DPO
-- ----------------------------------------------------------------------------
create policy ubm_requests_read on ubm_requests
  for select using (
    app.has_any_role(array['ubm_export_manager','lawyer','dpo','social_services_manager','internal_auditor'])
  );

create policy ubm_requests_write on ubm_requests
  for all using (app.has_any_role(array['ubm_export_manager']))
  with check (app.has_any_role(array['ubm_export_manager']));

create policy ubm_export_proposals_read on ubm_export_proposals
  for select using (
    app.has_any_role(array['ubm_export_manager','lawyer','dpo','internal_auditor'])
  );

create policy ubm_export_proposals_write on ubm_export_proposals
  for all using (app.has_any_role(array['ubm_export_manager']))
  with check (app.has_any_role(array['ubm_export_manager']));

create policy ubm_export_proposals_block_no_pii on ubm_export_proposals
  as restrictive for all using (not app.is_no_pii_session());

create policy ubm_submissions_block_no_pii on ubm_submissions
  as restrictive for all using (not app.is_no_pii_session());

create policy ubm_submissions_read on ubm_submissions
  for select using (app.has_any_role(array['ubm_export_manager','internal_auditor','dpo']));

create policy ubm_submissions_write on ubm_submissions
  for all using (app.has_any_role(array['ubm_export_manager']))
  with check (app.has_any_role(array['ubm_export_manager']));

-- ----------------------------------------------------------------------------
-- Control cases: investigators, controllers, oversight
-- ----------------------------------------------------------------------------
create policy control_cases_read on control_cases
  for select using (
    app.has_any_role(array[
      'control_investigator','controller','social_services_manager','lawyer','dpo',
      'internal_auditor','read_only_reviewer'
    ])
  );

create policy control_cases_write on control_cases
  for all using (app.has_any_role(array['control_investigator','controller']))
  with check (app.has_any_role(array['control_investigator','controller']));

create policy control_cases_block_no_pii on control_cases
  as restrictive for all using (not app.is_no_pii_session());

-- Risk flags: same audience; insertable by service jobs (definer functions)
create policy risk_flags_read on risk_flags
  for select using (
    app.has_any_role(array[
      'control_investigator','controller','social_services_manager','internal_auditor','dpo'
    ])
  );

-- ----------------------------------------------------------------------------
-- Audit and access logs: read for oversight roles; inserts via backend only
-- ----------------------------------------------------------------------------
create policy audit_events_read on audit_events
  for select using (
    app.has_any_role(array['internal_auditor','dpo','information_security_officer','municipality_admin','system_owner'])
  );

create policy audit_events_insert on audit_events
  for insert with check (true); -- append via backend (delete/update blocked by trigger)

create policy data_access_events_read on data_access_events
  for select using (
    app.has_any_role(array['internal_auditor','dpo','information_security_officer'])
  );

create policy data_access_events_insert on data_access_events
  for insert with check (true);

create policy sensitive_field_reveals_read on sensitive_field_reveals
  for select using (app.has_any_role(array['internal_auditor','dpo']));

create policy sensitive_field_reveals_insert on sensitive_field_reveals
  for insert with check (true);

-- ----------------------------------------------------------------------------
-- Reference/config tables (created by migration 0010 time) readable by all
-- authenticated municipal users. Policies for tables created by later
-- migrations live in 202607070031_rls_policies_late.sql.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ubm_schemas','ubm_schema_versions','risk_rule_definitions'
  ] loop
    execute format(
      'create policy %I_read_all on %I for select using (app.current_user_id() is not null)',
      t, t
    );
  end loop;
end $$;
