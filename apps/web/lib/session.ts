import 'server-only';
import { cookies } from 'next/headers';
import {
  readSessionToken,
  SESSION_COOKIE_NAME,
  SessionError,
  type SessionData,
} from '@ubm-klar/auth';
import { getWebAuthConfig } from './auth-config';

/**
 * Reads the encrypted session for the current request. Returns undefined for
 * anonymous/expired/invalid sessions — pages redirect to /login as needed.
 * Navigation uses the session roles as a convenience only: the backend
 * authorizes every request regardless of what the frontend shows.
 */
export async function getSession(): Promise<SessionData | undefined> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return undefined;
  try {
    return await readSessionToken(token, getWebAuthConfig().sessionSecret);
  } catch (error) {
    if (error instanceof SessionError) return undefined;
    throw error;
  }
}
