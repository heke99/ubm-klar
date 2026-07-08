import { scanForPii } from './no-pii';

/**
 * AI assistance guardrails. AI may only suggest; it never decides, approves,
 * or handles protected material. Prompts and outputs are PII-scanned unless the
 * municipality has explicitly approved PII use on a data plane that supports it.
 */
export type AiUseCase =
  | 'summarize_import_errors'
  | 'explain_risk_flags'
  | 'draft_internal_notes'
  | 'suggest_data_quality_fixes'
  | 'explain_export_block'
  | 'suggest_mapping_candidates'
  | 'draft_review_checklists'
  | 'support_summary_no_pii';

export const ALLOWED_AI_USE_CASES: readonly AiUseCase[] = [
  'summarize_import_errors',
  'explain_risk_flags',
  'draft_internal_notes',
  'suggest_data_quality_fixes',
  'explain_export_block',
  'suggest_mapping_candidates',
  'draft_review_checklists',
  'support_summary_no_pii',
] as const;

/** Actions AI must never perform, regardless of configuration. */
export const FORBIDDEN_AI_ACTIONS = [
  'final_legal_decision',
  'approve_export',
  'approve_ubm_submission',
  'decide_sensitive_data_sending',
  'reveal_protected_identity',
  'process_security_classified_material',
  'invent_legal_requirements',
] as const;

/** Phrases indicating the model tried to make a decision instead of a suggestion. */
const DECISION_LANGUAGE_PATTERNS = [
  /härmed\s+godkänn/i,
  /beslutar\s+att/i,
  /exporten\s+är\s+godkänd/i,
  /skickar\s+uppgifterna/i,
  /approved\s+for\s+export/i,
];

export interface AiRequestContext {
  useCase: string;
  prompt: string;
  /** Highest information classification (0-3) of context data. */
  contextClassification: 0 | 1 | 2 | 3;
  involvesProtectedIdentity: boolean;
  involvesSecurityClassified: boolean;
  piiInPromptsAllowed: boolean;
  modelProvider:
    | 'disabled'
    | 'municipality_hosted'
    | 'vendor_hosted_no_pii'
    | 'vendor_hosted_pii_approved';
}

export interface AiGuardrailResult {
  allowed: boolean;
  flags: Array<{ flagKind: string; detail: string }>;
}

export function checkAiRequest(context: AiRequestContext): AiGuardrailResult {
  const flags: Array<{ flagKind: string; detail: string }> = [];

  if (context.modelProvider === 'disabled') {
    flags.push({ flagKind: 'forbidden_use_case', detail: 'AI-assistans är avstängd.' });
  }
  if (!ALLOWED_AI_USE_CASES.includes(context.useCase as AiUseCase)) {
    flags.push({
      flagKind: 'forbidden_use_case',
      detail: `Användningsfallet "${context.useCase}" är inte tillåtet för AI-assistans.`,
    });
  }
  if (context.involvesProtectedIdentity) {
    flags.push({
      flagKind: 'protected_identity_context',
      detail: 'AI får aldrig behandla uppgifter om skyddad identitet.',
    });
  }
  if (context.involvesSecurityClassified) {
    flags.push({
      flagKind: 'classification_exceeded',
      detail: 'Säkerhetsskyddsklassificerat material får inte behandlas av AI utan särskild konfiguration.',
    });
  }
  if (context.contextClassification >= 2 && !context.piiInPromptsAllowed) {
    flags.push({
      flagKind: 'classification_exceeded',
      detail: 'Kontextens informationsklassning överskrider vad AI-konfigurationen tillåter.',
    });
  }
  const piiScan = scanForPii({ prompt: context.prompt }, 'ai.prompt');
  const vendorHostedWithoutApproval =
    context.modelProvider === 'vendor_hosted_no_pii' || !context.piiInPromptsAllowed;
  if (!piiScan.clean && vendorHostedWithoutApproval) {
    flags.push({
      flagKind: 'pii_detected_in_prompt',
      detail:
        'Personuppgifter upptäcktes i prompten. Leverantörsdriven AI får inte ta emot PII utan kommunens uttryckliga godkännande.',
    });
  }

  return { allowed: flags.length === 0, flags };
}

export interface AiOutputCheck {
  allowed: boolean;
  flags: Array<{ flagKind: string; detail: string }>;
  marking: 'suggestion_only';
  requiresHumanReview: true;
  sourceReferencesRequired: true;
}

export function checkAiOutput(
  output: string,
  sourceReferences: string[],
  piiInOutputAllowed = false,
): AiOutputCheck {
  const flags: Array<{ flagKind: string; detail: string }> = [];
  for (const pattern of DECISION_LANGUAGE_PATTERNS) {
    if (pattern.test(output)) {
      flags.push({
        flagKind: 'attempted_decision_language',
        detail: 'AI-utdata innehåller beslutsformuleringar. AI får endast föreslå, aldrig besluta.',
      });
      break;
    }
  }
  if (sourceReferences.length === 0) {
    flags.push({
      flagKind: 'missing_source_references',
      detail: 'AI-förslag måste ha källhänvisningar.',
    });
  }
  const piiScan = scanForPii({ output }, 'ai.output');
  if (!piiScan.clean && !piiInOutputAllowed) {
    flags.push({
      flagKind: 'pii_detected_in_output',
      detail: 'Personuppgifter upptäcktes i AI-utdata.',
    });
  }
  return {
    allowed: flags.length === 0,
    flags,
    marking: 'suggestion_only',
    requiresHumanReview: true,
    sourceReferencesRequired: true,
  };
}
