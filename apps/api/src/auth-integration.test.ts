import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from 'jose';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import {
  createSessionToken,
  OidcTokenVerifier,
  SESSION_COOKIE_NAME,
  signProxyHeaders,
  PROXY_SIGNATURE_HEADER,
} from '@ubm-klar/auth';
import { buildApiServer } from './server';

const ISSUER = 'https://login.microsoftonline.com/tenant-123/v2.0';
const AUDIENCE = 'api://ubm-klar';
const SESSION_SECRET = 'session-secret-with-32-characters!';
const PROXY_SECRET = 'internal-proxy-shared-secret';

const record: TenantDirectoryRecord = {
  tenantId: 'tenant-malmo',
  tenantSlug: 'malmo',
  municipalityName: 'Malmö stad',
  deploymentMode: 'model_b_vendor_hosted_isolated',
  environment: 'prod',
  domain: 'malmo.ubmklar.se',
  domainVerified: true,
  activeModules: ['lss', 'economic_assistance', 'payment_control', 'control_cases'],
  dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
  dataPlanePublishableKey: 'sb_publishable_malmo',
  authProvider: 'entra_id',
  featureFlags: {},
};

const directory: TenantDirectory = {
  lookupByDomain: async (domain) => (domain === 'malmo.ubmklar.se' ? record : undefined),
};

let jwks: JSONWebKeySet;
let signKey: CryptoKey;
let wrongKey: CryptoKey;
let app: FastifyInstance;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  const wrongPair = await generateKeyPair('RS256');
  signKey = pair.privateKey as CryptoKey;
  wrongKey = wrongPair.privateKey as CryptoKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'RS256', kid: 'k1' }] };

  // Production-like server: no demo tenant, no insecure header auth.
  app = buildApiServer({
    directory,
    allowDemoTenant: false,
    auth: {
      verifier: new OidcTokenVerifier({
        provider: 'entra_id',
        issuer: ISSUER,
        audience: AUDIENCE,
        jwks,
      }),
      sessionSecret: SESSION_SECRET,
      headerProxy: { trusted: true, secret: PROXY_SECRET },
      allowInsecureHeaderAuth: false,
    },
  });
});

async function makeToken(
  claims: Record<string, unknown> = {},
  opts: { key?: CryptoKey; issuer?: string; expiresIn?: string } = {},
) {
  return new SignJWT({ roles: ['lss_case_worker'], departments: ['dep-lss'], ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('user-1')
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '10m')
    .sign(opts.key ?? signKey);
}

const HOST = { host: 'malmo.ubmklar.se' };

describe('API auth — production-like server', () => {
  it('rejects unauthenticated requests to protected routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/dashboards/lss', headers: HOST });
    expect(response.statusCode).toBe(401);
  });

  it('rejects spoofed plain identity headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { ...HOST, 'x-user-id': 'attacker', 'x-roles': 'municipality_admin' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts a valid Entra/OIDC bearer token with the right role', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { ...HOST, authorization: `Bearer ${await makeToken()}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects tokens signed with the wrong key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { ...HOST, authorization: `Bearer ${await makeToken({}, { key: wrongKey })}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('authentication_failed');
  });

  it('rejects expired tokens', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { ...HOST, authorization: `Bearer ${await makeToken({}, { expiresIn: '-5m' })}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('expired');
  });

  it('rejects tokens from a foreign issuer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: {
        ...HOST,
        authorization: `Bearer ${await makeToken({}, { issuer: 'https://evil.example' })}`,
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('enforces authorization: authenticated but wrong role gets 403', async () => {
    const token = await makeToken({ roles: ['billing_admin_no_pii'] });
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { ...HOST, authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('accepts an encrypted web session cookie', async () => {
    const cookie = await createSessionToken(
      {
        subject: {
          userId: 'user-2',
          roles: ['economic_assistance_case_worker'],
          departmentIds: ['dep-ea'],
          unitIds: [],
          committeeIds: [],
          assignedCaseIds: [],
          sessionKind: 'normal',
        },
        authProvider: 'entra_id',
        issuedAt: Date.now(),
      },
      SESSION_SECRET,
    );
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/economic-assistance',
      headers: { ...HOST, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects tampered session cookies', async () => {
    const cookie = await createSessionToken(
      {
        subject: {
          userId: 'user-2',
          roles: ['economic_assistance_case_worker'],
          departmentIds: [],
          unitIds: [],
          committeeIds: [],
          assignedCaseIds: [],
          sessionKind: 'normal',
        },
        authProvider: 'entra_id',
        issuedAt: Date.now(),
      },
      SESSION_SECRET,
    );
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/economic-assistance',
      headers: { ...HOST, cookie: `${SESSION_COOKIE_NAME}=${cookie}tampered` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts HMAC-signed trusted proxy headers', async () => {
    const headers: Record<string, string> = {
      'x-user-id': 'proxy-user',
      'x-roles': 'controller',
      'x-departments': '',
      'x-units': '',
      'x-assigned-cases': '',
      'x-session-kind': 'normal',
      'x-session-expires-at': '',
    };
    headers[PROXY_SIGNATURE_HEADER] = signProxyHeaders(headers, PROXY_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { ...HOST, ...headers },
    });
    // controller has case.lss.read? controller role includes payment/control permissions.
    expect([200, 403]).toContain(response.statusCode);
    expect(response.statusCode).not.toBe(401);
  });

  it('rejects proxy headers with a forged signature', async () => {
    const headers: Record<string, string> = {
      'x-user-id': 'attacker',
      'x-roles': 'municipality_admin',
    };
    headers[PROXY_SIGNATURE_HEADER] = 'deadbeef'.repeat(8);
    const response = await app.inject({
      method: 'GET',
      url: '/dashboards/lss',
      headers: { ...HOST, ...headers },
    });
    expect(response.statusCode).toBe(401);
  });
});
