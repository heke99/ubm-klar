import { NextResponse, type NextRequest } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME } from '@ubm-klar/auth';
import { ALL_ROLES, type RoleId } from '@ubm-klar/shared-types';
import { getWebAuthConfig } from '../../../lib/auth-config';

export const dynamic = 'force-dynamic';

/**
 * Development login: pick a role, get a session. ONLY available in
 * local/demo/test — stage/prod always answer 404 so this can never be an
 * authentication bypass.
 */
export async function POST(request: NextRequest) {
  const config = getWebAuthConfig();
  if (!config.devLoginEnabled) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const { rateLimit, clientKey } = await import('../../../lib/rate-limit');
  if (!rateLimit(clientKey(request.headers, 'dev-login'), 20)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const form = await request.formData();
  const role = String(form.get('role') ?? '');
  const userName = String(form.get('name') ?? 'Demoanvändare');
  if (!(ALL_ROLES as readonly string[]).includes(role)) {
    return NextResponse.redirect(new URL('/login?error=invalid_role', request.url));
  }

  const token = await createSessionToken(
    {
      subject: {
        userId: `dev-${role}`,
        roles: [role as RoleId],
        departmentIds: ['demo-dep'],
        unitIds: [],
        committeeIds: [],
        assignedCaseIds: [],
        sessionKind: 'normal',
      },
      displayName: `${userName} (demo)`,
      authProvider: 'dev_login',
      issuedAt: Date.now(),
    },
    config.sessionSecret,
  );

  const response = NextResponse.redirect(new URL('/', request.url), 303);
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  return response;
}
