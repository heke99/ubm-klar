import { describe, expect, it } from 'vitest';
import { blocksAutomaticExport } from '@ubm-klar/data-classification';
import { createDefaultClassificationRegistry } from './defaults';

describe('default classification registry', () => {
  const registry = createDefaultClassificationRegistry();

  it('classifies personal identity numbers as masked and reason-required', () => {
    const record = registry.get('field', 'persons.personal_identity_number');
    expect(record?.maskedByDefault).toBe(true);
    expect(record?.revealRequiresReason).toBe(true);
    expect(record?.cia.confidentiality).toBe(3);
  });

  it('fails closed for unknown targets', () => {
    const record = registry.getOrDefault('field', 'some_new_table.some_new_field');
    expect(record.maskedByDefault).toBe(true);
    expect(record.exportRequiresApproval).toBe(true);
    expect(record.dataClass).toBe('personal_data');
  });

  it('blocks automatic export for all sensitive defaults', () => {
    for (const record of registry.list()) {
      if (record.dataClass !== 'internal') {
        expect(blocksAutomaticExport(record), record.targetKey).toBe(true);
      }
    }
  });

  it('allows no-PII SIEM integration without export approval', () => {
    const siem = registry.get('integration', 'siem-export');
    expect(siem?.exportRequiresApproval).toBe(false);
    expect(siem?.dataClass).toBe('internal');
  });

  it('marks UBM exports as approval-required', () => {
    const ubm = registry.get('export', 'ubm-export');
    expect(ubm?.exportRequiresApproval).toBe(true);
  });
});
