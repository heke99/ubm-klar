import { createSecretKey } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import type { AccessSubject } from '@ubm-klar/access-control';

/**
 * Encrypted web session tokens (A256GCM). The cookie value is opaque to the
 * browser: identity, roles and scopes cannot be read or forged client-side.
 */

export interface SessionData {
  subject: AccessSubject;
  displayName?: string;
  email?: string;
  authProvider: string;
  issuedAt: number;
}

export class SessionError extends Error {
  constructor(
    public readonly code: 'invalid' | 'expired' | 'not_configured',
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

function deriveKey(secret: string) {
  if (!secret || secret.length < 16) {
    throw new SessionError('not_configured', 'SESSION_SECRET must be at least 16 characters');
  }
  // Normalize arbitrary-length secrets to 32 bytes for A256GCM.
  const bytes = new TextEncoder().encode(secret.padEnd(32, '0').slice(0, 32));
  return createSecretKey(bytes);
}

export async function createSessionToken(
  data: SessionData,
  secret: string,
  ttlSeconds = 8 * 60 * 60,
): Promise<string> {
  const key = deriveKey(secret);
  return new EncryptJWT({ session: data as unknown as Record<string, unknown> })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .encrypt(key);
}

export async function readSessionToken(token: string, secret: string): Promise<SessionData> {
  const key = deriveKey(secret);
  try {
    const { payload } = await jwtDecrypt(token, key);
    const session = payload.session as SessionData | undefined;
    if (!session || !session.subject?.userId) {
      throw new SessionError('invalid', 'Session payload malformed');
    }
    if (session.subject.sessionExpiresAt && session.subject.sessionExpiresAt < Date.now()) {
      throw new SessionError('expired', 'Underlying auth session expired');
    }
    return session;
  } catch (error) {
    if (error instanceof SessionError) throw error;
    const message = error instanceof Error ? error.message : 'decrypt failed';
    throw new SessionError(/exp/i.test(message) ? 'expired' : 'invalid', message);
  }
}

export const SESSION_COOKIE_NAME = 'ubm_klar_session';

/**
 * Development-only fallback secret so web and API agree without configuration.
 * loadAppConfig requires a real SESSION_SECRET in stage/prod, so this value can
 * never be used there.
 */
export const LOCAL_DEV_SESSION_SECRET = 'local-dev-session-secret-32-chars!!';
