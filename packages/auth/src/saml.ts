/**
 * SAML abstraction. NOT implemented — Entra ID / OIDC cover the pilot.
 *
 * The abstraction exists so a real SAML implementation can slot in without
 * changing callers, but it must never silently pretend to verify assertions:
 * every call fails with NOT_IMPLEMENTED until a real implementation lands.
 */

export interface SamlProviderStatus {
  providerKind: 'saml';
  available: false;
  reason: string;
}

export class SamlNotImplementedError extends Error {
  public readonly code = 'NOT_IMPLEMENTED';
  constructor() {
    super(
      'SAML authentication is not implemented. Use Entra ID or generic OIDC. ' +
        'SAML support is a post-pilot deliverable.',
    );
    this.name = 'SamlNotImplementedError';
  }
}

export function samlProviderStatus(): SamlProviderStatus {
  return {
    providerKind: 'saml',
    available: false,
    reason: 'not_implemented_post_pilot',
  };
}

export function verifySamlAssertion(): never {
  throw new SamlNotImplementedError();
}
