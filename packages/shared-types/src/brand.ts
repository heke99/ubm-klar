/**
 * Brand-safe product copy.
 *
 * UBM Klar must never present itself as an official system of Utbetalningsmyndigheten
 * or any other authority. All UI surfaces must carry the disclaimer below.
 */
export const PRODUCT_NAME = 'UBM Klar';

export const PRODUCT_TAGLINE_SV =
  'UBM Klar hjälper kommunen att strukturera, kvalitetssäkra, kontrollera och förbereda uppgifter inför UBM-processer.';

export const NON_AUTHORITY_DISCLAIMER_SV =
  'UBM Klar är en fristående produkt och är inte en tjänst från Utbetalningsmyndigheten eller någon annan myndighet.';

export const NON_AUTHORITY_DISCLAIMER_EN =
  'UBM Klar is an independent product and is not a service provided by Utbetalningsmyndigheten or any other public authority.';

/** Vendor-hosted (Model B) tenants live under this base domain. */
export const MODEL_B_BASE_DOMAIN = 'ubmklar.se';

/**
 * Domains that would imply official authority affiliation and are forbidden
 * as tenant domains (exact or suffix match).
 */
export const FORBIDDEN_DOMAIN_PATTERNS: readonly string[] = [
  'ubm.se',
  'utbetalningsmyndigheten.se',
  'regeringen.se',
  'government.se',
  'gov.se',
] as const;
