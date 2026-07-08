/** Platform and municipal roles. `*_no_pii` roles must never gain access to citizen data. */
export type RoleId =
  | 'municipality_admin'
  | 'system_owner'
  | 'social_services_manager'
  | 'lss_case_worker'
  | 'economic_assistance_case_worker'
  | 'controller'
  | 'finance_officer'
  | 'lawyer'
  | 'dpo'
  | 'information_security_officer'
  | 'internal_auditor'
  | 'ubm_export_manager'
  | 'control_investigator'
  | 'read_only_reviewer'
  | 'support_technician_no_pii'
  | 'technical_admin_no_pii'
  | 'break_glass_admin'
  | 'platform_admin_no_pii'
  | 'billing_admin_no_pii'
  | 'implementation_consultant_no_pii';

export const ALL_ROLES: readonly RoleId[] = [
  'municipality_admin',
  'system_owner',
  'social_services_manager',
  'lss_case_worker',
  'economic_assistance_case_worker',
  'controller',
  'finance_officer',
  'lawyer',
  'dpo',
  'information_security_officer',
  'internal_auditor',
  'ubm_export_manager',
  'control_investigator',
  'read_only_reviewer',
  'support_technician_no_pii',
  'technical_admin_no_pii',
  'break_glass_admin',
  'platform_admin_no_pii',
  'billing_admin_no_pii',
  'implementation_consultant_no_pii',
] as const;

/** Roles that operate strictly without access to personal data. */
export const NO_PII_ROLES: readonly RoleId[] = [
  'support_technician_no_pii',
  'technical_admin_no_pii',
  'platform_admin_no_pii',
  'billing_admin_no_pii',
  'implementation_consultant_no_pii',
] as const;

export function isNoPiiRole(role: RoleId): boolean {
  return NO_PII_ROLES.includes(role);
}

export type AuthProviderKind = 'entra_id' | 'saml' | 'oidc' | 'supabase_auth';

/** Supabase Auth is a fallback only; production municipal login is SSO. */
export const PRODUCTION_PRIMARY_AUTH_PROVIDERS: readonly AuthProviderKind[] = [
  'entra_id',
  'saml',
  'oidc',
] as const;
