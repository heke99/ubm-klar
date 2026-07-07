import { periodsOverlap, weeksInPeriod, type LssRuleContext } from './types';

/**
 * LSS matching: decision hours ↔ time reports ↔ invoices ↔ payments ↔ provider
 * ↔ IVO permit ↔ payment recipient ↔ payment file ↔ booked status.
 * Produces per-decision match rows used by reconciliation and the LSS dashboard.
 */
export interface LssDecisionMatch {
  decisionId: string;
  personId: string;
  decidedHours: number;
  reportedHours: number;
  invoicedHours: number;
  invoicedAmountSek: number;
  paidAmountSek: number;
  providerActive: boolean;
  ivoPermitActive: boolean;
  recipientVerified: boolean;
  issues: string[];
}

export function matchDecisions(ctx: LssRuleContext): LssDecisionMatch[] {
  const providers = new Map(ctx.providers.map((p) => [p.id, p]));
  return ctx.decisions.map((decision) => {
    const periodEnd = decision.periodEnd ?? new Date().toISOString().slice(0, 10);
    const decidedHours = decision.hoursPerWeek * weeksInPeriod(decision.periodStart, periodEnd);

    const reports = ctx.timeReports.filter(
      (tr) =>
        tr.personId === decision.personId &&
        periodsOverlap(tr.periodStart, tr.periodEnd, decision.periodStart, decision.periodEnd),
    );
    const invoices = ctx.invoices.filter((inv) => inv.decisionId === decision.id);
    const payments = ctx.payments.filter((p) => p.decisionId === decision.id);

    const reportedHours = reports.reduce((sum, r) => sum + r.totalHours, 0);
    const invoicedHours = invoices.reduce((sum, i) => sum + (i.totalHours ?? 0), 0);
    const invoicedAmountSek = invoices.reduce((sum, i) => sum + i.totalAmountSek, 0);
    const paidAmountSek = payments
      .filter((p) => p.status === 'paid')
      .reduce((sum, p) => sum + p.amountSek, 0);

    const providerIds = new Set([
      ...invoices.map((i) => i.providerId),
      ...payments.flatMap((p) => (p.providerId ? [p.providerId] : [])),
    ]);
    const matchedProviders = [...providerIds].flatMap((id) => {
      const provider = providers.get(id);
      return provider ? [provider] : [];
    });
    const providerActive =
      matchedProviders.length > 0 && matchedProviders.every((p) => p.status === 'active');
    const ivoPermitActive =
      matchedProviders.length > 0 &&
      matchedProviders.every((p) => p.ivoPermits.some((permit) => permit.status === 'active'));
    const recipientVerified = payments.every((p) => {
      if (!p.recipientAccountReference || !p.providerId) return true;
      const provider = providers.get(p.providerId);
      return provider?.approvedAccountReferences.includes(p.recipientAccountReference) ?? false;
    });

    const issues: string[] = [];
    if (invoicedHours > decidedHours * 1.001) {
      issues.push('Fakturerade timmar överstiger beslutade timmar.');
    }
    if (invoicedHours > reportedHours * 1.001 && reports.length > 0) {
      issues.push('Fakturerade timmar överstiger rapporterade timmar.');
    }
    if (invoices.length > 0 && reports.length === 0) {
      issues.push('Fakturering utan tidrapporter.');
    }
    if (paidAmountSek > invoicedAmountSek * 1.001 && invoices.length > 0) {
      issues.push('Utbetalt belopp överstiger fakturerat belopp.');
    }
    if (matchedProviders.length > 0 && !providerActive) {
      issues.push('Utförare är inte aktiv.');
    }
    if (matchedProviders.length > 0 && !ivoPermitActive) {
      issues.push('Utförare saknar aktivt IVO-tillstånd.');
    }
    if (!recipientVerified) {
      issues.push('Betalningsmottagare är inte verifierad.');
    }

    return {
      decisionId: decision.id,
      personId: decision.personId,
      decidedHours,
      reportedHours,
      invoicedHours,
      invoicedAmountSek,
      paidAmountSek,
      providerActive,
      ivoPermitActive,
      recipientVerified,
      issues,
    };
  });
}
