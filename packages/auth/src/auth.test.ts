import { describe, expect, it, beforeAll } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from 'jose';
import { OidcTokenVerifier, TokenVerificationError } from './oidc';
import { buildSubjectFromClaims } from './subject-builder';
import {
  ProxyAuthError,
  signProxyHeaders,
  subjectFromTrustedProxyHeaders,
  PROXY_SIGNATURE_HEADER,
} from './header-proxy';
import { samlProviderStatus, verifySamlAssertion } from './saml';
import { createSessionToken, readSessionToken, SessionError } from './session';

const ISSUER = 'https://login.microsoftonline.com/tenant-123/v2.0';
const AUDIENCE = 'api://ubm-klar';

let jwks: JSONWebKeySet;
let signKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  const otherPair = await generateKeyPair('RS256');
  signKey = pair.privateKey as CryptoKey;
  otherKey = otherPair.privateKey as CryptoKey;
  const jwk = await exportJWK(pair.publicKey);
  jwks = { keys: [{ ...jwk, alg: 'RS256', kid: 'test-key' }] };
});

async function makeToken(
  overrides: Record<string, unknown> = {},
  options: { key?: CryptoKey; issuer?: string; audience?: string; expiresIn?: string } = {},
) {
  return new SignJWT({
    roles: ['lss_case_worker'],
    departments: ['dep-1'],
    assigned_cases: ['case-1'],
    name: 'Test Handläggare',
    email: 'test@kommun.se',
    tid: 'tenant-123',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('user-1')
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '10m')
    .sign(options.key ?? signKey);
}

describe('OidcTokenVerifier', () => {
  function makeVerifier() {
    return new OidcTokenVerifier({
      provider: 'entra_id',
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks,
    });
  }

  it('verifies a valid token and returns the payload', async () => {
    const verifier = makeVerifier();
    const result = await verifier.verify(await makeToken());
    expect(result.subject).toBe('user-1');
    expect(result.payload.tid).toBe('tenant-123');
  });

  it('rejects a token signed with the wrong key', async () => {
    const verifier = makeVerifier();
    await expect(verifier.verify(await makeToken({}, { key: otherKey }))).rejects.toThrow(
      TokenVerificationError,
    );
  });

  it('rejects a token from the wrong issuer', async () => {
    const verifier = makeVerifier();
    await expect(
      verifier.verify(await makeToken({}, { issuer: 'https://evil.example.com' })),
    ).rejects.toMatchObject({ code: 'invalid_issuer' });
  });

  it('rejects a token for the wrong audience', async () => {
    const verifier = makeVerifier();
    await expect(
      verifier.verify(await makeToken({}, { audience: 'api://other-app' })),
    ).rejects.toMatchObject({ code: 'invalid_audience' });
  });

  it('rejects an expired token', async () => {
    const verifier = makeVerifier();
    await expect(verifier.verify(await makeToken({}, { expiresIn: '-10m' }))).rejects.toMatchObject(
      { code: 'expired' },
    );
  });

  it('rejects malformed tokens', async () => {
    const verifier = makeVerifier();
    await expect(verifier.verify('not-a-jwt')).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('requires issuer and audience configuration', () => {
    expect(
      () => new OidcTokenVerifier({ provider: 'oidc', issuer: '', audience: '', jwks }),
    ).toThrow(TokenVerificationError);
  });
});

describe('buildSubjectFromClaims', () => {
  it('maps direct role claims, dropping unknown roles', () => {
    const { subject, displayName, email } = buildSubjectFromClaims({
      sub: 'user-1',
      roles: ['lss_case_worker', 'made_up_superrole'],
      departments: ['dep-1'],
      assigned_cases: ['case-1', 'case-2'],
      name: 'Test Handläggare',
      email: 'test@kommun.se',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    expect(subject.roles).toEqual(['lss_case_worker']);
    expect(subject.departmentIds).toEqual(['dep-1']);
    expect(subject.assignedCaseIds).toEqual(['case-1', 'case-2']);
    expect(subject.sessionKind).toBe('normal');
    expect(subject.sessionExpiresAt).toBeGreaterThan(Date.now());
    expect(displayName).toBe('Test Handläggare');
    expect(email).toBe('test@kommun.se');
  });

  it('maps Entra groups to roles via the tenant mapping', () => {
    const { subject } = buildSubjectFromClaims(
      { sub: 'user-2', groups: ['aad-group-guid-1', 'aad-group-guid-unknown'] },
      { groupRoleMapping: { 'aad-group-guid-1': 'controller' } },
    );
    expect(subject.roles).toEqual(['controller']);
  });

  it('produces an empty-role subject for tokens without role claims', () => {
    const { subject } = buildSubjectFromClaims({ sub: 'user-3' });
    expect(subject.roles).toEqual([]);
  });
});

describe('trusted proxy header auth', () => {
  const SECRET = 'internal-proxy-secret';

  function signedHeaders() {
    const headers: Record<string, string> = {
      'x-user-id': 'user-1',
      'x-roles': 'lss_case_worker',
      'x-departments': 'dep-1',
      'x-session-kind': 'normal',
    };
    headers[PROXY_SIGNATURE_HEADER] = signProxyHeaders(headers, SECRET);
    return headers;
  }

  it('accepts correctly signed headers', () => {
    const subject = subjectFromTrustedProxyHeaders(signedHeaders(), {
      trusted: true,
      secret: SECRET,
    });
    expect(subject.userId).toBe('user-1');
    expect(subject.roles).toEqual(['lss_case_worker']);
  });

  it('rejects when the proxy is not trusted', () => {
    expect(() =>
      subjectFromTrustedProxyHeaders(signedHeaders(), { trusted: false, secret: SECRET }),
    ).toThrow(ProxyAuthError);
  });

  it('rejects spoofed headers without a signature', () => {
    const headers = { 'x-user-id': 'attacker', 'x-roles': 'municipality_admin' };
    expect(() =>
      subjectFromTrustedProxyHeaders(headers, { trusted: true, secret: SECRET }),
    ).toThrow(/signature/i);
  });

  it('rejects tampered headers (signature no longer matches)', () => {
    const headers = signedHeaders();
    headers['x-roles'] = 'municipality_admin';
    expect(() =>
      subjectFromTrustedProxyHeaders(headers, { trusted: true, secret: SECRET }),
    ).toThrow(/signature/i);
  });

  it('rejects a signature made with the wrong secret', () => {
    const headers: Record<string, string> = { 'x-user-id': 'user-1', 'x-roles': 'lss_case_worker' };
    headers[PROXY_SIGNATURE_HEADER] = signProxyHeaders(headers, 'wrong-secret');
    expect(() =>
      subjectFromTrustedProxyHeaders(headers, { trusted: true, secret: SECRET }),
    ).toThrow(/signature/i);
  });
});

describe('SAML abstraction', () => {
  it('reports unavailable and refuses to verify', () => {
    expect(samlProviderStatus().available).toBe(false);
    expect(() => verifySamlAssertion()).toThrow(/not implemented/i);
  });
});

describe('web sessions', () => {
  const SECRET = 'session-secret-with-32-characters!';

  it('round-trips an encrypted session', async () => {
    const token = await createSessionToken(
      {
        subject: {
          userId: 'user-1',
          roles: ['lss_case_worker'],
          departmentIds: [],
          unitIds: [],
          committeeIds: [],
          assignedCaseIds: [],
          sessionKind: 'normal',
        },
        displayName: 'Test',
        authProvider: 'entra_id',
        issuedAt: Date.now(),
      },
      SECRET,
    );
    const session = await readSessionToken(token, SECRET);
    expect(session.subject.userId).toBe('user-1');
    expect(token).not.toContain('user-1'); // encrypted, not merely encoded
  });

  it('rejects tampered or foreign tokens', async () => {
    const token = await createSessionToken(
      {
        subject: {
          userId: 'user-1',
          roles: [],
          departmentIds: [],
          unitIds: [],
          committeeIds: [],
          assignedCaseIds: [],
          sessionKind: 'normal',
        },
        authProvider: 'entra_id',
        issuedAt: Date.now(),
      },
      SECRET,
    );
    await expect(readSessionToken(token + 'x', SECRET)).rejects.toThrow(SessionError);
    await expect(readSessionToken(token, 'another-secret-32-characters-xx!')).rejects.toThrow(
      SessionError,
    );
  });

  it('rejects expired sessions', async () => {
    const token = await createSessionToken(
      {
        subject: {
          userId: 'user-1',
          roles: [],
          departmentIds: [],
          unitIds: [],
          committeeIds: [],
          assignedCaseIds: [],
          sessionKind: 'normal',
        },
        authProvider: 'entra_id',
        issuedAt: Date.now(),
      },
      SECRET,
      -60,
    );
    await expect(readSessionToken(token, SECRET)).rejects.toMatchObject({ code: 'expired' });
  });
});
