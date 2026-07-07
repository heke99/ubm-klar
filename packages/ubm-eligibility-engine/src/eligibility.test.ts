import { describe, expect, it } from 'vitest';
import { cleanEligibilityInput, evaluateUbmEligibility } from './eligibility';

describe('UBM eligibility engine', () => {
  it('allows a fully prepared clean export', () => {
    const decision = evaluateUbmEligibility(cleanEligibilityInput());
    expect(decision.outcome).toBe('send_allowed');
    expect(decision.blockers).toHaveLength(0);
  });

  it('blocks exports without a UBM request (phase 1 is request-based)', () => {
    const decision = evaluateUbmEligibility({ ...cleanEligibilityInput(), hasUbmRequest: false });
    expect(decision.outcome).toBe('do_not_send');
    expect(decision.blockers[0]).toContain('förfrågan');
  });

  it('blocks unvalidated requests', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      requestValidAndRegistered: false,
    });
    expect(decision.outcome).toBe('do_not_send');
  });

  it('requires manual review for unmatched domains', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      requestDomain: 'other',
    });
    expect(decision.outcomes).toContain('requires_manual_review');
  });

  it('blocks when subject is not a named person', () => {
    expect(
      evaluateUbmEligibility({ ...cleanEligibilityInput(), subjectIsNamedPerson: false }).outcome,
    ).toBe('do_not_send');
  });

  it('blocks when the municipality holds no relevant data', () => {
    expect(
      evaluateUbmEligibility({ ...cleanEligibilityInput(), municipalityHoldsRelevantData: false })
        .outcome,
    ).toBe('do_not_send');
  });

  it('blocks data that was neither decision basis nor payment relevant', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      dataUsedAsDecisionBasis: false,
      dataRelevantToPayment: false,
    });
    expect(decision.outcome).toBe('do_not_send');
  });

  it('enforces data minimization', () => {
    expect(
      evaluateUbmEligibility({ ...cleanEligibilityInput(), dataNecessaryForRequest: false })
        .outcome,
    ).toBe('do_not_send');
  });

  it('protected identity triggers legal + DPO + manual review', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      involvesProtectedIdentity: true,
    });
    expect(decision.outcomes).toEqual(
      expect.arrayContaining(['requires_legal_review', 'requires_dpo_review', 'requires_manual_review']),
    );
    expect(decision.outcome).not.toBe('send_allowed');
  });

  it('medical data triggers redaction and legal review', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      involvesHealthMedicalData: true,
    });
    expect(decision.outcomes).toContain('requires_redaction');
    expect(decision.outcomes).toContain('requires_legal_review');
  });

  it('children data triggers legal and DPO review', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      involvesChildrenData: true,
    });
    expect(decision.outcomes).toEqual(
      expect.arrayContaining(['requires_legal_review', 'requires_dpo_review']),
    );
  });

  it('bank data triggers maker-checker', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      involvesBankOrPaymentData: true,
    });
    expect(decision.outcomes).toContain('requires_maker_checker');
  });

  it('missing legal basis and purpose block with review outcomes', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      legalBasisRecorded: false,
      purposeRecorded: false,
    });
    expect(decision.outcomes).toEqual(
      expect.arrayContaining(['requires_legal_review', 'requires_dpo_review']),
    );
    expect(decision.blockers.length).toBeGreaterThanOrEqual(2);
  });

  it('incomplete lineage produces requires_data_lineage_fix as primary outcome', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      dataLineageComplete: false,
    });
    expect(decision.outcome).toBe('requires_data_lineage_fix');
    expect(decision.blockers[0]).toContain('lineage');
  });

  it('incomplete classification produces requires_classification_review', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      classificationComplete: false,
    });
    expect(decision.outcome).toBe('requires_classification_review');
  });

  it('pending redaction blocks until completed', () => {
    const pending = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      redactionRequired: true,
    });
    expect(pending.outcome).toBe('requires_redaction');
    const done = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      redactionRequired: true,
      redactionCompleted: true,
    });
    expect(done.outcome).toBe('send_allowed');
  });

  it('pending reviews block; completed reviews allow with send_allowed_after_review', () => {
    const pending = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      legalReviewRequired: true,
      dpoReviewRequired: true,
      makerCheckerRequired: true,
    });
    expect(pending.outcome).toBe('requires_legal_review');

    const done = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      legalReviewRequired: true,
      legalReviewCompleted: true,
      dpoReviewRequired: true,
      dpoReviewCompleted: true,
      makerCheckerRequired: true,
      makerCheckerCompleted: true,
    });
    expect(done.outcome).toBe('send_allowed_after_review');
  });

  it('prefers document references over full documents', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      documentsIncluded: true,
    });
    expect(decision.sendDocumentReferencesInstead).toBe(true);
  });

  it('blocks disallowed export destinations', () => {
    expect(
      evaluateUbmEligibility({ ...cleanEligibilityInput(), exportDestinationAllowed: false })
        .outcome,
    ).toBe('do_not_send');
  });

  it('missing schema version produces requires_schema_update', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      schemaVersionActive: false,
    });
    expect(decision.outcome).toBe('requires_schema_update');
  });

  it('unapproved transport or missing receipt handling produces requires_transport_configuration', () => {
    expect(
      evaluateUbmEligibility({ ...cleanEligibilityInput(), transportProfileApproved: false })
        .outcome,
    ).toBe('requires_transport_configuration');
    expect(
      evaluateUbmEligibility({ ...cleanEligibilityInput(), receiptHandlingConfigured: false })
        .outcome,
    ).toBe('requires_transport_configuration');
  });

  it('do_not_send always dominates other outcomes', () => {
    const decision = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      hasUbmRequest: false,
      dataLineageComplete: false,
      involvesHealthMedicalData: true,
    });
    expect(decision.outcome).toBe('do_not_send');
  });
});
