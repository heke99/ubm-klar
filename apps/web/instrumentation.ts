/**
 * Next.js server-start hook: validates environment configuration before the
 * web app serves any request. In stage/prod an unsafe or incomplete
 * configuration aborts startup (fail closed) instead of serving demo/static
 * fallbacks.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { loadAppConfig, UnsafeProductionConfigError } = await import('@ubm-klar/config');
  try {
    const config = loadAppConfig('web');
    console.info(`web configuration valid (${config.mode})`);
  } catch (error) {
    if (error instanceof UnsafeProductionConfigError) {
      console.error(`FATAL: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
