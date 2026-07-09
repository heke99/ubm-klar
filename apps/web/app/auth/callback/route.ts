import { NextResponse, type NextRequest } from 'next/server';
import { buildSubjectFromClaims, createSessionToken, SESSION_COOKIE_NAME } from '@ubm-klar/auth';
import { getWebAuthConfig } from '../../../lib/auth-config';
import { exchangeCodeAndVerify } from '../../../lib/oidc-client';

export const dynamic = 'force-dynamic';

/**
 * OIDC redirect target: verifies state, exchanges the code, verifies the
 * id_token (signature/issuer/audience/expiry) and creates the encrypted
 * session cookie. Any mismatch aborts to /login with a generic error.
 */
export async function GET(request: NextRequest) {
  const { rateLimit, clientKey } = await import('../../../lib/rate-limit');
  if (!rateLimit(clientKey(request.headers, 'callback'), 30)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const config = getWebAuthConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = request.cookies.get('ubm_auth_state')?.value;
  const pkceVerifier = request.cookies.get('ubm_auth_pkce')?.value;

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, request.url));

  if (!code || !state || !expectedState || state !== expectedState || !pkceVerifier) {
    return fail('state_mismatch');
  }
  if (!config.issuer || !config.clientId) {
    return fail('sso_not_configured');
  }

  let claims: Record<string, unknown>;
  try {
    const result = await exchangeCodeAndVerify({
      issuer: config.issuer,
      clientId: config.clientId,
      ...(config.clientSecret ? { clientSecret: config.clientSecret } : {}),
      redirectUri: `${config.appBaseUrl}/auth/callback`,
      code,
      pkceVerifier,
      provider: config.provider === 'entra_id' ? 'entra_id' : 'oidc',
    });
    claims = result.claims;
  } catch {
    // Never leak IdP error details to the browser.
    return fail('login_failed');
  }

  const { subject, displayName, email } = buildSubjectFromClaims(claims);
  const token = await createSessionToken(
    {
      subject,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(email !== undefined ? { email } : {}),
      authProvider: config.provider,
      issuedAt: Date.now(),
    },
    config.sessionSecret,
  );

  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProductionLike,
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  response.cookies.delete('ubm_auth_state');
  response.cookies.delete('ubm_auth_pkce');
  return response;
}
