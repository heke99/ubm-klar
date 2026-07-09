import type { RiskFlag } from '@ubm-klar/rule-engine';
import { matchDecisions } from './matching';
import type { LssRuleContext } from './types';

export interface LssDashboardFilters {
  periodStart?: string;
  periodEnd?: string;
  providerId?: string;
  minSeverity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
}

export interface LssDashboardData {
  decidedHoursTotal: number;
  reportedHoursTotal: number;
  invoicedHoursTotal: number;
  invoicedAmountSekTotal: number;
  paidAmountSekTotal: number;
  decisionsWithIssues: number;
  flagsBySeverity: Record<string, number>;
  flagsByRule: Array<{ ruleKey: string; count: number; amountAtRiskSek: number }>;
  providersWithoutActivePermit: number;
  unapprovedTimeReports: number;
  openRecoveryClaims: number;
  amountAtRiskSekTotal: number;
}

const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'];

export function buildLssDashboard(
  ctx: LssRuleContext,
  flags: RiskFlag[],
  filters: LssDashboardFilters = {},
): LssDashboardData {
  const inPeriod = (date: string) =>
    (!filters.periodStart || date >= filters.periodStart) &&
    (!filters.periodEnd || date <= filters.periodEnd);

  const filteredCtx: LssRuleContext = {
    ...ctx,
    invoices: ctx.invoices.filter(
      (i) =>
        (!filters.providerId || i.providerId === filters.providerId) && inPeriod(i.periodStart),
    ),
    payments: ctx.payments.filter(
      (p) =>
        (!filters.providerId || p.providerId === filters.providerId) && inPeriod(p.paymentDate),
    ),
    timeReports: ctx.timeReports.filter(
      (t) =>
        (!filters.providerId || t.providerId === filters.providerId) && inPeriod(t.periodStart),
    ),
  };

  const minSeverityIndex = filters.minSeverity ? SEVERITY_ORDER.indexOf(filters.minSeverity) : 0;
  const filteredFlags = flags.filter((f) => SEVERITY_ORDER.indexOf(f.severity) >= minSeverityIndex);

  const matches = matchDecisions(filteredCtx);
  const flagsBySeverity: Record<string, number> = {};
  const byRule = new Map<string, { count: number; amountAtRiskSek: number }>();
  for (const flag of filteredFlags) {
    flagsBySeverity[flag.severity] = (flagsBySeverity[flag.severity] ?? 0) + 1;
    const entry = byRule.get(flag.ruleKey) ?? { count: 0, amountAtRiskSek: 0 };
    entry.count += 1;
    entry.amountAtRiskSek += flag.amountAtRiskSek ?? 0;
    byRule.set(flag.ruleKey, entry);
  }

  return {
    decidedHoursTotal: Math.round(matches.reduce((s, m) => s + m.decidedHours, 0)),
    reportedHoursTotal: Math.round(matches.reduce((s, m) => s + m.reportedHours, 0)),
    invoicedHoursTotal: Math.round(matches.reduce((s, m) => s + m.invoicedHours, 0)),
    invoicedAmountSekTotal: matches.reduce((s, m) => s + m.invoicedAmountSek, 0),
    paidAmountSekTotal: matches.reduce((s, m) => s + m.paidAmountSek, 0),
    decisionsWithIssues: matches.filter((m) => m.issues.length > 0).length,
    flagsBySeverity,
    flagsByRule: [...byRule.entries()]
      .map(([ruleKey, v]) => ({ ruleKey, ...v }))
      .sort((a, b) => b.count - a.count),
    providersWithoutActivePermit: filteredCtx.providers.filter(
      (p) => !p.ivoPermits.some((permit) => permit.status === 'active'),
    ).length,
    unapprovedTimeReports: filteredCtx.timeReports.filter((t) => !t.approved).length,
    openRecoveryClaims: ctx.recoveryClaims.filter((c) =>
      ['open', 'partially_recovered', 'disputed'].includes(c.status),
    ).length,
    amountAtRiskSekTotal: filteredFlags.reduce((s, f) => s + (f.amountAtRiskSek ?? 0), 0),
  };
}
