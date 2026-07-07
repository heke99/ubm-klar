import { describe, expect, it } from 'vitest';
import {
  createInternalLssRequestSchema,
  UbmSchemaRegistry,
  validateAgainstSchema,
} from './schema-registry';

describe('UbmSchemaRegistry', () => {
  it('registers and resolves usable versions by date', () => {
    const registry = new UbmSchemaRegistry();
    registry.register(createInternalLssRequestSchema());
    registry.register({
      ...createInternalLssRequestSchema(),
      version: '0.0.1',
      status: 'awaiting_official_specification',
    });
    const resolved = registry.resolveUsable('ubm_request_response_lss', '2026-08-01');
    expect(resolved?.version).toBe('1.0.0');
  });

  it('never resolves awaiting_official_specification schemas', () => {
    const registry = new UbmSchemaRegistry();
    registry.register({
      ...createInternalLssRequestSchema(),
      schemaKey: 'ubm_recurring_lss',
      version: '0.0.1',
      status: 'awaiting_official_specification',
    });
    expect(registry.resolveUsable('ubm_recurring_lss', '2029-08-01')).toBeUndefined();
  });

  it('rejects duplicate versions', () => {
    const registry = new UbmSchemaRegistry();
    registry.register(createInternalLssRequestSchema());
    expect(() => registry.register(createInternalLssRequestSchema())).toThrow('already registered');
  });
});

describe('validateAgainstSchema', () => {
  const schema = createInternalLssRequestSchema();
  const validRecord = {
    personal_identity_number: '19811218-9876',
    decision_number: 'LSS-2026-0001',
    insats_kind: 'personlig_assistans',
    decision_period_start: '2026-01-01',
    decision_period_end: '2026-06-30',
    hours_per_week: '84.5',
    paid_amount_sek: '125000.00',
    provider_org_number: '556600-1234',
  };

  it('accepts valid records', () => {
    const result = validateAgainstSchema(schema, validRecord);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.schemaVersion).toBe('1.0.0');
  });

  it('rejects missing required fields', () => {
    const { decision_number: _omit, ...rest } = validRecord;
    const result = validateAgainstSchema(schema, rest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.code).toBe('missing_required');
  });

  it('rejects invalid types', () => {
    const result = validateAgainstSchema(schema, {
      ...validRecord,
      decision_period_start: 'inte-ett-datum',
    });
    expect(result.errors.some((e) => e.code === 'invalid_type')).toBe(true);
  });

  it('rejects values outside code lists', () => {
    const result = validateAgainstSchema(schema, { ...validRecord, insats_kind: 'okand_insats' });
    expect(result.errors.some((e) => e.code === 'invalid_code')).toBe(true);
  });

  it('rejects unknown fields (no accidental over-sharing)', () => {
    const result = validateAgainstSchema(schema, {
      ...validRecord,
      household_income: '99999',
    });
    expect(result.errors.some((e) => e.code === 'unknown_field')).toBe(true);
  });
});
