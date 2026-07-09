import type { DbClient } from '@ubm-klar/db';

export interface LssDashboardStats {
  personsTotal: number;
  activeDecisions: number;
  paymentsTotal: number;
  paidAmountSekTotal: number;
  openRiskFlags: number;
  flagsBySeverity: Record<string, number>;
  openRecoveryClaims: number;
  providersTotal: number;
  unapprovedTimeReports: number;
  amountAtRiskSekTotal: number;
}

/** Real LSS aggregates from the tenant data plane (aggregate counts only, no PII). */
export class LssRepository {
  constructor(private readonly db: DbClient) {}

  async dashboardStats(): Promise<LssDashboardStats> {
    const [core, flags, severities] = await Promise.all([
      this.db.query<{
        persons_total: string;
        active_decisions: string;
        payments_total: string;
        paid_amount: string | null;
        open_recovery: string;
        providers_total: string;
        unapproved_reports: string;
      }>(
        `select
           (select count(*) from lss_person_profiles) as persons_total,
           (select count(*) from lss_decisions where status = 'active') as active_decisions,
           (select count(*) from lss_payments) as payments_total,
           (select coalesce(sum(amount_sek), 0) from lss_payments where status in ('paid','sent')) as paid_amount,
           (select count(*) from lss_recovery_claims where status in ('open','partially_recovered','disputed')) as open_recovery,
           (select count(*) from assistance_providers) as providers_total,
           (select count(*) from assistance_time_reports where status not in ('approved')) as unapproved_reports`,
      ),
      this.db.query<{ open_flags: string; amount_at_risk: string | null }>(
        `select count(*) as open_flags, coalesce(sum(amount_at_risk_sek), 0) as amount_at_risk
         from risk_flags where domain = 'lss' and status in ('open','under_review')`,
      ),
      this.db.query<{ severity: string; count: string }>(
        `select severity, count(*) as count from risk_flags
         where domain = 'lss' and status in ('open','under_review') group by severity`,
      ),
    ]);
    const c = core.rows[0]!;
    return {
      personsTotal: Number(c.persons_total),
      activeDecisions: Number(c.active_decisions),
      paymentsTotal: Number(c.payments_total),
      paidAmountSekTotal: Number(c.paid_amount ?? 0),
      openRiskFlags: Number(flags.rows[0]?.open_flags ?? 0),
      flagsBySeverity: Object.fromEntries(
        severities.rows.map((r) => [r.severity, Number(r.count)]),
      ),
      openRecoveryClaims: Number(c.open_recovery),
      providersTotal: Number(c.providers_total),
      unapprovedTimeReports: Number(c.unapproved_reports),
      amountAtRiskSekTotal: Number(flags.rows[0]?.amount_at_risk ?? 0),
    };
  }
}
