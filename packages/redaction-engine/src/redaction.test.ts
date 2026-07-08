import { describe, expect, it } from 'vitest';
import { applyRedaction, planRedaction, MASK_CHAR } from './redaction';

describe('redaction engine', () => {
  it('redacts personnummer from text', () => {
    const text = 'Beslut för person 19811218-9876 avser assistansersättning.';
    const plan = planRedaction('doc-1', text);
    const result = applyRedaction(text, plan);
    expect(result.redactedText).not.toContain('19811218-9876');
    expect(result.redactedText).toContain(MASK_CHAR);
    expect(result.verified).toBe(true);
  });

  it('redacts multiple occurrences', () => {
    const text = 'Personen 811218-9876 samt 811218-9876 förekommer två gånger.';
    const plan = planRedaction('doc-1', text);
    const result = applyRedaction(text, plan);
    expect(result.redactedText).not.toContain('811218-9876');
  });

  it('redacts bankgiro-style account numbers', () => {
    const text = 'Utbetalning till bankgiro 5050-1055 registrerad.';
    const plan = planRedaction('doc-1', text);
    const result = applyRedaction(text, plan);
    expect(result.redactedText).not.toContain('5050-1055');
  });

  it('leaves clean text untouched', () => {
    const text = 'Detta dokument innehåller inga känsliga identifierare.';
    const plan = planRedaction('doc-1', text);
    const result = applyRedaction(text, plan);
    expect(result.redactedText).toBe(text);
    expect(result.maskedCount).toBe(0);
    expect(result.verified).toBe(true);
  });

  it('verification fails if plan ranges were tampered to skip a hit', () => {
    const text = 'Person 19811218-9876 i dokumentet.';
    const plan = planRedaction('doc-1', text);
    const tampered = { ...plan, ranges: [] };
    const result = applyRedaction(text, tampered);
    expect(result.verified).toBe(false);
  });
});
