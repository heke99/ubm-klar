import 'server-only';
import { cookies, headers } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@ubm-klar/auth';

/**
 * Server-side API client. Every call:
 *  - goes to the backend API (never directly to the data plane),
 *  - forwards the original Host header so the API resolves the same tenant,
 *  - forwards the encrypted session cookie so the API authorizes the same user.
 *
 * Results are discriminated so pages can render loading/empty/error/forbidden
 * states without leaking backend error details.
 */

export type ApiResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden'; reasons?: string[] }
  | { kind: 'unknown_tenant' }
  | { kind: 'error'; status?: number };

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3001';
}

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const host = headerStore.get('host') ?? '';
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      headers: {
        host,
        ...(session ? { cookie: `${SESSION_COOKIE_NAME}=${session}` } : {}),
      },
      cache: 'no-store',
    });
  } catch {
    return { kind: 'error' };
  }

  if (response.status === 401) return { kind: 'unauthenticated' };
  if (response.status === 403) {
    const body = (await response.json().catch(() => ({}))) as { reasons?: string[] };
    return { kind: 'forbidden', ...(body.reasons ? { reasons: body.reasons } : {}) };
  }
  if (response.status === 421) return { kind: 'unknown_tenant' };
  if (!response.ok) return { kind: 'error', status: response.status };
  return { kind: 'ok', data: (await response.json()) as T };
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const host = headerStore.get('host') ?? '';
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: {
        host,
        'content-type': 'application/json',
        ...(session ? { cookie: `${SESSION_COOKIE_NAME}=${session}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
  } catch {
    return { kind: 'error' };
  }

  if (response.status === 401) return { kind: 'unauthenticated' };
  if (response.status === 403) return { kind: 'forbidden' };
  if (response.status === 421) return { kind: 'unknown_tenant' };
  if (!response.ok) return { kind: 'error', status: response.status };
  return { kind: 'ok', data: (await response.json()) as T };
}

export interface TenantInfo {
  municipality: string | undefined;
  tenantSlug: string | undefined;
  environment: string | undefined;
  tenantStatus: string | undefined;
  modules: string[] | undefined;
  featureFlags: Record<string, boolean> | undefined;
}

export async function fetchTenantInfo(): Promise<TenantInfo | undefined> {
  const result = await apiGet<TenantInfo>('/tenant');
  return result.kind === 'ok' ? result.data : undefined;
}
