# Cursor Build Prompt — UBM Klar

You are Cursor acting as a senior principal engineer, software architect, security architect, public-sector product engineer, GDPR/compliance-aware engineer, municipal SaaS architect, and production-readiness lead.

Your task is to build a production-ready Swedish municipal platform named **UBM Klar**.

UBM Klar is a private municipal readiness, payment-control, evidence, and export-preparation platform for Swedish municipalities. It helps municipalities prepare for UBM-related processes, structure and validate payment-related data, control incorrect payments, handle LSS/personlig assistans, handle economic assistance, process UBM requests, create export proposals, review/approve exports, process notifications, manage control cases, reconcile payments, and maintain evidence chains.

UBM Klar must never present itself as an official Utbetalningsmyndigheten service.

## Architecture

Do not build this as a normal simple SaaS.

Production must support isolated municipal data planes:

### Model B — isolated vendor-hosted data plane

- one Supabase project per municipality
- one separate Postgres database per municipality
- separate Auth configuration per municipality
- separate Storage per municipality
- separate Edge Functions where used
- separate RLS policies per municipality
- separate API keys per municipality
- separate backups per municipality
- separate test/stage/prod environments per municipality
- hosted and operated by vendor
- no PII in vendor control plane

### Model C — municipality-owned data plane

- municipality owns Supabase/Postgres
- municipality owns Storage/document storage
- municipality owns encryption keys or key references
- municipality owns audit logs
- municipality owns backups
- municipality owns UBM export packages
- municipality owns all production data
- vendor provides code, release packages, SQL migrations, rule templates, UBM schema versions, support and updates

Support:

- C1 municipality-owned managed Supabase
- C2 self-hosted Supabase
- C3 plain Postgres + separate storage + vendor backend

## UBM phases

Build around two UBM phases:

### Phase 1 — request-based UBM readiness

Support request intake, matching, data collection, eligibility review, redaction, legal/DPO review, maker-checker approval, export package generation, receipt handling, evidence chain, and audit logging.

### Phase 2 — recurring UBM reporting readiness

Support future recurring reporting with schema registry, rule versioning, transport profiles, reporting periods, and feature flags. Do not hardcode final UBM formats before official specifications are available.

## Core modules

Build these modules:

1. Platform Foundation
2. Control Plane without PII
3. Tenant Resolver
4. Tenant Provisioning
5. Municipal Data Plane
6. Auth/SSO
7. RBAC + ABAC + Need-to-know
8. Audit and Data Access Logs
9. Information Classification
10. Document Vault and Redaction
11. Import Engine
12. System of Record and Data Lineage
13. Evidence Chain
14. Data Quality Engine
15. Rule Engine
16. Payment Control
17. Payment Reconciliation
18. LSS Module
19. Economic Assistance Module
20. UBM Schema Registry
21. UBM Obligation Engine
22. UBM Request Manager
23. UBM Export Manager
24. UBM Notification Inbox
25. Control Case Management
26. Maker-Checker Workflows
27. Archive/Retention/E-Archive
28. Public Record and Secrecy Review
29. Support Mode without PII
30. Break-glass/JIT Access
31. Cybersecurity/NIS2 Readiness
32. Accessibility/WCAG
33. Exit Export
34. Commercial Billing and Entitlements without citizen data
35. Platform Superadmin without PII
36. AI Assistance Guardrails

## UI principles

- Swedish language by default.
- Role-based navigation.
- Case workers should only see what they need.
- No technical platform menus for normal users.
- Mask sensitive fields by default.
- Sensitive reveal requires reason and audit log.
- Every page needs loading, empty, error, and permission-denied states.
- Show clear next action when something is blocked.

Main UI areas:

- Översikt
- UBM-beredskap
- UBM-förfrågningar
- Exportförslag
- Underrättelser
- Kontrollärenden
- LSS
- Ekonomiskt bistånd
- Betalningskontroll
- Importer
- Dokument
- Rapporter
- Revision och loggar
- Juridik och DPO
- Säkerhet
- Arkiv
- Inställningar

## Required database areas

Create migration-safe schemas for:

- tenants
- tenant_domains
- tenant_environments
- tenant_modules
- tenant_auth_providers
- tenant_release_status
- tenant_support_cases
- tenant_production_readiness
- municipality_profile
- departments
- committees
- units
- identity_providers
- user_profiles
- roles
- permissions
- role_permissions
- user_roles
- access_scopes
- role_mappings
- need_to_know_policies
- case_access_grants
- sensitive_field_reveals
- audit_logs
- data_access_logs
- persons
- person_identifiers
- protected_identity_markers
- document_references
- document_access_logs
- source_systems
- import_batches
- import_records
- field_mappings
- data_lineage_records
- evidence_chain_items
- risk_rules
- risk_rule_versions
- risk_flags
- payment_files
- payment_file_rows
- payment_reconciliation_runs
- payment_reconciliation_results
- control_cases
- approval_workflows
- archive_classifications
- retention_rules
- public_record_requests
- secrecy_reviews
- cyber_risk_register
- security_controls
- production_readiness_gates

Also create full LSS, economic assistance, and UBM module schemas.

## LSS risk rules

Implement at least these:

1. Payment after decision end date.
2. Payment before decision start date.
3. Billed hours exceed decision hours.
4. Time report missing for invoiced period.
5. Invoice lacks approved provider.
6. Provider lacks active IVO permit.
7. Invoice org number differs from contracted provider.
8. Same assistant reports overlapping time.
9. Same assistant reports unreasonable number of hours.
10. Duplicate invoice for same person and period.
11. Duplicate payment for same person and period.
12. Payment despite active recovery claim.
13. Payment account changed close to payment date.
14. Protected identity lacks elevated access protection.
15. Medical document is misclassified.
16. Invoice lacks decision link.
17. Payment recipient differs from contracted provider.
18. Cancelled/ended decision still has invoicing.
19. Time report lacks approval.
20. Unusual increase in hours compared to previous period.

## Economic assistance risk rules

Implement at least these:

1. Payment lacks decision.
2. Payment exceeds approved amount.
3. Payment occurs after decision validity.
4. Duplicate payment to same household and period.
5. Income record lacks period.
6. Income verified after decision affects eligibility.
7. Household member missing from calculation.
8. Housing cost lacks supporting document.
9. Application lacks required attachment.
10. Recovery claim exists but new payment occurs without control.
11. Account used by multiple households without explanation.
12. Account changed close to payment date.
13. Decision changed but old payment details are used.
14. Rejection exists but payment was still created.
15. Reconsideration is ongoing but payment goes through.
16. Income was not used in decision.
17. Household changed after decision.
18. Housing cost lacks document link.
19. Payment recipient differs from household.
20. Application, decision and payment periods do not match.

## UBM flow

Request flow:

UBM request received → registered → matched to person/case/domain → suggested data generated → data lineage checked → classification checked → eligibility engine runs → legal/DPO/export manager review → documents redacted if needed → maker-checker approval → export package created → export hashed → export approved → sent/downloaded through approved channel → receipt stored → audit log created → evidence chain updated.

Notification flow:

UBM notification received → matched to person/case/decision/payment → control case created → responsible user assigned → investigation performed → outcome registered → feedback registered → evidence chain updated.

## AI guardrails

AI may suggest and summarize, but must never decide, approve, export, reveal protected identity, or invent legal requirements.

All AI output must be marked:

- suggestion_only
- requires_human_review
- source_references_required
- confidence_level

## Build batches

Build in batches:

1. Repository foundation
2. Product rename and brand foundation
3. Control Plane
4. Tenant Resolver
5. Tenant Provisioning
6. Data Plane Schema Foundation
7. Auth and Access Control
8. Internal Secrecy and Need-to-Know
9. Audit and Data Access Logs
10. Information Classification
11. Document Vault
12. Import Engine
13. System of Record and Data Lineage
14. Data Quality Engine
15. Rule Engine and Payment Control Foundation
16. Maker-Checker Approval Workflows
17. Control Case Management
18. Payment Files and Reconciliation
19. LSS Data Model
20. LSS Demo Data
21. LSS Matching and Reconciliation
22. LSS Risk Rules
23. LSS Dashboard
24. Legal Source and UBM Obligation Registry
25. UBM Schema Registry
26. UBM Eligibility Engine
27. UBM Request Manager
28. UBM Export Manager
29. UBM Notification Inbox
30. Recurring UBM Reporting 2029
31. Economic Assistance Data Model
32. Economic Assistance Demo Data
33. Economic Assistance Intake and SSBTEK/GIF Metadata
34. Economic Assistance Payment Control
35. Economic Assistance Dashboard
36. UBM for Economic Assistance
37. Onboarding and Readiness Score
38. Archive, Retention and E-Archive
39. Public Record and Secrecy Review
40. Support Mode without PII
41. Break-glass
42. Reports and Dashboards
43. Privacy/Security Anomaly Detection
44. Migration and Release Runner
45. Backup/Restore and Monitoring
46. SIEM and Incident Support
47. Cybersecurity/NIS2 Readiness
48. Compliance Package
49. Outsourcing and Procurement Package
50. Commercial Billing and Entitlements
51. AI Assistance Guardrails
52. Exit Export
53. Accessibility Hardening
54. Production Acceptance Gates
55. Security Hardening
56. End-to-End Demo Flows
57. Final Production Readiness

After every batch, summarize:

- what was implemented
- files changed
- migrations added
- tests added
- commands run
- remaining work
- environment variables needed
- security/compliance notes
- whether the batch is production-safe or still needs hardening

## Acceptance criteria

The platform is complete when:

- Product is named UBM Klar.
- It is clear this is not the official UBM authority service.
- Monorepo is structured correctly.
- Control plane exists and stores no PII.
- Tenant resolver works by strict domain.
- Model B and Model C are supported.
- Tenant provisioning supports test/stage/prod.
- SSO abstractions exist for Entra/OIDC/SAML.
- RBAC + ABAC + need-to-know exists.
- RLS exists on sensitive tables.
- Service role is never exposed to frontend.
- LSS module exists.
- Economic assistance module exists.
- UBM module exists.
- UBM 2026 request-based mode exists.
- UBM 2029 recurring mode exists and is feature-flagged.
- Payment control and reconciliation exist.
- Control cases exist.
- Audit/data access logs exist.
- Maker-checker approvals exist.
- Archive/retention/e-archive exists.
- Public-record/secrecy review exists.
- Support mode without PII exists.
- Break-glass/JIT access exists.
- Exit export exists.
- Accessibility/WCAG support exists.
- Cybersecurity/NIS2 readiness exists.
- Build/typecheck/tests pass or missing environment variables are clearly documented.
