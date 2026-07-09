import 'server-only';
import { LOCAL_DEV_SESSION_SECRET } from '@ubm-klar/auth';

/**
 * Server-side auth configuration for the web app. Values are read from the
 * environment (validated at startup by instrumentation.ts via loadAppConfig).
 */
export interface WebAuthConfig {
  mode: string;
  isProductionLike: boolean;
  provider: string;
  issuer: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  audience: string | undefined;
  sessionSecret: string;
  appBaseUrl: string;
  /** Dev login (choose a role, no IdP) — local/demo/test only. */
  devLoginEnabled: boolean;
}

export function getWebAuthConfig(): WebAuthConfig {
  const rawMode = (process.env.APP_ENV ?? '').toLowerCase();
  const mode =
    rawMode ||
    (process.env.NODE_ENV === 'production'
      ? 'prod'
      : process.env.NODE_ENV === 'test'
        ? 'test'
        : 'local');
  const isProductionLike = mode === 'stage' || mode === 'prod';
  const sessionSecret =
    process.env.SESSION_SECRET ?? (isProductionLike ? '' : LOCAL_DEV_SESSION_SECRET);
  if (!sessionSecret) {
    // instrumentation.ts already fails startup in stage/prod; this is defence in depth.
    throw new Error('SESSION_SECRET is required in stage/prod');
  }
  return {
    mode,
    isProductionLike,
    provider: process.env.AUTH_PROVIDER ?? (isProductionLike ? 'entra_id' : 'supabase_auth'),
    issuer: process.env.AUTH_ISSUER,
    clientId: process.env.AUTH_CLIENT_ID,
    clientSecret: process.env.AUTH_CLIENT_SECRET,
    audience: process.env.AUTH_AUDIENCE,
    sessionSecret,
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    devLoginEnabled: !isProductionLike,
  };
}
