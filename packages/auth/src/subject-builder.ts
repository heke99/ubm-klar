import type { JWTPayload } from 'jose';
import type { AccessSubject } from '@ubm-klar/access-control';
import { ALL_ROLES, type RoleId } from '@ubm-klar/shared-types';

/**
 * Builds the authorization subject from verified token claims.
 *
 * Roles come either from a direct `roles` claim or from a groups->role mapping
 * configured per tenant (Entra group object IDs to UBM Klar roles). Unknown
 * roles/groups are dropped — never defaulted up.
 */

export interface AuthenticatedUser {
  subject: AccessSubject;
  displayName: string | undefined;
  email: string | undefined;
  tenantId: string | undefined;
}

export interface SubjectBuilderOptions {
  /** Map from IdP group id/name to UBM Klar role. */
  groupRoleMapping?: Record<string, RoleId>;
  /** Claim names, overridable per IdP. */
  claims?: {
    roles?: string;
    groups?: string;
    departments?: string;
    units?: string;
    assignedCases?: string;
    displayName?: string;
    email?: string;
    tenantId?: string;
  };
}

const ROLE_SET = new Set<string>(ALL_ROLES);

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value.length > 0) {
    return value
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

export function buildSubjectFromClaims(
  payload: JWTPayload,
  options: SubjectBuilderOptions = {},
): AuthenticatedUser {
  const claims = options.claims ?? {};
  const directRoles = asStringArray(payload[claims.roles ?? 'roles']).filter((r) =>
    ROLE_SET.has(r),
  ) as RoleId[];

  const groups = asStringArray(payload[claims.groups ?? 'groups']);
  const mappedRoles = groups
    .map((g) => options.groupRoleMapping?.[g])
    .filter((r): r is RoleId => r !== undefined);

  const roles = [...new Set([...directRoles, ...mappedRoles])];

  const expiry = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;

  const subject: AccessSubject = {
    userId: payload.sub ?? '',
    roles,
    departmentIds: asStringArray(payload[claims.departments ?? 'departments']),
    unitIds: asStringArray(payload[claims.units ?? 'units']),
    committeeIds: [],
    assignedCaseIds: asStringArray(payload[claims.assignedCases ?? 'assigned_cases']),
    sessionKind: 'normal',
    ...(expiry !== undefined ? { sessionExpiresAt: expiry } : {}),
  };

  const displayName = payload[claims.displayName ?? 'name'];
  const email = payload[claims.email ?? 'email'] ?? payload['preferred_username'];
  const tenantId = payload[claims.tenantId ?? 'tid'];

  return {
    subject,
    displayName: typeof displayName === 'string' ? displayName : undefined,
    email: typeof email === 'string' ? email : undefined,
    tenantId: typeof tenantId === 'string' ? tenantId : undefined,
  };
}
