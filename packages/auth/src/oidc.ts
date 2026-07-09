import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

/**
 * OIDC/Entra ID access- and id-token verification.
 *
 * Every token is verified for: signature (JWKS), issuer, audience, expiry,
 * not-before, and (for Entra) tenant binding via the issuer URL. Anything
 * else fails closed with TokenVerificationError.
 */

export type OidcProviderKind = 'entra_id' | 'oidc';

export interface OidcVerifierConfig {
  provider: OidcProviderKind;
  issuer: string;
  audience: string;
  /** Explicit JWKS URI; defaults to `${issuer}/.well-known/...` discovery for OIDC or the Entra keys endpoint. */
  jwksUri?: string;
  /** Static JWKS for tests/offline verification. */
  jwks?: JSONWebKeySet;
  /** Acceptable clock skew in seconds. */
  clockToleranceSec?: number;
}

export class TokenVerificationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_token'
      | 'invalid_issuer'
      | 'invalid_audience'
      | 'expired'
      | 'signature'
      | 'not_configured',
    message: string,
  ) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

export interface VerifiedToken {
  payload: JWTPayload;
  subject: string;
}

export class OidcTokenVerifier {
  private readonly getKey: JWTVerifyGetKey;

  constructor(private readonly config: OidcVerifierConfig) {
    if (!config.issuer || !config.audience) {
      throw new TokenVerificationError(
        'not_configured',
        'OIDC verifier requires issuer and audience',
      );
    }
    if (config.jwks) {
      this.getKey = createLocalJWKSet(config.jwks);
    } else {
      const jwksUri = config.jwksUri ?? defaultJwksUri(config.provider, config.issuer);
      this.getKey = createRemoteJWKSet(new URL(jwksUri));
    }
  }

  async verify(token: string): Promise<VerifiedToken> {
    if (!token || token.split('.').length !== 3) {
      throw new TokenVerificationError('invalid_token', 'Malformed JWT');
    }
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        clockTolerance: this.config.clockToleranceSec ?? 30,
      });
      if (!payload.sub) {
        throw new TokenVerificationError('invalid_token', 'Token missing sub claim');
      }
      return { payload, subject: payload.sub };
    } catch (error) {
      if (error instanceof TokenVerificationError) throw error;
      const message = error instanceof Error ? error.message : 'verification failed';
      if (/"exp"|expired/i.test(message)) {
        throw new TokenVerificationError('expired', message);
      }
      if (/"iss"|issuer/i.test(message)) {
        throw new TokenVerificationError('invalid_issuer', message);
      }
      if (/"aud"|audience/i.test(message)) {
        throw new TokenVerificationError('invalid_audience', message);
      }
      throw new TokenVerificationError('signature', message);
    }
  }
}

function defaultJwksUri(provider: OidcProviderKind, issuer: string): string {
  const base = issuer.replace(/\/$/, '');
  if (provider === 'entra_id') {
    // https://login.microsoftonline.com/{tenant}/v2.0 -> discovery/v2.0/keys
    return `${base.replace(/\/v2\.0$/, '')}/discovery/v2.0/keys`;
  }
  return `${base}/.well-known/jwks.json`;
}
