import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AccessSubject } from '@ubm-klar/access-control';
import { ALL_ROLES, type RoleId } from '@ubm-klar/shared-types';

/**
 * Header-based auth behind a VERIFIED internal auth proxy.
 *
 * Disabled by default. Only usable when:
 *  - INTERNAL_AUTH_PROXY_TRUSTED=true (configuration), and
 *  - every request carries a valid HMAC signature over the identity headers,
 *    computed with the shared internal secret.
 *
 * Spoofed public headers fail: without the shared secret an attacker cannot
 * produce the signature, and requests without a signature are rejected.
 */

export const PROXY_SIGNATURE_HEADER = 'x-internal-auth-signature';

export const SIGNED_IDENTITY_HEADERS = [
  'x-user-id',
  'x-roles',
  'x-departments',
  'x-units',
  'x-assigned-cases',
  'x-session-kind',
  'x-session-expires-at',
] as const;

export class ProxyAuthError extends Error {
  constructor(
    public readonly code: 'not_trusted' | 'missing_signature' | 'bad_signature' | 'invalid_headers',
    message: string,
  ) {
    super(message);
    this.name = 'ProxyAuthError';
  }
}

export type HeaderMap = Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderMap, name: string): string {
  const value = headers[name];
  if (Array.isArray(value)) return value.join(',');
  return value ?? '';
}

/** Canonical string the proxy signs: name=value lines for the identity headers. */
export function proxySignaturePayload(headers: HeaderMap): string {
  return SIGNED_IDENTITY_HEADERS.map((name) => `${name}=${headerValue(headers, name)}`).join('\n');
}

export function signProxyHeaders(headers: HeaderMap, secret: string): string {
  return createHmac('sha256', secret).update(proxySignaturePayload(headers)).digest('hex');
}

const ROLE_SET = new Set<string>(ALL_ROLES);

export interface TrustedProxyOptions {
  trusted: boolean;
  secret: string | undefined;
}

/**
 * Verifies the proxy signature and builds the subject from identity headers.
 * Throws ProxyAuthError on any failure — callers must treat that as 401.
 */
export function subjectFromTrustedProxyHeaders(
  headers: HeaderMap,
  options: TrustedProxyOptions,
): AccessSubject {
  if (!options.trusted || !options.secret) {
    throw new ProxyAuthError(
      'not_trusted',
      'Header auth requires INTERNAL_AUTH_PROXY_TRUSTED=true and a shared secret',
    );
  }
  const presented = headerValue(headers, PROXY_SIGNATURE_HEADER);
  if (!presented) {
    throw new ProxyAuthError('missing_signature', 'Missing proxy signature header');
  }
  const expected = signProxyHeaders(headers, options.secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ProxyAuthError('bad_signature', 'Proxy signature verification failed');
  }

  const userId = headerValue(headers, 'x-user-id');
  if (!userId) throw new ProxyAuthError('invalid_headers', 'Missing x-user-id');

  const split = (name: string) =>
    headerValue(headers, name)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

  const roles = split('x-roles').filter((r) => ROLE_SET.has(r)) as RoleId[];
  const sessionKindRaw = headerValue(headers, 'x-session-kind');
  const sessionKind: AccessSubject['sessionKind'] =
    sessionKindRaw === 'support_jit' || sessionKindRaw === 'break_glass'
      ? sessionKindRaw
      : 'normal';
  const expiresRaw = headerValue(headers, 'x-session-expires-at');

  return {
    userId,
    roles,
    departmentIds: split('x-departments'),
    unitIds: split('x-units'),
    committeeIds: [],
    assignedCaseIds: split('x-assigned-cases'),
    sessionKind,
    ...(expiresRaw ? { sessionExpiresAt: Number(expiresRaw) } : {}),
  };
}
