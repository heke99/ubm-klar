import type { DbClient } from '@ubm-klar/db';

export interface EaDashboardStats {
  householdsTotal: number;
  openApplications: number;
  activeDecisions: number;
  paymentsTotal: number;
  paidAmountSekTotal: number;
  openRiskFlags: number;
  flagsBySeverity: Record<string, number>;
  openRecoveryClaims: number;
  amountAtRiskSekTotal: number;
}

/** Real economic assistance aggregates from the tenant data plane (no PII). */
export class EconomicAssistanceRepository {
  constructor(private readonly db: DbClient) {}

  async dashboardStats(): Promise<EaDashboardStats> {
    const [core, flags, severities] = await Promise.all([
      this.db.query<{
        households_total: string;
        open_applications: string;
        active_decisions: string;
        payments_total: string;
        paid_amount: string | null;
        open_recovery: string;
      }>(
        `select
           (select count(*) from ea_households) as households_total,
           (select count(*) from ea_applications where status in ('received','under_investigation')) as open_applications,
           (select count(*) from ea_decisions where status = 'active') as active_decisions,
           (select count(*) from ea_payments) as payments_total,
           (select coalesce(sum(amount_sek), 0) from ea_payments where status in ('paid','sent')) as paid_amount,
           (select count(*) from ea_recovery_claims where status in ('open','partially_recovered','disputed')) as open_recovery`,
      ),
      this.db.query<{ open_flags: string; amount_at_risk: string | null }>(
        `select count(*) as open_flags, coalesce(sum(amount_at_risk_sek), 0) as amount_at_risk
         from risk_flags where domain = 'economic_assistance' and status in ('open','under_review')`,
      ),
      this.db.query<{ severity: string; count: string }>(
        `select severity, count(*) as count from risk_flags
         where domain = 'economic_assistance' and status in ('open','under_review') group by severity`,
      ),
    ]);
    const c = core.rows[0]!;
    return {
      householdsTotal: Number(c.households_total),
      openApplications: Number(c.open_applications),
      activeDecisions: Number(c.active_decisions),
      paymentsTotal: Number(c.payments_total),
      paidAmountSekTotal: Number(c.paid_amount ?? 0),
      openRiskFlags: Number(flags.rows[0]?.open_flags ?? 0),
      flagsBySeverity: Object.fromEntries(
        severities.rows.map((r) => [r.severity, Number(r.count)]),
      ),
      openRecoveryClaims: Number(c.open_recovery),
      amountAtRiskSekTotal: Number(flags.rows[0]?.amount_at_risk ?? 0),
    };
  }
}
