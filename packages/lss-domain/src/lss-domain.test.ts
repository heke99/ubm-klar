import { describe, expect, it } from 'vitest';
import { RuleEngine } from '@ubm-klar/rule-engine';
import { buildLssDashboard } from './dashboard';
import {
  generateLssDemoData,
  isSyntheticPersonnummer,
  syntheticPersonnummer,
  createRng,
} from './demo-data';
import { matchDecisions } from './matching';
import { ALL_LSS_RULES } from './rules';
import { emptyLssContext } from './types';

describe('matching', () => {
  it('matches decision hours to reports, invoices and payments', () => {
    const ctx = {
      ...emptyLssContext(),
      decisions: [
        {
          id: 'd1',
          personId: 'p1',
          status: 'active' as const,
          periodStart: '2026-01-01',
          periodEnd: '2026-01-28',
          hoursPerWeek: 40,
        },
      ],
      timeReports: [
        {
          id: 'tr1',
          personId: 'p1',
          providerId: 'prov1',
          decisionId: 'd1',
          periodStart: '2026-01-01',
          periodEnd: '2026-01-28',
          totalHours: 150,
          approved: true,
          rows: [],
        },
      ],
      invoices: [
        {
          id: 'inv1',
          providerId: 'prov1',
          personId: 'p1',
          decisionId: 'd1',
          periodStart: '2026-01-01',
          periodEnd: '2026-01-28',
          totalHours: 150,
          totalAmountSek: 48000,
          status: 'approved' as const,
        },
      ],
      payments: [
        {
          id: 'pay1',
          personId: 'p1',
          providerId: 'prov1',
          invoiceId: 'inv1',
          decisionId: 'd1',
          amountSek: 48000,
          paymentDate: '2026-02-05',
          status: 'paid',
        },
      ],
      providers: [
        {
          id: 'prov1',
          organizationId: 'org1',
          orgNumber: '556600-1234',
          status: 'active' as const,
          contractedOrgNumbers: [],
          ivoPermits: [{ status: 'active' as const, validFrom: '2024-01-01' }],
          contracts: [{ status: 'active' as const, validFrom: '2024-01-01' }],
          approvedAccountReferences: [],
          riskFlags: [],
        },
      ],
    };
    const matches = matchDecisions(ctx);
    expect(matches).toHaveLength(1);
    const match = matches[0]!;
    expect(match.decidedHours).toBe(160);
    expect(match.reportedHours).toBe(150);
    expect(match.invoicedHours).toBe(150);
    expect(match.paidAmountSek).toBe(48000);
    expect(match.providerActive).toBe(true);
    expect(match.ivoPermitActive).toBe(true);
    expect(match.issues).toHaveLength(0);
  });

  it('reports issues when invoiced exceeds decided hours', () => {
    const ctx = {
      ...emptyLssContext(),
      decisions: [
        {
          id: 'd1',
          personId: 'p1',
          status: 'active' as const,
          periodStart: '2026-01-01',
          periodEnd: '2026-01-28',
          hoursPerWeek: 10,
        },
      ],
      invoices: [
        {
          id: 'inv1',
          providerId: 'prov1',
          personId: 'p1',
          decisionId: 'd1',
          periodStart: '2026-01-01',
          periodEnd: '2026-01-28',
          totalHours: 300,
          totalAmountSek: 96000,
          status: 'approved' as const,
        },
      ],
    };
    const match = matchDecisions(ctx)[0]!;
    expect(match.issues).toContain('Fakturerade timmar överstiger beslutade timmar.');
    expect(match.issues).toContain('Fakturering utan tidrapporter.');
  });
});

describe('demo data', () => {
  it('generates the requested volumes deterministically', () => {
    const a = generateLssDemoData({ seed: 42, personCount: 50, decisionCount: 100, providerCount: 10, timeReportCount: 200, invoiceCount: 150, paymentCount: 300, recoveryClaimCount: 5, ubmRequestCount: 3 });
    const b = generateLssDemoData({ seed: 42, personCount: 50, decisionCount: 100, providerCount: 10, timeReportCount: 200, invoiceCount: 150, paymentCount: 300, recoveryClaimCount: 5, ubmRequestCount: 3 });
    expect(a.counts).toEqual({
      persons: 50,
      decisions: 100,
      providers: 10,
      timeReports: 200,
      invoices: 150,
      payments: 300,
      recoveryClaims: 5,
      ubmRequests: 3,
    });
    expect(a.persons[0]!.syntheticPersonnummer).toBe(b.persons[0]!.syntheticPersonnummer);
  });

  it('produces only structurally invalid synthetic personnummer', () => {
    const dataset = generateLssDemoData({ personCount: 100, decisionCount: 10, providerCount: 5, timeReportCount: 10, invoiceCount: 10, paymentCount: 10, recoveryClaimCount: 2, ubmRequestCount: 1 });
    for (const person of dataset.persons) {
      expect(person.isSynthetic).toBe(true);
      expect(isSyntheticPersonnummer(person.syntheticPersonnummer)).toBe(true);
    }
  });

  it('synthetic personnummer generator uses months >= 90', () => {
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) {
      const pnr = syntheticPersonnummer(rng, i);
      expect(Number(pnr.slice(4, 6))).toBeGreaterThanOrEqual(90);
    }
  });

  it('demo data triggers risk flags when run through the rule catalogue', () => {
    const dataset = generateLssDemoData({
      personCount: 100,
      decisionCount: 200,
      providerCount: 20,
      timeReportCount: 400,
      invoiceCount: 300,
      paymentCount: 600,
      recoveryClaimCount: 10,
      ubmRequestCount: 5,
    });
    const engine = new RuleEngine<ReturnType<typeof emptyLssContext>>();
    engine.registerAll(ALL_LSS_RULES);
    const result = engine.run(dataset.context);
    expect(result.flags.length).toBeGreaterThan(0);
  });
});

describe('dashboard', () => {
  it('aggregates totals, flags and filters by severity', () => {
    const dataset = generateLssDemoData({
      personCount: 50,
      decisionCount: 100,
      providerCount: 10,
      timeReportCount: 200,
      invoiceCount: 150,
      paymentCount: 300,
      recoveryClaimCount: 5,
      ubmRequestCount: 2,
    });
    const engine = new RuleEngine<ReturnType<typeof emptyLssContext>>();
    engine.registerAll(ALL_LSS_RULES);
    const { flags } = engine.run(dataset.context);
    const dashboard = buildLssDashboard(dataset.context, flags);
    expect(dashboard.decidedHoursTotal).toBeGreaterThan(0);
    expect(dashboard.paidAmountSekTotal).toBeGreaterThan(0);
    expect(dashboard.openRecoveryClaims).toBe(5);

    const criticalOnly = buildLssDashboard(dataset.context, flags, { minSeverity: 'critical' });
    const allSeverities = Object.values(dashboard.flagsBySeverity).reduce((a, b) => a + b, 0);
    const criticalCount = Object.values(criticalOnly.flagsBySeverity).reduce((a, b) => a + b, 0);
    expect(criticalCount).toBeLessThanOrEqual(allSeverities);
  });

  it('filters by provider', () => {
    const dataset = generateLssDemoData({
      personCount: 20,
      decisionCount: 30,
      providerCount: 5,
      timeReportCount: 50,
      invoiceCount: 40,
      paymentCount: 60,
      recoveryClaimCount: 2,
      ubmRequestCount: 1,
    });
    const providerId = dataset.context.providers[0]!.id;
    const filtered = buildLssDashboard(dataset.context, [], { providerId });
    const all = buildLssDashboard(dataset.context, []);
    expect(filtered.invoicedAmountSekTotal).toBeLessThanOrEqual(all.invoicedAmountSekTotal);
  });
});
