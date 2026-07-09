import { loadAppConfig, UnsafeProductionConfigError } from '@ubm-klar/config';
import { LOCAL_DEV_SESSION_SECRET, OidcTokenVerifier } from '@ubm-klar/auth';
import {
  ClamAvScanner,
  DisabledMalwareScanner,
  ExternalApiScanner,
  LocalFileStorage,
  S3CompatibleStorage,
  SupabaseStorageAdapter,
  type DocumentStorage,
  type MalwareScanner,
} from '@ubm-klar/document-vault';
import { buildApiServer, type ApiAuthOptions } from './server';
import { TenantDataPlanePool } from './data-plane';
import { ControlPlaneTenantDirectory, type TenantDirectory } from '@ubm-klar/tenant-resolver';

const config = (() => {
  try {
    return loadAppConfig('api');
  } catch (error) {
    if (error instanceof UnsafeProductionConfigError) {
      console.error(`FATAL: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
})();

/**
 * Tenant directory selection:
 * - CONTROL_PLANE_URL set: real control-plane-backed directory (required in
 *   stage/prod by loadAppConfig).
 * - otherwise (local/demo/test only): an empty directory — every non-localhost
 *   host fails closed with 421 and only the demo tenant on localhost works.
 */
function selectDirectory(): TenantDirectory {
  if (config.controlPlane.url) {
    const directoryToken =
      process.env.CONTROL_PLANE_DIRECTORY_TOKEN ?? process.env.CONTROL_PLANE_ADMIN_TOKEN;
    return new ControlPlaneTenantDirectory({
      baseUrl: config.controlPlane.url,
      ...(directoryToken ? { directoryToken } : {}),
    });
  }
  if (config.isProductionLike) {
    // Defense in depth: loadAppConfig already requires CONTROL_PLANE_URL.
    console.error('FATAL: production start refused — no tenant directory configured.');
    process.exit(1);
  }
  console.warn('api using empty tenant directory (local/demo/test only; demo tenant on localhost)');
  return { lookupByDomain: async () => undefined };
}

function buildAuthOptions(): ApiAuthOptions {
  const auth: ApiAuthOptions = {
    allowInsecureHeaderAuth: !config.isProductionLike,
  };
  if (
    (config.auth.provider === 'entra_id' || config.auth.provider === 'oidc') &&
    config.auth.issuer &&
    (config.auth.audience || config.auth.clientId)
  ) {
    auth.verifier = new OidcTokenVerifier({
      provider: config.auth.provider,
      issuer: config.auth.issuer,
      audience: config.auth.audience ?? config.auth.clientId!,
      ...(config.auth.jwksUri ? { jwksUri: config.auth.jwksUri } : {}),
    });
  }
  const sessionSecret =
    process.env.SESSION_SECRET ?? (config.isProductionLike ? undefined : LOCAL_DEV_SESSION_SECRET);
  if (sessionSecret) auth.sessionSecret = sessionSecret;
  if (config.auth.headerProxy.trusted && process.env.INTERNAL_AUTH_PROXY_SECRET) {
    auth.headerProxy = {
      trusted: true,
      secret: process.env.INTERNAL_AUTH_PROXY_SECRET,
    };
  }
  return auth;
}

function buildDocumentStorage(): DocumentStorage {
  const provider = config.documents.storageProvider;
  if (provider === 'supabase') {
    return new SupabaseStorageAdapter({
      url: process.env.DOCUMENT_STORAGE_SUPABASE_URL ?? '',
      serviceKey: process.env.DOCUMENT_STORAGE_SUPABASE_SERVICE_KEY ?? '',
      bucket: process.env.DOCUMENT_STORAGE_BUCKET ?? 'ubm-klar-documents',
    });
  }
  if (provider === 's3') {
    return new S3CompatibleStorage({
      endpoint: process.env.DOCUMENT_STORAGE_S3_ENDPOINT ?? '',
      region: process.env.DOCUMENT_STORAGE_S3_REGION ?? 'eu-north-1',
      bucket: process.env.DOCUMENT_STORAGE_BUCKET ?? 'ubm-klar-documents',
      accessKeyId: process.env.DOCUMENT_STORAGE_S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY ?? '',
    });
  }
  // local: dev/test only (loadAppConfig refuses this in stage/prod)
  return new LocalFileStorage(process.env.DOCUMENT_STORAGE_LOCAL_DIR ?? '/tmp/ubm-klar-vault');
}

function buildScanner(): MalwareScanner {
  const provider = config.documents.malwareScannerProvider;
  if (provider === 'clamav') {
    return new ClamAvScanner(
      process.env.MALWARE_SCANNER_CLAMAV_HOST ?? 'localhost',
      Number(process.env.MALWARE_SCANNER_CLAMAV_PORT ?? 3310),
    );
  }
  if (provider === 'external-api') {
    return new ExternalApiScanner(
      process.env.MALWARE_SCANNER_ENDPOINT ?? '',
      process.env.MALWARE_SCANNER_API_KEY,
    );
  }
  return new DisabledMalwareScanner();
}

const port = Number(process.env.API_PORT ?? 3001);
const app = buildApiServer({
  directory: selectDirectory(),
  allowDemoTenant: config.tenantResolver.allowDemoTenant,
  cacheTtlMs: config.tenantResolver.cacheTtlSeconds * 1000,
  auth: buildAuthOptions(),
  dataPlane: new TenantDataPlanePool(),
  demoDataEnabled: config.demo.demoDataEnabled,
  documents: {
    storage: buildDocumentStorage(),
    scanner: buildScanner(),
    scannerProvider: config.documents.malwareScannerProvider,
    isProductionLike: config.isProductionLike,
  },
});

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.info(`api listening on :${port} (${config.mode})`);
});
