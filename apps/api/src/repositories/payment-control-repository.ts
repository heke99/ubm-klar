import type { DbClient } from '@ubm-klar/db';

export interface RiskFlagRecord {
  id: string;
  ruleKey: string;
  ruleVersion: string;
  domain: string;
  severity: string;
  subjectKind: string;
  subjectId: string;
  personId: string | undefined;
  explanation: string;
  recommendedAction: string;
  amountAtRiskSek: number | undefined;
  status: string;
  controlCaseId: string | undefined;
  createdAt: string;
}

interface Row {
  id: string;
  rule_key: string;
  rule_version: string;
  domain: string;
  severity: string;
  subject_kind: string;
  subject_id: string;
  person_id: string | null;
  explanation: string;
  recommended_action: string;
  amount_at_risk_sek: string | null;
  status: string;
  control_case_id: string | null;
  flagged_at: Date;
}

function toRecord(row: Row): RiskFlagRecord {
  return {
    id: row.id,
    ruleKey: row.rule_key,
    ruleVersion: row.rule_version,
    domain: row.domain,
    severity: row.severity,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    personId: row.person_id ?? undefined,
    explanation: row.explanation,
    recommendedAction: row.recommended_action,
    amountAtRiskSek: row.amount_at_risk_sek !== null ? Number(row.amount_at_risk_sek) : undefined,
    status: row.status,
    controlCaseId: row.control_case_id ?? undefined,
    createdAt: row.flagged_at.toISOString(),
  };
}

export class PaymentControlRepository {
  constructor(private readonly db: DbClient) {}

  async insertFlag(input: {
    ruleKey: string;
    ruleVersion: string;
    domain: 'lss' | 'economic_assistance' | 'payment_control' | 'common';
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    subjectKind: string;
    subjectId: string;
    personId?: string;
    explanation: string;
    recommendedAction: string;
    amountAtRiskSek?: number;
    dryRun?: boolean;
  }): Promise<RiskFlagRecord> {
    const result = await this.db.query<Row>(
      `insert into risk_flags
         (rule_key, rule_version, domain, severity, subject_kind, subject_id, person_id,
          explanation, recommended_action, amount_at_risk_sek, dry_run)
       values ($1, $2, $3, $4, $5, $6::uuid, $7::uuid, $8, $9, $10, $11) returning *`,
      [
        input.ruleKey,
        input.ruleVersion,
        input.domain,
        input.severity,
        input.subjectKind,
        input.subjectId,
        input.personId ?? null,
        input.explanation,
        input.recommendedAction,
        input.amountAtRiskSek ?? null,
        input.dryRun ?? false,
      ],
    );
    return toRecord(result.rows[0]!);
  }

  async listFlags(
    filter: { domain?: string; severity?: string; status?: string; limit?: number } = {},
  ): Promise<RiskFlagRecord[]> {
    const clauses: string[] = ['true'];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      clauses.push(clause.replace('?', `$${params.length}`));
    };
    if (filter.domain) add('domain = ?', filter.domain);
    if (filter.severity) add('severity = ?', filter.severity);
    if (filter.status) add('status = ?', filter.status);
    params.push(filter.limit ?? 500);
    const result = await this.db.query<Row>(
      `select * from risk_flags where ${clauses.join(' and ')}
       order by flagged_at desc limit $${params.length}`,
      params,
    );
    return result.rows.map(toRecord);
  }

  async getFlag(id: string): Promise<RiskFlagRecord | undefined> {
    const result = await this.db.query<Row>('select * from risk_flags where id = $1::uuid', [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async linkFlagToCase(flagId: string, controlCaseId: string): Promise<void> {
    await this.db.query(
      `update risk_flags set control_case_id = $2::uuid, status = 'under_review' where id = $1::uuid`,
      [flagId, controlCaseId],
    );
  }

  async updateFlagStatus(
    flagId: string,
    status: 'open' | 'under_review' | 'confirmed' | 'dismissed' | 'resolved',
    reviewedBy?: string,
  ): Promise<void> {
    await this.db.query(
      `update risk_flags set status = $2, reviewed_by = coalesce($3::uuid, reviewed_by) where id = $1::uuid`,
      [flagId, status, reviewedBy ?? null],
    );
  }

  async flagSummary(domain?: string): Promise<{
    bySeverity: Record<string, number>;
    byRule: Array<{ ruleKey: string; count: number; amountAtRiskSek: number }>;
  }> {
    const domainClause = domain ? 'and domain = $1' : '';
    const params = domain ? [domain] : [];
    const [severities, rules] = await Promise.all([
      this.db.query<{ severity: string; count: string }>(
        `select severity, count(*) as count from risk_flags
         where status in ('open','under_review') ${domainClause} group by severity`,
        params,
      ),
      this.db.query<{ rule_key: string; count: string; amount: string | null }>(
        `select rule_key, count(*) as count, coalesce(sum(amount_at_risk_sek), 0) as amount
         from risk_flags where status in ('open','under_review') ${domainClause}
         group by rule_key order by count(*) desc limit 50`,
        params,
      ),
    ]);
    return {
      bySeverity: Object.fromEntries(severities.rows.map((r) => [r.severity, Number(r.count)])),
      byRule: rules.rows.map((r) => ({
        ruleKey: r.rule_key,
        count: Number(r.count),
        amountAtRiskSek: Number(r.amount ?? 0),
      })),
    };
  }
}
