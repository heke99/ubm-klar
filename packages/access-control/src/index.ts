export type AccessDecision = {
  allowed: boolean;
  reason: string;
  requiresAuditLog: boolean;
  requiresDataAccessLog: boolean;
  requiresPurpose: boolean;
  requiresSensitiveRevealReason: boolean;
};

export type AccessContext = {
  userId: string;
  municipalityId: string;
  roles: string[];
  permissions: string[];
  module: string;
  dataClass: string;
  purpose?: string;
  assignedCaseIds?: string[];
  requestedCaseId?: string;
};

export function deny(reason: string): AccessDecision {
  return {
    allowed: false,
    reason,
    requiresAuditLog: true,
    requiresDataAccessLog: true,
    requiresPurpose: true,
    requiresSensitiveRevealReason: false,
  };
}

export function allow(reason: string): AccessDecision {
  return {
    allowed: true,
    reason,
    requiresAuditLog: true,
    requiresDataAccessLog: true,
    requiresPurpose: true,
    requiresSensitiveRevealReason: false,
  };
}

export function canRead(ctx: AccessContext): AccessDecision {
  if (!ctx.purpose) return deny('Access requires a registered purpose.');
  if (ctx.dataClass === 'protected_identity' && !ctx.permissions.includes('protected_identity.read')) {
    return deny('Protected identity access requires elevated permission.');
  }
  if (ctx.requestedCaseId && ctx.assignedCaseIds && !ctx.assignedCaseIds.includes(ctx.requestedCaseId)) {
    return deny('Need-to-know or case assignment is required.');
  }
  return allow('Access permitted by current role, purpose, and need-to-know context.');
}
