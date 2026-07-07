import { findPersonnummer } from '@ubm-klar/config';

export interface RedactionRule {
  id: string;
  description: string;
  /** Returns character ranges [start, end) that must be masked. */
  findRanges(text: string): Array<{ start: number; end: number; label: string }>;
}

export const REDACT_PERSONNUMMER: RedactionRule = {
  id: 'personnummer',
  description: 'Maskerar person- och samordningsnummer',
  findRanges(text) {
    const ranges: Array<{ start: number; end: number; label: string }> = [];
    for (const hit of findPersonnummer(text)) {
      let searchFrom = 0;
      let index = text.indexOf(hit, searchFrom);
      while (index !== -1) {
        ranges.push({ start: index, end: index + hit.length, label: 'personnummer' });
        searchFrom = index + hit.length;
        index = text.indexOf(hit, searchFrom);
      }
    }
    return ranges;
  },
};

export const REDACT_BANK_ACCOUNTS: RedactionRule = {
  id: 'bank_account',
  description: 'Maskerar bankgiro/plusgiro/kontonummer',
  findRanges(text) {
    const pattern = /\b(\d{3,4}-\d{4}|\d{4}-\d{2}-\d{5,11}|\d{7,16})\b/g;
    const ranges: Array<{ start: number; end: number; label: string }> = [];
    for (const match of text.matchAll(pattern)) {
      // avoid double-flagging personnummer (handled by their own rule)
      if (findPersonnummer(match[0]).length > 0) continue;
      ranges.push({ start: match.index, end: match.index + match[0].length, label: 'account' });
    }
    return ranges;
  },
};

export interface RedactionPlan {
  documentId: string;
  ranges: Array<{ start: number; end: number; label: string }>;
  rulesApplied: string[];
}

export interface RedactionResult {
  redactedText: string;
  maskedCount: number;
  plan: RedactionPlan;
  /** Redaction must be verified: no rule may still match the output. */
  verified: boolean;
}

export const MASK_CHAR = '█';

export function planRedaction(
  documentId: string,
  text: string,
  rules: RedactionRule[] = [REDACT_PERSONNUMMER, REDACT_BANK_ACCOUNTS],
): RedactionPlan {
  const ranges = rules
    .flatMap((rule) => rule.findRanges(text))
    .sort((a, b) => a.start - b.start);
  return { documentId, ranges, rulesApplied: rules.map((r) => r.id) };
}

export function applyRedaction(
  text: string,
  plan: RedactionPlan,
  rules: RedactionRule[] = [REDACT_PERSONNUMMER, REDACT_BANK_ACCOUNTS],
): RedactionResult {
  const chars = [...text];
  for (const range of plan.ranges) {
    for (let i = range.start; i < range.end && i < chars.length; i++) {
      chars[i] = MASK_CHAR;
    }
  }
  const redactedText = chars.join('');
  const stillMatching = rules
    .filter((r) => plan.rulesApplied.includes(r.id))
    .flatMap((r) => r.findRanges(redactedText));
  return {
    redactedText,
    maskedCount: plan.ranges.length,
    plan,
    verified: stillMatching.length === 0,
  };
}
