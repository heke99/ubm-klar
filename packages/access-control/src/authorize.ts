import {
  isNoPiiRole,
  requiresRevealReason,
  type DataClass,
  type ModuleId,
  type RoleId,
} from '@ubm-klar/shared-types';
import {
  PERMISSION_MODULES,
  PII_PERMISSIONS,
  ROLE_PERMISSIONS,
  type PermissionKey,
} from './permissions';

/** The authenticated subject making a request (after SSO claim mapping). */
export interface AccessSubject {
  userId: string;
  roles: RoleId[];
  departmentIds: string[];
  unitIds: string[];
  committeeIds: string[];
  /** Case ids the subject is assigned to (need-to-know). */
  assignedCaseIds: string[];
  sessionKind: 'normal' | 'support_jit' | 'break_glass';
  /** For support_jit / break_glass sessions: expiry timestamp (ms epoch). */
  sessionExpiresAt?: number;
}

/** The resource being accessed. */
export interface AccessResource {
  kind: string;
  id?: string;
  module?: ModuleId;
  departmentId?: string;
  unitId?: string;
  committeeId?: string;
  caseId?: string;
  dataClasses?: DataClass[];
  protectedIdentity?: boolean;
  concernsMinor?: boolean;
}

export interface AccessContext {
  enabledModules: ModuleId[];
  /** Reason given by the user for this access (required for sensitive reveals). */
  reason?: string;
  /** Purpose of access (purpose binding). */
  purpose?: string;
  now?: number;
}

export interface AccessDecision {
  allowed: boolean;
  permission: PermissionKey;
  reasons: string[];
  obligations: AccessObligation[];
}

export type AccessObligation =
  | 'log_data_access'
  | 'log_sensitive_reveal'
  | 'mask_sensitive_fields'
  | 'require_reason'
  | 'time_limited_session'
  | 'post_review_required';

/**
 * Central authorization decision: RBAC (role → permission) + ABAC (module,
 * org placement, data class, protected identity, session kind) + need-to-know
 * (case assignment). Deny by default; every deny carries an explanation.
 *
 * The same rules are mirrored in database RLS policies; this function is the
 * backend gate and must never be bypassed by frontend code.
 */
export function authorize(
  subject: AccessSubject,
  permission: PermissionKey,
  resource: AccessResource,
  context: AccessContext,
): AccessDecision {
  const reasons: string[] = [];
  const obligations: AccessObligation[] = [];
  const deny = (reason: string): AccessDecision => ({
    allowed: false,
    permission,
    reasons: [...reasons, reason],
    obligations,
  });

  // 0. Session validity
  const now = context.now ?? Date.now();
  if (subject.sessionKind !== 'normal') {
    obligations.push('time_limited_session', 'post_review_required');
    if (!subject.sessionExpiresAt || subject.sessionExpiresAt <= now) {
      return deny(`${subject.sessionKind} session has expired`);
    }
  }

  // 1. RBAC: at least one role must grant the permission
  const grantingRoles = subject.roles.filter((role) =>
    (ROLE_PERMISSIONS[role] ?? []).includes(permission),
  );
  if (grantingRoles.length === 0) {
    return deny(`No role grants permission "${permission}"`);
  }
  reasons.push(`Granted by role(s): ${grantingRoles.join(', ')}`);

  // 2. No-PII hard wall: no-PII roles can never reach PII permissions,
  //    and no-PII-only subjects cannot touch PII resources at all.
  const isPiiPermission = PII_PERMISSIONS.includes(permission);
  const grantedOnlyByNoPiiRoles = grantingRoles.every((r) => isNoPiiRole(r));
  if (isPiiPermission && grantedOnlyByNoPiiRoles) {
    return deny('No-PII roles can never exercise PII permissions');
  }
  if (
    subject.sessionKind === 'support_jit' &&
    isPiiPermission &&
    !subject.roles.includes('break_glass_admin')
  ) {
    return deny('Support JIT sessions cannot access personal data');
  }

  // 3. Module entitlement
  const requiredModule = resource.module ?? PERMISSION_MODULES[permission];
  if (requiredModule && !context.enabledModules.includes(requiredModule)) {
    return deny(`Module "${requiredModule}" is not enabled for this municipality`);
  }

  // 4. Organizational placement (ABAC): if the resource is bound to a
  //    department/unit, the subject needs a matching placement or a
  //    municipality-wide role.
  const orgWideRoles: RoleId[] = [
    'municipality_admin',
    'system_owner',
    'social_services_manager',
    'internal_auditor',
    'dpo',
    'lawyer',
    'information_security_officer',
    'ubm_export_manager',
    'controller',
    'control_investigator',
    'finance_officer',
  ];
  const hasOrgWideRole = subject.roles.some((r) => orgWideRoles.includes(r));
  if (resource.departmentId && !hasOrgWideRole) {
    if (!subject.departmentIds.includes(resource.departmentId)) {
      return deny('Subject does not belong to the department that owns this resource');
    }
  }

  // 5. Need-to-know: case-bound resources require assignment for case workers
  const needToKnowExemptRoles: RoleId[] = [
    'social_services_manager',
    'internal_auditor',
    'dpo',
    'lawyer',
    'controller',
    'control_investigator',
    'ubm_export_manager',
    'information_security_officer',
  ];
  if (resource.caseId && !subject.roles.some((r) => needToKnowExemptRoles.includes(r))) {
    if (!subject.assignedCaseIds.includes(resource.caseId)) {
      return deny('Need-to-know: subject is not assigned to this case and has no reviewer mandate');
    }
    reasons.push('Case assignment verified (need-to-know)');
  }

  // 6. Data-class constraints
  const dataClasses = resource.dataClasses ?? [];
  const sensitiveClasses = dataClasses.filter((dc) => requiresRevealReason(dc));
  if (resource.protectedIdentity || dataClasses.includes('protected_identity')) {
    const protectedIdentityRoles: RoleId[] = [
      'social_services_manager',
      'dpo',
      'lawyer',
      'control_investigator',
      'break_glass_admin',
    ];
    const hasElevated = subject.roles.some((r) => protectedIdentityRoles.includes(r));
    const assignedToCase =
      resource.caseId !== undefined && subject.assignedCaseIds.includes(resource.caseId);
    if (!hasElevated && !assignedToCase) {
      return deny('Protected identity data requires elevated role or direct case assignment');
    }
    if (!context.reason) {
      obligations.push('require_reason');
      return deny('Protected identity access requires a recorded reason');
    }
    obligations.push('log_sensitive_reveal');
  }

  if (permission === 'person.sensitive_field.reveal' || sensitiveClasses.length > 0) {
    if (!context.reason || context.reason.trim().length < 10) {
      obligations.push('require_reason');
      return deny(
        `Access to ${sensitiveClasses.join(', ') || 'sensitive fields'} requires a recorded reason (min 10 chars)`,
      );
    }
    obligations.push('log_sensitive_reveal');
  }

  // 7. Standard obligations
  obligations.push('log_data_access');
  if (dataClasses.length > 0 && permission !== 'person.sensitive_field.reveal') {
    obligations.push('mask_sensitive_fields');
  }

  return { allowed: true, permission, reasons, obligations: [...new Set(obligations)] };
}
