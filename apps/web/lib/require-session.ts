import 'server-only';
import { redirect } from 'next/navigation';
import type { SessionData } from '@ubm-klar/auth';
import type { RoleId } from '@ubm-klar/shared-types';
import { getSession } from './session';

/**
 * Server-component guard: redirects anonymous users to /login. Role checks are
 * a UX convenience — the backend authorizes every API call regardless.
 */
export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export function hasAnyRole(session: SessionData, roles: readonly RoleId[]): boolean {
  return session.subject.roles.some((r) => (roles as readonly string[]).includes(r));
}
