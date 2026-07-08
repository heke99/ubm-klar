-- ============================================================================
-- 202607070031_rls_policies_late.sql
-- RLS policies for tables created after 202607070010 (support/break-glass,
-- classification, archive, onboarding, readiness gates, billing, legal sources).
-- ============================================================================

-- Support/break-glass: sessions visible to municipality oversight; support
-- technicians see support sessions (their own JIT state), never PII tables.
create policy support_sessions_read on support_access_sessions
  for select using (
    app.has_any_role(array[
      'municipality_admin','system_owner','dpo','information_security_officer',
      'support_technician_no_pii','technical_admin_no_pii'
    ])
  );

create policy support_access_events_read on support_access_events
  for select using (
    app.has_any_role(array['municipality_admin','dpo','information_security_officer','internal_auditor'])
  );

create policy support_access_events_insert on support_access_events
  for insert with check (true);

create policy break_glass_sessions_read on break_glass_sessions
  for select using (
    app.has_any_role(array['dpo','information_security_officer','internal_auditor','municipality_admin'])
  );

create policy break_glass_sessions_write on break_glass_sessions
  for insert with check (app.has_any_role(array['break_glass_admin']));

create policy break_glass_events_read on break_glass_events
  for select using (
    app.has_any_role(array['dpo','information_security_officer','internal_auditor'])
  );

create policy break_glass_events_insert on break_glass_events
  for insert with check (true);

-- Reference/config tables readable by all authenticated municipal users
do $$
declare t text;
begin
  foreach t in array array[
    'information_classifications','legal_sources','legal_source_versions',
    'ubm_phase_configurations','ubm_effective_dates','production_readiness_gates',
    'archive_classifications','billing_plans','onboarding_steps','ea_income_sources',
    'anomaly_rules','ai_prompt_policy'
  ] loop
    execute format(
      'create policy %I_read_all on %I for select using (app.current_user_id() is not null)',
      t, t
    );
  end loop;
end $$;

-- Onboarding: admins manage, others read
create policy onboarding_progress_read on onboarding_progress
  for select using (app.current_user_id() is not null);

create policy onboarding_progress_write on onboarding_progress
  for all using (app.has_any_role(array['municipality_admin','system_owner']))
  with check (app.has_any_role(array['municipality_admin','system_owner']));

-- Production readiness evidence: admins + security manage, oversight reads
create policy readiness_evidence_read on production_readiness_evidence
  for select using (
    app.has_any_role(array[
      'municipality_admin','system_owner','information_security_officer','dpo','internal_auditor'
    ])
  );

create policy readiness_evidence_write on production_readiness_evidence
  for all using (app.has_any_role(array['municipality_admin','system_owner','information_security_officer']))
  with check (app.has_any_role(array['municipality_admin','system_owner','information_security_officer']));

-- Anomaly events: DPO/security only
create policy anomaly_events_read on anomaly_events
  for select using (
    app.has_any_role(array['dpo','information_security_officer','internal_auditor'])
  );

create policy anomaly_events_insert on anomaly_events
  for insert with check (true);
