import type { UbmEligibilityOutcome } from '@ubm-klar/shared-types';

/**
 * UBM eligibility engine.
 *
 * Answers the 27 eligibility questions for a candidate export (request response
 * or recurring report) and produces the full set of required outcome statuses
 * with explanations. Deny-by-default: anything unknown blocks the export.
 */
export interface UbmEligibilityInput {
  // 1-4: request validity
  hasUbmRequest: boolean;
  requestValidAndRegistered: boolean;
  requestDomain?: 'lss' | 'economic_assistance' | 'other';
  subjectIsNamedPerson: boolean;
  // 5-9: data relevance
  municipalityHoldsRelevantData: boolean;
  dataConcernsEconomicBenefitDecision: boolean;
  dataUsedAsDecisionBasis: boolean;
  dataRelevantToPayment: boolean;
  dataNecessaryForRequest: boolean;
  // 10-14: sensitive categories
  involvesProtectedIdentity: boolean;
  involvesHealthMedicalData: boolean;
  involvesChildrenData: boolean;
  involvesIncomeOrSocialCircumstances: boolean;
  involvesBankOrPaymentData: boolean;
  // 15-18: documentation quality
  legalBasisRecorded: boolean;
  purposeRecorded: boolean;
  dataLineageComplete: boolean;
  classificationComplete: boolean;
  // 19-23: review requirements
  redactionRequired: boolean;
  redactionCompleted?: boolean;
  legalReviewRequired: boolean;
  legalReviewCompleted?: boolean;
  dpoReviewRequired: boolean;
  dpoReviewCompleted?: boolean;
  makerCheckerRequired: boolean;
  makerCheckerCompleted?: boolean;
  documentsIncluded: boolean;
  documentReferencesPreferred?: boolean;
  // 24-27: destination and transport
  exportDestinationAllowed: boolean;
  schemaVersionActive: boolean;
  transportProfileApproved: boolean;
  receiptHandlingConfigured: boolean;
}

export interface UbmEligibilityDecision {
  /** The primary outcome (most restrictive applicable). */
  outcome: UbmEligibilityOutcome;
  /** Every applicable outcome status. */
  outcomes: UbmEligibilityOutcome[];
  explanations: string[];
  /** Swedish "why is this blocked" texts for the UI. */
  blockers: string[];
  sendDocumentReferencesInstead: boolean;
}

const OUTCOME_PRIORITY: UbmEligibilityOutcome[] = [
  'do_not_send',
  'requires_source_system_fix',
  'requires_data_lineage_fix',
  'requires_classification_review',
  'requires_schema_update',
  'requires_transport_configuration',
  'requires_redaction',
  'requires_legal_review',
  'requires_dpo_review',
  'requires_manual_review',
  'requires_maker_checker',
  'send_allowed_after_review',
  'send_allowed',
];

export function evaluateUbmEligibility(input: UbmEligibilityInput): UbmEligibilityDecision {
  const outcomes = new Set<UbmEligibilityOutcome>();
  const explanations: string[] = [];
  const blockers: string[] = [];

  const block = (reason: string) => {
    outcomes.add('do_not_send');
    blockers.push(reason);
  };

  // Q1-2: request existence and validity
  if (!input.hasUbmRequest) {
    block(
      'Ingen registrerad UBM-förfrågan finns. Uppgifter får inte skickas utan förfrågan (fas 1).',
    );
  } else if (!input.requestValidAndRegistered) {
    block('Förfrågan är inte validerad och registrerad.');
  }

  // Q3-4: domain and subject
  if (input.requestDomain === 'other' || input.requestDomain === undefined) {
    outcomes.add('requires_manual_review');
    explanations.push('Förfrågans område kan inte matchas mot LSS eller ekonomiskt bistånd.');
  }
  if (!input.subjectIsNamedPerson) {
    block('Förfrågan avser inte en namngiven fysisk eller juridisk person.');
  }

  // Q5-9: data relevance and necessity
  if (!input.municipalityHoldsRelevantData) {
    block('Kommunen har inga relevanta uppgifter för förfrågan. Svara med tomt svar/avslag.');
  }
  if (!input.dataConcernsEconomicBenefitDecision) {
    outcomes.add('requires_manual_review');
    explanations.push('Uppgifterna rör inte tydligt ett beslut om ekonomisk förmån eller stöd.');
  }
  if (!input.dataUsedAsDecisionBasis && !input.dataRelevantToPayment) {
    block('Uppgifterna var varken beslutsunderlag eller relevanta för utbetalning.');
  }
  if (!input.dataNecessaryForRequest) {
    block('Uppgifterna är inte nödvändiga för förfrågan (dataminimering).');
  }

  // Q10-14: sensitive categories → reviews and redaction
  if (input.involvesProtectedIdentity) {
    outcomes.add('requires_legal_review');
    outcomes.add('requires_dpo_review');
    outcomes.add('requires_manual_review');
    explanations.push(
      'Skyddad identitet berörs: juridisk granskning, DPO-granskning och manuell hantering krävs.',
    );
  }
  if (input.involvesHealthMedicalData) {
    outcomes.add('requires_redaction');
    outcomes.add('requires_legal_review');
    explanations.push(
      'Hälso-/medicinska uppgifter berörs: maskning och juridisk granskning krävs.',
    );
  }
  if (input.involvesChildrenData) {
    outcomes.add('requires_legal_review');
    outcomes.add('requires_dpo_review');
    explanations.push('Uppgifter om barn berörs.');
  }
  if (input.involvesIncomeOrSocialCircumstances) {
    outcomes.add('requires_dpo_review');
    explanations.push('Inkomst-/sociala förhållanden berörs.');
  }
  if (input.involvesBankOrPaymentData) {
    outcomes.add('requires_maker_checker');
    explanations.push('Bank-/betalningsuppgifter berörs: fyra-ögon-godkännande krävs.');
  }

  // Q15-18: documentation quality
  if (!input.legalBasisRecorded) {
    outcomes.add('requires_legal_review');
    blockers.push('Rättslig grund är inte dokumenterad för uppgifterna.');
  }
  if (!input.purposeRecorded) {
    outcomes.add('requires_dpo_review');
    blockers.push('Ändamål är inte dokumenterat för uppgifterna.');
  }
  if (!input.dataLineageComplete) {
    outcomes.add('requires_data_lineage_fix');
    blockers.push(
      'Datalinjen (lineage) är ofullständig: alla fält måste kunna spåras till källsystem.',
    );
  }
  if (!input.classificationComplete) {
    outcomes.add('requires_classification_review');
    blockers.push('Informationsklassningen är ofullständig.');
  }

  // Q19-23: reviews
  if (input.redactionRequired && !input.redactionCompleted) {
    outcomes.add('requires_redaction');
    blockers.push('Maskning krävs men är inte slutförd.');
  }
  if (input.legalReviewRequired && !input.legalReviewCompleted) {
    outcomes.add('requires_legal_review');
    blockers.push('Juridisk granskning krävs men är inte slutförd.');
  }
  if (input.dpoReviewRequired && !input.dpoReviewCompleted) {
    outcomes.add('requires_dpo_review');
    blockers.push('DPO-granskning krävs men är inte slutförd.');
  }
  if (input.makerCheckerRequired && !input.makerCheckerCompleted) {
    outcomes.add('requires_maker_checker');
    blockers.push('Fyra-ögon-godkännande (maker-checker) krävs men är inte slutfört.');
  }
  const sendDocumentReferencesInstead =
    input.documentsIncluded && (input.documentReferencesPreferred ?? true);
  if (input.documentsIncluded && sendDocumentReferencesInstead) {
    explanations.push('Dokumentreferenser skickas i stället för fullständiga dokument.');
  }

  // Q24-27: destination, schema, transport, receipts
  if (!input.exportDestinationAllowed) {
    block('Exportdestinationen är inte godkänd.');
  }
  if (!input.schemaVersionActive) {
    outcomes.add('requires_schema_update');
    blockers.push('Ingen aktiv schemaversion finns för exporten.');
  }
  if (!input.transportProfileApproved) {
    outcomes.add('requires_transport_configuration');
    blockers.push('Transportprofilen är inte godkänd.');
  }
  if (!input.receiptHandlingConfigured) {
    outcomes.add('requires_transport_configuration');
    blockers.push('Kvittenshantering är inte konfigurerad.');
  }

  // Aggregate primary outcome
  let primary: UbmEligibilityOutcome | undefined;
  for (const candidate of OUTCOME_PRIORITY) {
    if (outcomes.has(candidate)) {
      primary = candidate;
      break;
    }
  }
  if (!primary) {
    const anyReviewDone =
      input.legalReviewRequired || input.dpoReviewRequired || input.makerCheckerRequired;
    primary = anyReviewDone ? 'send_allowed_after_review' : 'send_allowed';
    outcomes.add(primary);
    explanations.push(
      primary === 'send_allowed'
        ? 'Alla kontroller är godkända. Export kan genomföras.'
        : 'Alla obligatoriska granskningar är slutförda. Export kan genomföras.',
    );
  }

  return {
    outcome: primary,
    outcomes: [...outcomes],
    explanations,
    blockers,
    sendDocumentReferencesInstead,
  };
}

/** Input representing a fully-prepared clean export (test/demo helper). */
export function cleanEligibilityInput(): UbmEligibilityInput {
  return {
    hasUbmRequest: true,
    requestValidAndRegistered: true,
    requestDomain: 'lss',
    subjectIsNamedPerson: true,
    municipalityHoldsRelevantData: true,
    dataConcernsEconomicBenefitDecision: true,
    dataUsedAsDecisionBasis: true,
    dataRelevantToPayment: true,
    dataNecessaryForRequest: true,
    involvesProtectedIdentity: false,
    involvesHealthMedicalData: false,
    involvesChildrenData: false,
    involvesIncomeOrSocialCircumstances: false,
    involvesBankOrPaymentData: false,
    legalBasisRecorded: true,
    purposeRecorded: true,
    dataLineageComplete: true,
    classificationComplete: true,
    redactionRequired: false,
    legalReviewRequired: false,
    dpoReviewRequired: false,
    makerCheckerRequired: false,
    documentsIncluded: false,
    exportDestinationAllowed: true,
    schemaVersionActive: true,
    transportProfileApproved: true,
    receiptHandlingConfigured: true,
  };
}
