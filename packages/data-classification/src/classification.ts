import type { CiaClassification, DataClass } from '@ubm-klar/shared-types';

export type ClassificationTargetKind =
  | 'field'
  | 'document_type'
  | 'integration'
  | 'export'
  | 'table';

export interface ClassificationRecord {
  targetKind: ClassificationTargetKind;
  /** e.g. `persons.personal_identity_number` or `documents-lss` */
  targetKey: string;
  cia: CiaClassification;
  dataClass: DataClass;
  maskedByDefault: boolean;
  revealRequiresReason: boolean;
  exportRequiresApproval: boolean;
  motivation?: string;
}

export class ClassificationRegistry {
  private records = new Map<string, ClassificationRecord>();

  private key(targetKind: ClassificationTargetKind, targetKey: string): string {
    return `${targetKind}:${targetKey}`;
  }

  register(record: ClassificationRecord): void {
    this.records.set(this.key(record.targetKind, record.targetKey), record);
  }

  get(targetKind: ClassificationTargetKind, targetKey: string): ClassificationRecord | undefined {
    return this.records.get(this.key(targetKind, targetKey));
  }

  /**
   * Fail-closed default: unknown targets are treated as highly confidential
   * personal data (masked, reason-required, approval-required for export).
   */
  getOrDefault(targetKind: ClassificationTargetKind, targetKey: string): ClassificationRecord {
    return (
      this.get(targetKind, targetKey) ?? {
        targetKind,
        targetKey,
        cia: { confidentiality: 3, integrity: 3, availability: 2 },
        dataClass: 'personal_data',
        maskedByDefault: true,
        revealRequiresReason: true,
        exportRequiresApproval: true,
        motivation: 'Unclassified target: fail-closed default applied',
      }
    );
  }

  list(): ClassificationRecord[] {
    return [...this.records.values()];
  }

  /** Everything the export gate must approve before leaving the data plane. */
  exportApprovalRequired(): ClassificationRecord[] {
    return this.list().filter((r) => r.exportRequiresApproval);
  }
}

/** Returns true when a classification blocks automatic (unapproved) export. */
export function blocksAutomaticExport(record: ClassificationRecord): boolean {
  return record.exportRequiresApproval || record.cia.confidentiality >= 2;
}

export function isHighIntegrity(record: ClassificationRecord): boolean {
  return record.cia.integrity >= 2;
}
