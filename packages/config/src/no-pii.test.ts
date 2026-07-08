import { describe, expect, it } from 'vitest';
import { assertNoPii, PiiLeakError, scanForPii } from './no-pii';

describe('scanForPii', () => {
  it('accepts clean technical payloads', () => {
    const result = scanForPii({
      tenantId: 'a1b2',
      migrationVersion: '202607070001',
      status: 'ok',
      errorCode: 'E_TIMEOUT',
    });
    expect(result.clean).toBe(true);
  });

  it('rejects 12-digit personal identity numbers in values', () => {
    const result = scanForPii({ note: 'kontakta 19811218-9876 snarast' });
    expect(result.clean).toBe(false);
    expect(result.violations[0]).toContain('personal identity number');
  });

  it('rejects 10-digit personnummer with separator', () => {
    expect(scanForPii({ ref: '811218-9876' }).clean).toBe(false);
  });

  it('does not flag technical identifiers like migration versions', () => {
    expect(scanForPii({ migration: '202607070001', runId: '2026070812345' }).clean).toBe(true);
  });

  it('rejects forbidden field names regardless of value', () => {
    const result = scanForPii({ personnummer: 'redacted' });
    expect(result.clean).toBe(false);
    expect(result.violations[0]).toContain('forbidden field name');
  });

  it('rejects nested PII fields', () => {
    const result = scanForPii({ meta: { rows: [{ bank_account: '123' }] } });
    expect(result.clean).toBe(false);
  });

  it('allows plain timestamps and version strings', () => {
    expect(scanForPii({ at: '2026-07-07T10:00:00Z', version: '1.0.0' }).clean).toBe(true);
  });
});

describe('assertNoPii', () => {
  it('returns payload when clean', () => {
    const payload = { status: 'healthy' };
    expect(assertNoPii(payload, 'health')).toBe(payload);
  });

  it('throws PiiLeakError when payload is dirty', () => {
    expect(() => assertNoPii({ income: 12000 }, 'support-ticket')).toThrow(PiiLeakError);
  });
});
