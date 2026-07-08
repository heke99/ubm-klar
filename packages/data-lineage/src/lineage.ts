export interface LineageRecord {
  entityKind: string;
  entityId: string;
  fieldKey: string;
  sourceSystemId?: string;
  sourceRecordLinkId?: string;
  importBatchId?: string;
  transformation?: string;
  usedInDecision: boolean;
  usedInPayment: boolean;
}

export interface LineageCheckResult {
  complete: boolean;
  missingFields: string[];
  fieldsWithoutSource: string[];
}

/**
 * A field's lineage is complete when we know which source system it came from
 * and (for imported data) which source record produced it.
 */
export function isLineageComplete(record: LineageRecord): boolean {
  if (!record.sourceSystemId) return false;
  if (record.importBatchId && !record.sourceRecordLinkId) return false;
  return true;
}

/**
 * Checks that every required field of an entity has complete lineage.
 * Used by the UBM eligibility engine and export gates: exports are blocked
 * until lineage is complete for every exported field.
 */
export function checkEntityLineage(
  requiredFields: string[],
  records: LineageRecord[],
): LineageCheckResult {
  const byField = new Map(records.map((r) => [r.fieldKey, r]));
  const missingFields: string[] = [];
  const fieldsWithoutSource: string[] = [];
  for (const field of requiredFields) {
    const record = byField.get(field);
    if (!record) {
      missingFields.push(field);
    } else if (!isLineageComplete(record)) {
      fieldsWithoutSource.push(field);
    }
  }
  return {
    complete: missingFields.length === 0 && fieldsWithoutSource.length === 0,
    missingFields,
    fieldsWithoutSource,
  };
}

export interface SystemOfRecordDefinition {
  entityKind: string;
  fieldKey?: string;
  sourceSystemId: string;
  validFrom: string;
  validTo?: string;
}

/** Resolves which source system is authoritative for an entity/field at a date. */
export function resolveSystemOfRecord(
  definitions: SystemOfRecordDefinition[],
  entityKind: string,
  fieldKey: string,
  atDate: string,
): SystemOfRecordDefinition | undefined {
  const candidates = definitions.filter(
    (d) =>
      d.entityKind === entityKind &&
      (d.fieldKey === fieldKey || d.fieldKey === undefined) &&
      d.validFrom <= atDate &&
      (!d.validTo || d.validTo >= atDate),
  );
  // Field-specific definitions win over entity-wide definitions.
  return candidates.sort((a, b) => (a.fieldKey ? -1 : 1) - (b.fieldKey ? -1 : 1))[0];
}
