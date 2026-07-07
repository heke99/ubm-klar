import { FORBIDDEN_DOMAIN_PATTERNS, MODEL_B_BASE_DOMAIN } from './brand';

export type DomainValidationResult =
  | { valid: true; domainModel: 'model_b_subdomain' | 'model_c_municipality_domain' }
  | { valid: false; reason: string };

const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function isWellFormed(domain: string): boolean {
  if (domain.length > 253 || domain.length < 4) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => LABEL_PATTERN.test(label));
}

/**
 * Validates a tenant domain against the brand/domain rules:
 * - Model B: `<slug>.ubmklar.se` or `<slug>-test|-stage.ubmklar.se`
 * - Model C: a subdomain of a municipality-owned domain (e.g. `ubm-klar.malmo.se`)
 * - Never a domain implying authority affiliation (ubm.se, utbetalningsmyndigheten.se, ...)
 */
export function validateTenantDomain(rawDomain: string): DomainValidationResult {
  const domain = rawDomain.trim().toLowerCase().replace(/\.$/, '');

  if (!isWellFormed(domain)) {
    return { valid: false, reason: `Malformed domain: ${rawDomain}` };
  }

  for (const forbidden of FORBIDDEN_DOMAIN_PATTERNS) {
    if (domain === forbidden || domain.endsWith(`.${forbidden}`)) {
      return {
        valid: false,
        reason: `Domain "${domain}" implies authority affiliation (${forbidden}) and is forbidden`,
      };
    }
  }

  if (domain === MODEL_B_BASE_DOMAIN) {
    return { valid: false, reason: 'The bare product domain cannot be a tenant domain' };
  }

  if (domain.endsWith(`.${MODEL_B_BASE_DOMAIN}`)) {
    const sub = domain.slice(0, -(MODEL_B_BASE_DOMAIN.length + 1));
    if (sub.includes('.')) {
      return { valid: false, reason: 'Model B tenant domains must be a single-level subdomain' };
    }
    return { valid: true, domainModel: 'model_b_subdomain' };
  }

  // Model C: municipality-owned domain. Must be a subdomain (the municipality root
  // itself is not a tenant app domain).
  if (domain.split('.').length < 3) {
    return {
      valid: false,
      reason: 'Model C tenant domains must be a subdomain of a municipality-owned domain',
    };
  }
  return { valid: true, domainModel: 'model_c_municipality_domain' };
}
