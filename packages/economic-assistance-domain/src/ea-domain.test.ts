import { describe, expect, it } from 'vitest';
import { RuleEngine } from '@ubm-klar/rule-engine';
import { buildEaDashboard } from './dashboard';
import { generateEaDemoData } from './demo-data';
import { ALL_EA_RULES } from './rules';
import { mapEaDecisionToUbm } from './ubm-mapping';
import type { EaRuleContext } from './types';

describe('EA demo data', () => {
  it('generates requested volumes deterministically without real PII', () => {
    const a = generateEaDemoData({ seed: 7, personCount: 100, householdCount: 60, applicationCount: 200, decisionCount: 200, incomeCount: 300, housingCount: 100, paymentCount: 250, recoveryClaimCount: 10 });
    const b = generateEaDemoData({ seed: 7, personCount: 100, householdCount: 60, applicationCount: 200, decisionCount: 200, incomeCount: 300, housingCount: 100, paymentCount: 250, recoveryClaimCount: 10 });
    expect(a.counts).toEqual(b.counts);
    expect(a.counts.persons).toBe(100);
    // synthetic personnummer: month digit position uses 9x months
    for (const person of a.persons.slice(0, 20)) {
      expect(person.isSynthetic).toBe(true);
      const month = Number(person.syntheticPersonnummer.slice(4, 6));
      expect(month).toBeGreaterThanOrEqual(90);
    }
  });

  it('demo data yields risk flags through the rule catalogue', () => {
    const dataset = generateEaDemoData({
      personCount: 200,
      householdCount: 120,
      applicationCount: 400,
      decisionCount: 400,
      incomeCount: 600,
      housingCount: 200,
      paymentCount: 500,
      recoveryClaimCount: 20,
    });
    const engine = new RuleEngine<EaRuleContext>();
    engine.registerAll(ALL_EA_RULES);
    const result = engine.run(dataset.context);
    expect(result.flags.length).toBeGreaterThan(0);
  });
});

describe('EA dashboard', () => {
  it('aggregates applications, decisions, payments and anomaly groups', () => {
    const dataset = generateEaDemoData({
      personCount: 100,
      householdCount: 60,
      applicationCount: 150,
      decisionCount: 150,
      incomeCount: 200,
      housingCount: 80,
      paymentCount: 200,
      recoveryClaimCount: 8,
    });
    const engine = new RuleEngine<EaRuleContext>();
    engine.registerAll(ALL_EA_RULES);
    const { flags } = engine.run(dataset.context);
    const dashboard = buildEaDashboard(dataset.context, flags);
    expect(dashboard.applicationsTotal).toBe(150);
    expect(dashboard.decisionsTotal).toBe(150);
    expect(dashboard.paidAmountSekTotal).toBeGreaterThan(0);
    expect(dashboard.verifiedIncomeShare).toBeGreaterThan(0);
    expect(dashboard.verifiedIncomeShare).toBeLessThan(1);
    const groupSum =
      dashboard.incomeAnomalies +
      dashboard.householdAnomalies +
      dashboard.housingAnomalies +
      dashboard.duplicatePayments +
      dashboard.accountAnomalies +
      dashboard.rejectionWithPayment +
      dashboard.paymentFileMismatches;
    expect(groupSum).toBeGreaterThan(0);
  });
});

describe('EA UBM mapping', () => {
  const input = {
    decisionId: 'd1',
    decisionNumber: 'EB-2026-0001',
    personalIdentityNumber: '19811218-9876',
    decisionKind: 'approval',
    periodStart: '2026-06-01',
    periodEnd: '2026-06-30',
    approvedAmountSek: 10000,
    paidAmountSek: 10000,
    usedInDecision: true,
    legalBasis: 'SoL 4 kap. 1 §',
    purpose: 'Svar på UBM-förfrågan',
    exportEligible: true,
  };

  it('maps eligible decisions with fixed-point amounts', () => {
    const row = mapEaDecisionToUbm(input);
    expect(row.eligible).toBe(true);
    expect(row.payload.approved_amount_sek).toBe('10000.00');
    expect(row.payload.decision_number).toBe('EB-2026-0001');
  });

  it('excludes rows without legal basis, purpose or export eligibility', () => {
    const row = mapEaDecisionToUbm({
      ...input,
      legalBasis: undefined as unknown as string,
      purpose: undefined as unknown as string,
      exportEligible: false,
    });
    expect(row.eligible).toBe(false);
    expect(row.exclusionReasons).toHaveLength(3);
  });

  it('excludes data not used in decisions', () => {
    const row = mapEaDecisionToUbm({ ...input, usedInDecision: false });
    expect(row.eligible).toBe(false);
    expect(row.exclusionReasons[0]).toContain('beslutsunderlag');
  });
});
