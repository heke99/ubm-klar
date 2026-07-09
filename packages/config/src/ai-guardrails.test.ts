import { describe, expect, it } from 'vitest';
import { checkAiOutput, checkAiRequest, type AiRequestContext } from './ai-guardrails';

function context(overrides: Partial<AiRequestContext> = {}): AiRequestContext {
  return {
    useCase: 'explain_risk_flags',
    prompt: 'Förklara varför regeln lss_duplicate_payment flaggade posten.',
    contextClassification: 1,
    involvesProtectedIdentity: false,
    involvesSecurityClassified: false,
    piiInPromptsAllowed: false,
    modelProvider: 'vendor_hosted_no_pii',
    ...overrides,
  };
}

describe('checkAiRequest', () => {
  it('allows approved no-PII use cases', () => {
    expect(checkAiRequest(context()).allowed).toBe(true);
  });

  it('blocks disabled providers', () => {
    expect(checkAiRequest(context({ modelProvider: 'disabled' })).allowed).toBe(false);
  });

  it('blocks unknown use cases (AI never decides)', () => {
    const result = checkAiRequest(context({ useCase: 'approve_export' }));
    expect(result.allowed).toBe(false);
    expect(result.flags[0]!.flagKind).toBe('forbidden_use_case');
  });

  it('always blocks protected identity contexts', () => {
    const result = checkAiRequest(
      context({
        involvesProtectedIdentity: true,
        piiInPromptsAllowed: true,
        modelProvider: 'municipality_hosted',
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.flags[0]!.flagKind).toBe('protected_identity_context');
  });

  it('blocks security-classified material', () => {
    expect(checkAiRequest(context({ involvesSecurityClassified: true })).allowed).toBe(false);
  });

  it('blocks high-classification context without PII approval', () => {
    const result = checkAiRequest(context({ contextClassification: 3 }));
    expect(result.allowed).toBe(false);
    expect(result.flags[0]!.flagKind).toBe('classification_exceeded');
  });

  it('blocks PII in prompts for vendor-hosted AI without approval', () => {
    const result = checkAiRequest(context({ prompt: 'Sammanfatta ärendet för 19811218-9876.' }));
    expect(result.allowed).toBe(false);
    expect(result.flags[0]!.flagKind).toBe('pii_detected_in_prompt');
  });

  it('allows PII only with explicit approval on a supporting data plane', () => {
    const result = checkAiRequest(
      context({
        prompt: 'Sammanfatta ärendet för 19811218-9876.',
        piiInPromptsAllowed: true,
        modelProvider: 'municipality_hosted',
        contextClassification: 2,
      }),
    );
    expect(result.allowed).toBe(true);
  });
});

describe('checkAiOutput', () => {
  it('marks all output suggestion-only with mandatory review and sources', () => {
    const result = checkAiOutput('Förslag: kontrollera fakturaperioden mot beslutet.', [
      'risk_flag:rf-1',
    ]);
    expect(result.allowed).toBe(true);
    expect(result.marking).toBe('suggestion_only');
    expect(result.requiresHumanReview).toBe(true);
    expect(result.sourceReferencesRequired).toBe(true);
  });

  it('blocks decision language', () => {
    const result = checkAiOutput('Exporten är godkänd och skickas nu.', ['ref']);
    expect(result.allowed).toBe(false);
    expect(result.flags[0]!.flagKind).toBe('attempted_decision_language');
  });

  it('requires source references', () => {
    const result = checkAiOutput('Förslag utan källor.', []);
    expect(result.allowed).toBe(false);
    expect(result.flags[0]!.flagKind).toBe('missing_source_references');
  });

  it('blocks PII leakage in output', () => {
    const result = checkAiOutput('Personen 19811218-9876 bör kontrolleras.', ['ref']);
    expect(result.allowed).toBe(false);
    expect(result.flags[0]!.flagKind).toBe('pii_detected_in_output');
  });
});
