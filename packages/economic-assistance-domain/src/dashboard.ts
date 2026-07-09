import type { RiskFlag } from '@ubm-klar/rule-engine';
import type { EaRuleContext } from './types';

export interface EaDashboardData {
  applicationsTotal: number;
  decisionsTotal: number;
  approvals: number;
  rejections: number;
  paymentsTotal: number;
  paidAmountSekTotal: number;
  openRecoveryClaims: number;
  incomeAnomalies: number;
  householdAnomalies: number;
  housingAnomalies: number;
  duplicatePayments: number;
  accountAnomalies: number;
  rejectionWithPayment: number;
  paymentFileMismatches: number;
  verifiedIncomeShare: number;
  flagsBySeverity: Record<string, number>;
  amountAtRiskSekTotal: number;
}

const RULE_GROUPS: Record<
  string,
  keyof Pick<
    EaDashboardData,
    | 'incomeAnomalies'
    | 'householdAnomalies'
    | 'housingAnomalies'
    | 'duplicatePayments'
    | 'accountAnomalies'
    | 'rejectionWithPayment'
    | 'paymentFileMismatches'
  >
> = {
  ea_income_without_period: 'incomeAnomalies',
  ea_income_verified_after_decision: 'incomeAnomalies',
  ea_income_not_used_in_decision: 'incomeAnomalies',
  ea_calculation_ignored_verified_income: 'incomeAnomalies',
  ea_household_member_missing_from_calculation: 'householdAnomalies',
  ea_household_changed_after_decision: 'householdAnomalies',
  ea_protected_household_without_elevated_access: 'householdAnomalies',
  ea_housing_cost_without_document: 'housingAnomalies',
  ea_housing_cost_without_document_link: 'housingAnomalies',
  ea_duplicate_payment_household_period: 'duplicatePayments',
  ea_account_shared_across_households: 'accountAnomalies',
  ea_account_changed_near_payment: 'accountAnomalies',
  ea_recipient_changed_after_decision: 'accountAnomalies',
  ea_payment_despite_rejection: 'rejectionWithPayment',
  ea_payment_file_row_without_decision: 'paymentFileMismatches',
};

export function buildEaDashboard(ctx: EaRuleContext, flags: RiskFlag[]): EaDashboardData {
  const grouped = {
    incomeAnomalies: 0,
    householdAnomalies: 0,
    housingAnomalies: 0,
    duplicatePayments: 0,
    accountAnomalies: 0,
    rejectionWithPayment: 0,
    paymentFileMismatches: 0,
  };
  const flagsBySeverity: Record<string, number> = {};
  for (const flag of flags) {
    flagsBySeverity[flag.severity] = (flagsBySeverity[flag.severity] ?? 0) + 1;
    const group = RULE_GROUPS[flag.ruleKey];
    if (group) grouped[group] += 1;
  }

  const verifiedIncomes = ctx.incomes.filter((i) => i.kind === 'verified').length;

  return {
    applicationsTotal: ctx.applications.length,
    decisionsTotal: ctx.decisions.length,
    approvals: ctx.decisions.filter((d) =>
      ['approval', 'partial_approval'].includes(d.decisionKind),
    ).length,
    rejections: ctx.decisions.filter((d) => d.decisionKind === 'rejection').length,
    paymentsTotal: ctx.payments.length,
    paidAmountSekTotal: ctx.payments
      .filter((p) => p.status === 'paid')
      .reduce((s, p) => s + p.amountSek, 0),
    openRecoveryClaims: ctx.recoveryClaims.filter((c) =>
      ['open', 'partially_recovered', 'disputed'].includes(c.status),
    ).length,
    ...grouped,
    verifiedIncomeShare: ctx.incomes.length === 0 ? 0 : verifiedIncomes / ctx.incomes.length,
    flagsBySeverity,
    amountAtRiskSekTotal: flags.reduce((s, f) => s + (f.amountAtRiskSek ?? 0), 0),
  };
}
