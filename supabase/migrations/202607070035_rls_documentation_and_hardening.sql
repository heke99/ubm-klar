-- 202607070035_rls_documentation_and_hardening.sql
-- RLS review outcome (customer pilot hardening):
--
-- Every sensitive table has RLS ENABLED. Tables fall into three documented
-- classes:
--   1. role-policy tables  — explicit CREATE POLICY per role (persons, LSS/EA
--      core, UBM requests/proposals, documents, audit/data access, control
--      cases, risk flags, readiness, onboarding, support/break-glass).
--   2. service-only tables — RLS enabled with NO policies: default-deny for
--      every direct client; ONLY the backend service connection (table owner)
--      reaches them. This is intentional fail-closed design.
--   3. reference/no-PII    — catalogue tables readable by all authenticated
--      users (roles, permissions, rule definitions, schema registry, gates).
--
-- This migration documents class 2 in the catalog and adds the missing
-- policies found in the review.

-- Class 2 documentation: service-only tables (backend service access only).
do $$
declare t text;
begin
  foreach t in array array[
    'import_staging_rows', 'import_mappings', 'import_batches', 'import_errors',
    'payment_files', 'payment_file_rows', 'payment_recipient_registry',
    'payment_reconciliation_runs', 'payment_reconciliation_results',
    'reconciliation_statuses', 'data_lineage_records', 'record_hashes', 'export_hashes',
    'retention_policies', 'retention_actions', 'archive_retention_rules',
    'legal_holds', 'disposal_decisions',
    'case_access_grants', 'purpose_bound_access', 'access_review_findings',
    'ubm_submissions', 'ubm_receipts', 'ubm_export_rows', 'ubm_export_documents'
  ]
  loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format(
        'comment on table %I is %L', t,
        'RLS class: service-only. RLS enabled with default-deny (no policies); only the backend service connection may access this table.'
      );
    end if;
  end loop;
end $$;

-- Review finding: sensitive reveal log should be readable by auditors/DPO
-- (read-only oversight) — insert stays service-only.
drop policy if exists sensitive_field_reveals_auditor_read on sensitive_field_reveals;
create policy sensitive_field_reveals_auditor_read on sensitive_field_reveals
  for select using (
    exists (
      select 1 from unnest(string_to_array(current_setting('app.roles', true), ',')) role(r)
      where role.r in ('dpo', 'internal_auditor', 'information_security_officer')
    )
  );

-- Review finding: import staging rows may contain PII and must never be
-- readable by no-PII sessions even if future policies are added. Add an
-- explicit RESTRICTIVE guard (defence in depth on top of default deny).
drop policy if exists import_staging_rows_block_no_pii on import_staging_rows;
create policy import_staging_rows_block_no_pii on import_staging_rows
  as restrictive for all
  using (coalesce(current_setting('app.no_pii_session', true), 'false') <> 'true');
