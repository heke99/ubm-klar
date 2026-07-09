import { NextResponse, type NextRequest } from 'next/server';
import { getWebAuthConfig } from '../../../lib/auth-config';
import { buildAuthorizeUrl, createPkcePair, createStateToken } from '../../../lib/oidc-client';

export const dynamic = 'force-dynamic';

/** Starts the OIDC authorization-code login (with PKCE). */
export async function GET(request: NextRequest) {
  const config = getWebAuthConfig();
  if (!config.issuer || !config.clientId) {
    return NextResponse.redirect(new URL('/login?error=sso_not_configured', request.url));
  }
  const state = createStateToken();
  const pkce = createPkcePair();
  const redirectUri = `${config.appBaseUrl}/auth/callback`;

  const authorizeUrl = await buildAuthorizeUrl({
    issuer: config.issuer,
    clientId: config.clientId,
    redirectUri,
    state,
    pkceChallenge: pkce.challenge,
  });

  const response = NextResponse.redirect(authorizeUrl);
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProductionLike,
    path: '/',
    maxAge: 600,
  };
  response.cookies.set('ubm_auth_state', state, cookieOptions);
  response.cookies.set('ubm_auth_pkce', pkce.verifier, cookieOptions);
  return response;
}
