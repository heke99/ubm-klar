/**
 * Economic assistance → UBM mapping: builds schema-conformant export rows for
 * the internal EA request-response working schema (not an official format).
 */
export interface EaUbmMappingInput {
  decisionId: string;
  decisionNumber: string;
  personalIdentityNumber: string;
  decisionKind: string;
  periodStart: string;
  periodEnd: string;
  approvedAmountSek: number;
  paidAmountSek?: number;
  householdNumber?: string;
  usedInDecision: boolean;
  legalBasis?: string;
  purpose?: string;
  exportEligible: boolean;
}

export interface EaUbmMappedRow {
  entityKind: 'ea_decision';
  entityId: string;
  payload: Record<string, string>;
  eligible: boolean;
  exclusionReasons: string[];
}

export function mapEaDecisionToUbm(input: EaUbmMappingInput): EaUbmMappedRow {
  const exclusionReasons: string[] = [];
  if (!input.exportEligible) {
    exclusionReasons.push('Posten är inte markerad som exportbar (export_eligible=false).');
  }
  if (!input.usedInDecision) {
    exclusionReasons.push('Uppgiften användes inte som beslutsunderlag.');
  }
  if (!input.legalBasis) {
    exclusionReasons.push('Rättslig grund saknas.');
  }
  if (!input.purpose) {
    exclusionReasons.push('Ändamål saknas.');
  }

  const payload: Record<string, string> = {
    personal_identity_number: input.personalIdentityNumber,
    decision_number: input.decisionNumber,
    decision_kind: input.decisionKind,
    decision_period_start: input.periodStart,
    decision_period_end: input.periodEnd,
    approved_amount_sek: input.approvedAmountSek.toFixed(2),
  };
  if (input.paidAmountSek !== undefined) {
    payload.paid_amount_sek = input.paidAmountSek.toFixed(2);
  }

  return {
    entityKind: 'ea_decision',
    entityId: input.decisionId,
    payload,
    eligible: exclusionReasons.length === 0,
    exclusionReasons,
  };
}

/** The internal EA request-response schema (working format, versioned). */
export function createInternalEaRequestSchemaFields(): Array<{
  fieldKey: string;
  required: boolean;
}> {
  return [
    { fieldKey: 'personal_identity_number', required: true },
    { fieldKey: 'decision_number', required: true },
    { fieldKey: 'decision_kind', required: true },
    { fieldKey: 'decision_period_start', required: true },
    { fieldKey: 'decision_period_end', required: true },
    { fieldKey: 'approved_amount_sek', required: true },
    { fieldKey: 'paid_amount_sek', required: false },
  ];
}
