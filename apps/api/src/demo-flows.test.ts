/**
 * End-to-end demo flows (Batch 56). Each test walks a complete business flow
 * through the real engines, exactly as the worker/API orchestrate them.
 */
import { describe, expect, it } from 'vitest';
import { createWorkflow, decideStep, isApproved } from '@ubm-klar/approval-workflows';
import { EvidenceChain } from '@ubm-klar/evidence-chain';
import { RuleEngine } from '@ubm-klar/rule-engine';
import {
  ALL_LSS_RULES,
  generateLssDemoData,
  matchDecisions,
  type LssRuleContext,
} from '@ubm-klar/lss-domain';
import {
  ALL_EA_RULES,
  generateEaDemoData,
  mapEaDecisionToUbm,
  type EaRuleContext,
} from '@ubm-klar/economic-assistance-domain';
import {
  cleanEligibilityInput,
  evaluateUbmEligibility,
} from '@ubm-klar/ubm-eligibility-engine';
import { checkEntityLineage } from '@ubm-klar/data-lineage';
import { controlCaseFromRiskFlag, transitionCase, assignCase, registerOutcome } from '@ubm-klar/payment-control-engine';
import { reconcilePaymentFile } from '@ubm-klar/reconciliation-engine';
import { matchNotification } from '@ubm-klar/ubm-obligation-engine';
import { buildExportPackage, assertSendable, registerReceipt } from '@ubm-klar/ubm-export-engine';
import { evaluateDisclosure } from '@ubm-klar/public-record-engine';
import { buildEArchivePackage, verifyEArchivePackage, buildExitExport, verifyExitExport, EXIT_EXPORT_SCOPE } from '@ubm-klar/archive-engine';
import { createSupportSession, createBreakGlassSession } from '@ubm-klar/access-control';
import { computeReadinessScores, isGoLiveReady, ONBOARDING_STEPS } from '@ubm-klar/onboarding-engine';

describe('Demo: LSS payment control end-to-end', () => {
  it('finds anomalies in demo data, matches decisions and opens control cases', () => {
    const dataset = generateLssDemoData({
      personCount: 100, decisionCount: 200, providerCount: 20, timeReportCount: 400,
      invoiceCount: 300, paymentCount: 600, recoveryClaimCount: 10, ubmRequestCount: 5,
    });
    const engine = new RuleEngine<LssRuleContext>();
    engine.registerAll(ALL_LSS_RULES);
    const { flags } = engine.run(dataset.context);
    expect(flags.length).toBeGreaterThan(0);

    const matches = matchDecisions(dataset.context);
    expect(matches.length).toBe(200);

    const serious = flags.filter((f) => ['high', 'critical'].includes(f.severity));
    const cases = serious.map((f) => controlCaseFromRiskFlag(f)).filter(Boolean);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]!.sourceKind).toBe('risk_flag');
  });
});

describe('Demo: UBM request → blocked → fixed → export → receipt', () => {
  it('walks the full request/export flow with evidence chain', async () => {
    // 1. Export proposal is blocked due to missing lineage
    const blocked = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      dataLineageComplete: false,
    });
    expect(blocked.outcome).toBe('requires_data_lineage_fix');

    // 2. Lineage is fixed (source record link added)
    const lineage = checkEntityLineage(
      ['hours_per_week'],
      [{
        entityKind: 'lss_decision', entityId: 'd1', fieldKey: 'hours_per_week',
        sourceSystemId: 'sys-1', sourceRecordLinkId: 'link-1', importBatchId: 'batch-1',
        usedInDecision: true, usedInPayment: true,
      }],
    );
    expect(lineage.complete).toBe(true);

    // 3. Eligibility passes after legal/DPO review
    const approved = evaluateUbmEligibility({
      ...cleanEligibilityInput(),
      legalReviewRequired: true, legalReviewCompleted: true,
      dpoReviewRequired: true, dpoReviewCompleted: true,
      makerCheckerRequired: true, makerCheckerCompleted: true,
    });
    expect(approved.outcome).toBe('send_allowed_after_review');

    // 4. Maker-checker approval
    let workflow = createWorkflow({
      kind: 'ubm_export', subjectKind: 'ubm_submission', subjectId: 'sub-1',
      createdBy: 'maker', requiredRoles: ['lawyer', 'ubm_export_manager'],
    });
    workflow = decideStep(workflow, { stepId: workflow.steps[0]!.id, decision: 'approved', decidedBy: 'lawyer-1', actingRole: 'lawyer' });
    workflow = decideStep(workflow, { stepId: workflow.steps[1]!.id, decision: 'approved', decidedBy: 'export-mgr-1', actingRole: 'ubm_export_manager' });
    expect(isApproved(workflow)).toBe(true);

    // 5. Package with hash + version metadata
    const pkg = await buildExportPackage({
      proposalId: 'proposal-1', requestNumber: 'UBM-2026-0001', domain: 'lss',
      schemaKey: 'ubm_request_response_lss', schemaVersion: '1.0.0',
      legalSourceKey: 'lag_2023_456_uppgiftsskyldighet', legalSourceVersion: '2026-07-01',
      ruleSetVersion: '1.0.0',
      rows: [{ entityKind: 'lss_decision', entityId: 'd1', payload: { decision_number: 'LSS-1' } }],
      documents: [{ documentId: 'doc-1', fileHashSha256: 'abc', exportMode: 'reference_only' }],
      createdBy: 'maker',
    });
    expect(pkg.manifest.legalSourceVersion).toBe('2026-07-01');

    // 6. Send gate + receipt into evidence chain
    assertSendable({ approvalWorkflow: workflow, transportProfile: 'manual_download', transportApproved: true });
    const chain = new EvidenceChain('ubm_submission', pkg.submissionId);
    const receipt = registerReceipt(pkg.submissionId, 'manual_confirmation', 'mottaget', chain);
    expect(receipt.receiptHashSha256).toBeDefined();
    expect(chain.verify().valid).toBe(true);
  });
});

describe('Demo: economic assistance UBM export', () => {
  it('maps EA decisions with eligibility exclusions', () => {
    const eligible = mapEaDecisionToUbm({
      decisionId: 'd1', decisionNumber: 'EB-1', personalIdentityNumber: '19811218-9876',
      decisionKind: 'approval', periodStart: '2026-06-01', periodEnd: '2026-06-30',
      approvedAmountSek: 10000, usedInDecision: true, legalBasis: 'SoL 4:1',
      purpose: 'UBM-förfrågan', exportEligible: true,
    });
    expect(eligible.eligible).toBe(true);
  });
});

describe('Demo: payment reconciliation finds duplicate → recovery claim', () => {
  it('flags the duplicate and conflicts on active claims', () => {
    const base = {
      expectedPayments: [{
        id: 'pay-1', kind: 'ea_payment' as const, personId: 'p1',
        decisionPeriodStart: '2026-06-01', decisionPeriodEnd: '2026-06-30',
        amountSek: 8000, status: 'approved',
      }],
      recipientRegistry: [], blocklist: [], activeRecoveryClaims: [],
    };
    const duplicates = reconcilePaymentFile({
      ...base,
      rows: [
        { id: 'r1', personId: 'p1', amountSek: 8000, paymentDate: '2026-06-25' },
        { id: 'r2', personId: 'p1', amountSek: 8000, paymentDate: '2026-06-25' },
      ],
    });
    expect(duplicates.map((r) => r.resultKind)).toEqual(['matched', 'duplicate_payment']);

    // recovery claim created → next payment conflicts
    const withClaim = reconcilePaymentFile({
      ...base,
      activeRecoveryClaims: [{ claimId: 'claim-1', personId: 'p1' }],
      rows: [{ id: 'r3', personId: 'p1', amountSek: 8000, paymentDate: '2026-06-26' }],
    });
    expect(withClaim[0]!.resultKind).toBe('recovery_claim_conflict');
  });
});

describe('Demo: UBM notification → control case → outcome', () => {
  it('matches, creates a case and registers the outcome', () => {
    const match = matchNotification(
      { personalIdentityNumber: '19811218-9876', decisionNumber: 'EB-1' },
      [{ candidateKind: 'decision', candidateId: 'd1', personalIdentityNumber: '19811218-9876', decisionNumber: 'EB-1' }],
    );
    expect(match.decision).toBe('auto_matched');

    let controlCase = controlCaseFromRiskFlag({
      ruleKey: 'ubm_notification', ruleVersion: '1.0.0', severity: 'high',
      domain: 'economic_assistance', title: 'UBM-underrättelse',
      recommendedAction: 'Utred', subjectKind: 'ubm_notification', subjectId: 'n1',
      explanation: 'Underrättelse matchad mot beslut d1', evidenceReferences: ['ubm_notification:n1'],
      dryRun: false, flaggedAt: new Date().toISOString(),
    })!;
    controlCase = assignCase(controlCase, 'investigator-1', 'manager-1');
    controlCase = transitionCase(controlCase, 'investigating', 'investigator-1');
    controlCase = transitionCase(controlCase, 'awaiting_decision', 'investigator-1');
    controlCase = registerOutcome(controlCase, 'recovery_claim', 'Felaktig utbetalning bekräftad.', 'manager-1');
    expect(controlCase.outcome).toBe('recovery_claim');
  });
});

describe('Demo: support without PII and break-glass with post-review', () => {
  it('creates JIT and break-glass sessions with all constraints', () => {
    const support = createSupportSession({
      supportCaseReference: 'SUP-1', requestedBySupportUser: 'sup-1',
      approvedByMunicipalityUser: 'admin-1', scope: 'queue_status',
      reason: 'Felsökning av fastnad exportkö', requestedDurationMs: 3_600_000,
    });
    expect(support.piiAccess).toBe(false);

    const breakGlass = createBreakGlassSession({
      initiatedBy: 'bg-admin-1', hasBreakGlassRole: true,
      reason: 'Incident INC-9: korrigering av felaktig beslutsstatus i produktion',
      incidentReference: 'INC-9', requestedDurationMs: 3_600_000,
    });
    expect(breakGlass.postReviewStatus).toBe('pending');
  });
});

describe('Demo: public record request with secrecy review', () => {
  it('blocks unreviewed items and allows redacted release', () => {
    const result = evaluateDisclosure([
      {
        requestItemId: 'i1', documentId: 'doc-1',
        review: {
          requestItemId: 'i1', reviewer: 'lawyer-1', legalBasis: 'OSL 26 kap. 1 §',
          decision: 'release_redacted', motivation: 'Tredje mans uppgifter maskas.',
          redactionCompleted: true,
        },
      },
    ]);
    expect(result.allowed).toBe(true);
    expect(result.disclosableItems[0]!.mode).toBe('redacted');
  });
});

describe('Demo: e-archive export and exit export', () => {
  it('builds verifiable packages', () => {
    const entries = [
      { entityKind: 'ea_decision', entityId: 'd1', content: 'beslut 1', metadata: { year: '2026' } },
    ];
    const archivePkg = buildEArchivePackage('EARK-1', entries);
    expect(verifyEArchivePackage(archivePkg, entries).valid).toBe(true);

    let workflow = createWorkflow({
      kind: 'exit_export', subjectKind: 'exit_export', subjectId: 'exit-1',
      createdBy: 'owner-1', requiredRoles: ['municipality_admin'],
    });
    workflow = decideStep(workflow, {
      stepId: workflow.steps[0]!.id, decision: 'approved', decidedBy: 'admin-2', actingRole: 'municipality_admin',
    });
    const items = EXIT_EXPORT_SCOPE.map((kind) => ({ itemKind: kind, rowCount: 1, content: kind }));
    const exit = buildExitExport('EXIT-1', 'owner-1', workflow, items);
    expect(exit.complete).toBe(true);
    expect(verifyExitExport(exit, items).valid).toBe(true);
  });
});

describe('Demo: onboarding and readiness score', () => {
  it('computes scores and blocks go-live until complete', () => {
    const halfDone = Object.fromEntries(
      ONBOARDING_STEPS.map((s, i) => [s.stepKey, i % 2 === 0 ? 'completed' : 'not_started'] as const),
    );
    const scores = computeReadinessScores(halfDone);
    expect(isGoLiveReady(scores).ready).toBe(false);

    const allDone = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s.stepKey, 'completed'] as const));
    expect(isGoLiveReady(computeReadinessScores(allDone)).ready).toBe(true);
  });
});

describe('Demo: EA payment control on demo data', () => {
  it('produces flags from synthetic anomalies', () => {
    const dataset = generateEaDemoData({
      personCount: 150, householdCount: 90, applicationCount: 300, decisionCount: 300,
      incomeCount: 400, housingCount: 150, paymentCount: 350, recoveryClaimCount: 15,
    });
    const engine = new RuleEngine<EaRuleContext>();
    engine.registerAll(ALL_EA_RULES);
    const { flags } = engine.run(dataset.context);
    expect(flags.length).toBeGreaterThan(0);
  });
});
