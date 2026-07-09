import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { OidcTokenVerifier } from '@ubm-klar/auth';

/**
 * Server-side OIDC authorization-code client (with PKCE) for the web login.
 * Endpoints come from the issuer's discovery document; the id_token is verified
 * (signature/issuer/audience/expiry) before any session is created.
 */

export interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

const discoveryCache = new Map<string, OidcEndpoints>();

export async function discoverEndpoints(issuer: string): Promise<OidcEndpoints> {
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed: ${response.status} from ${url}`);
  }
  const doc = (await response.json()) as {
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
  };
  const endpoints: OidcEndpoints = {
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksUri: doc.jwks_uri,
  };
  discoveryCache.set(issuer, endpoints);
  return endpoints;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createStateToken(): string {
  return randomBytes(16).toString('base64url');
}

export interface AuthorizeUrlInput {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
  pkceChallenge: string;
  scopes?: string[];
}

export async function buildAuthorizeUrl(input: AuthorizeUrlInput): Promise<string> {
  const endpoints = await discoverEndpoints(input.issuer);
  const url = new URL(endpoints.authorizationEndpoint);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', (input.scopes ?? ['openid', 'profile', 'email']).join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.pkceChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface TokenExchangeInput {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  pkceVerifier: string;
  provider: 'entra_id' | 'oidc';
}

export interface VerifiedLogin {
  claims: Record<string, unknown>;
}

export async function exchangeCodeAndVerify(input: TokenExchangeInput): Promise<VerifiedLogin> {
  const endpoints = await discoverEndpoints(input.issuer);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.pkceVerifier,
  });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);

  const response = await fetch(endpoints.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed with status ${response.status}`);
  }
  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) {
    throw new Error('Token response missing id_token');
  }

  const verifier = new OidcTokenVerifier({
    provider: input.provider,
    issuer: input.issuer,
    audience: input.clientId,
    jwksUri: endpoints.jwksUri,
  });
  const { payload } = await verifier.verify(tokens.id_token);
  return { claims: payload as Record<string, unknown> };
}
