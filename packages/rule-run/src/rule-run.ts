import type { DbClient } from '@ubm-klar/db';
import { RuleEngine, type RiskFlag } from '@ubm-klar/rule-engine';
import { ALL_LSS_RULES, emptyLssContext, type LssRuleContext } from '@ubm-klar/lss-domain';
import {
  ALL_EA_RULES,
  emptyEaContext,
  type EaRuleContext,
} from '@ubm-klar/economic-assistance-domain';

/**
 * Loads real rule contexts from the tenant data plane and runs the payment
 * control rules, persisting risk flags. Used by the worker's rule-engine and
 * payment-control jobs and by the API's manual "run rules" action.
 */

const dateStr = (value: Date | string | null | undefined): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : (value ?? '');

export async function loadLssContext(db: DbClient): Promise<LssRuleContext> {
  const ctx = emptyLssContext();

  const decisions = await db.query<{
    id: string;
    person_id: string;
    status: LssRuleContext['decisions'][number]['status'];
    period_start: Date | null;
    period_end: Date | null;
    hours_per_week: string | null;
  }>(
    `select d.id, d.person_id, d.status, p.period_start, p.period_end,
            (select sum(h.hours_per_week) from lss_decision_hours h where h.decision_id = d.id) as hours_per_week
     from lss_decisions d
     left join lateral (
       select period_start, period_end from lss_decision_periods where decision_id = d.id
       order by period_start limit 1
     ) p on true
     limit 20000`,
  );
  ctx.decisions = decisions.rows.map((row) => ({
    id: row.id,
    personId: row.person_id,
    status: row.status,
    periodStart: dateStr(row.period_start) || '1900-01-01',
    ...(row.period_end ? { periodEnd: dateStr(row.period_end) } : {}),
    hoursPerWeek: Number(row.hours_per_week ?? 0),
  }));

  const payments = await db.query<{
    id: string;
    person_id: string | null;
    provider_id: string | null;
    invoice_id: string | null;
    decision_id: string | null;
    batch_id: string | null;
    amount_sek: string;
    payment_date: Date | null;
    status: string;
  }>(`select * from lss_payments limit 50000`);
  ctx.payments = payments.rows.map((row) => ({
    id: row.id,
    ...(row.person_id ? { personId: row.person_id } : {}),
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    ...(row.invoice_id ? { invoiceId: row.invoice_id } : {}),
    ...(row.decision_id ? { decisionId: row.decision_id } : {}),
    ...(row.batch_id ? { batchId: row.batch_id } : {}),
    amountSek: Number(row.amount_sek),
    paymentDate: dateStr(row.payment_date),
    status: row.status,
  }));

  const timeReports = await db.query<{
    id: string;
    person_id: string;
    provider_id: string;
    decision_id: string | null;
    period_start: Date;
    period_end: Date;
    total_hours: string;
    status: string;
  }>(`select * from assistance_time_reports limit 50000`);
  ctx.timeReports = timeReports.rows.map((row) => ({
    id: row.id,
    personId: row.person_id,
    providerId: row.provider_id,
    ...(row.decision_id ? { decisionId: row.decision_id } : {}),
    periodStart: dateStr(row.period_start),
    periodEnd: dateStr(row.period_end),
    totalHours: Number(row.total_hours),
    approved: row.status === 'approved',
    rows: [],
  }));

  const invoices = await db.query<{
    id: string;
    provider_id: string;
    invoice_org_number: string | null;
    person_id: string | null;
    decision_id: string | null;
    period_start: Date;
    period_end: Date;
    total_hours: string | null;
    total_amount_sek: string;
    status: LssRuleContext['invoices'][number]['status'];
  }>(`select * from provider_invoices limit 50000`);
  ctx.invoices = invoices.rows.map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    ...(row.invoice_org_number ? { invoiceOrgNumber: row.invoice_org_number } : {}),
    personId: row.person_id ?? '',
    ...(row.decision_id ? { decisionId: row.decision_id } : {}),
    periodStart: dateStr(row.period_start),
    periodEnd: dateStr(row.period_end),
    ...(row.total_hours !== null ? { totalHours: Number(row.total_hours) } : {}),
    totalAmountSek: Number(row.total_amount_sek),
    status: row.status,
  }));

  const providers = await db.query<{
    id: string;
    organization_id: string;
    org_number: string | null;
    provider_status: LssRuleContext['providers'][number]['status'];
  }>(
    `select ap.id, ap.organization_id, o.organization_number as org_number, ap.provider_status
     from assistance_providers ap join organizations o on o.id = ap.organization_id limit 5000`,
  );
  const permits = await db.query<{
    provider_id: string;
    status: 'active' | 'expired' | 'revoked' | 'pending';
    valid_from: Date;
    valid_to: Date | null;
  }>(`select provider_id, status, valid_from, valid_to from provider_ivo_permits limit 20000`);
  ctx.providers = providers.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    orgNumber: row.org_number ?? '',
    status: row.provider_status,
    contractedOrgNumbers: row.org_number ? [row.org_number] : [],
    ivoPermits: permits.rows
      .filter((p) => p.provider_id === row.id)
      .map((p) => ({
        status: p.status,
        validFrom: dateStr(p.valid_from),
        ...(p.valid_to ? { validTo: dateStr(p.valid_to) } : {}),
      })),
    contracts: [],
    approvedAccountReferences: [],
    riskFlags: [],
  }));

  const protectedPersons = await db.query<{ id: string; protected_identity: boolean }>(
    `select id, protected_identity from persons where protected_identity = true limit 5000`,
  );
  ctx.protectedPersons = protectedPersons.rows.map((row) => ({
    personId: row.id,
    protectedIdentity: row.protected_identity,
    hasElevatedAccessProtection: false,
  }));

  const recoveryClaims = await db.query<{
    id: string;
    person_id: string | null;
    provider_id: string | null;
    status: LssRuleContext['recoveryClaims'][number]['status'];
  }>(`select id, person_id, provider_id, status from lss_recovery_claims limit 20000`);
  ctx.recoveryClaims = recoveryClaims.rows.map((row) => ({
    id: row.id,
    ...(row.person_id ? { personId: row.person_id } : {}),
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    status: row.status,
  }));

  const fileRows = await db.query<{
    id: string;
    recipient_org_number: string | null;
    recipient_account_reference: string | null;
    amount_sek: string;
    payment_date: Date | null;
  }>(
    `select id, recipient_org_number, recipient_account_reference, amount_sek, payment_date
     from payment_file_rows where domain_hint = 'lss' or domain_hint is null limit 50000`,
  );
  ctx.paymentFileRows = fileRows.rows.map((row) => ({
    id: row.id,
    ...(row.recipient_org_number ? { recipientOrgNumber: row.recipient_org_number } : {}),
    ...(row.recipient_account_reference
      ? { recipientAccountReference: row.recipient_account_reference }
      : {}),
    amountSek: Number(row.amount_sek),
    paymentDate: dateStr(row.payment_date),
  }));

  return ctx;
}

export async function loadEaContext(db: DbClient): Promise<EaRuleContext> {
  const ctx = emptyEaContext();

  const decisions = await db.query<{
    id: string;
    household_id: string;
    application_id: string | null;
    decision_kind: EaRuleContext['decisions'][number]['decisionKind'];
    status: EaRuleContext['decisions'][number]['status'];
    decided_at: Date;
    period_start: Date | null;
    period_end: Date | null;
    approved_amount: string | null;
  }>(
    `select d.id, d.household_id, d.application_id, d.decision_kind, d.status, d.decided_at,
            p.period_start, p.period_end,
            (select sum(a.amount_sek) from ea_approved_amounts a where a.decision_id = d.id) as approved_amount
     from ea_decisions d
     left join lateral (
       select period_start, period_end from ea_decision_periods where decision_id = d.id
       order by period_start limit 1
     ) p on true
     limit 20000`,
  );
  ctx.decisions = decisions.rows.map((row) => ({
    id: row.id,
    householdId: row.household_id,
    ...(row.application_id ? { applicationId: row.application_id } : {}),
    decisionKind: row.decision_kind,
    status: row.status,
    periodStart: dateStr(row.period_start) || dateStr(row.decided_at),
    periodEnd: dateStr(row.period_end) || '9999-12-31',
    approvedAmountSek: Number(row.approved_amount ?? 0),
    decidedAt: dateStr(row.decided_at),
  }));

  const payments = await db.query<{
    id: string;
    decision_id: string | null;
    household_id: string | null;
    person_id: string | null;
    amount_sek: string;
    payment_date: Date | null;
    status: string;
  }>(`select * from ea_payments limit 50000`);
  ctx.payments = payments.rows.map((row) => ({
    id: row.id,
    ...(row.decision_id ? { decisionId: row.decision_id } : {}),
    ...(row.household_id ? { householdId: row.household_id } : {}),
    ...(row.person_id ? { personId: row.person_id } : {}),
    amountSek: Number(row.amount_sek),
    paymentDate: dateStr(row.payment_date),
    status: row.status,
  }));

  const households = await db.query<{ id: string }>(`select id from ea_households limit 20000`);
  const members = await db.query<{
    household_id: string;
    person_id: string;
    protected_identity: boolean;
  }>(
    `select m.household_id, m.person_id, p.protected_identity
     from ea_household_members m join persons p on p.id = m.person_id limit 50000`,
  );
  ctx.households = households.rows.map((row) => {
    const householdMembers = members.rows.filter((m) => m.household_id === row.id);
    return {
      id: row.id,
      memberPersonIds: householdMembers.map((m) => m.person_id),
      protectedIdentity: householdMembers.some((m) => m.protected_identity),
      elevatedAccessProtection: false,
      accountReferences: [],
    };
  });

  const incomes = await db.query<{
    id: string;
    application_id: string;
    person_id: string;
    amount_sek: string;
    period_start: Date | null;
    period_end: Date | null;
    used_in_decision: boolean;
    verified_at: Date | null;
  }>(`select * from ea_verified_income limit 50000`);
  ctx.incomes = incomes.rows.map((row) => ({
    id: row.id,
    kind: 'verified' as const,
    applicationId: row.application_id,
    personId: row.person_id,
    amountSek: Number(row.amount_sek),
    ...(row.period_start ? { periodStart: dateStr(row.period_start) } : {}),
    ...(row.period_end ? { periodEnd: dateStr(row.period_end) } : {}),
    usedInDecision: row.used_in_decision,
    ...(row.verified_at ? { verifiedAt: row.verified_at.toISOString() } : {}),
  }));

  const recoveryClaims = await db.query<{
    id: string;
    household_id: string | null;
    person_id: string | null;
    status: EaRuleContext['recoveryClaims'][number]['status'];
  }>(`select id, household_id, person_id, status from ea_recovery_claims limit 20000`);
  ctx.recoveryClaims = recoveryClaims.rows.map((row) => ({
    id: row.id,
    ...(row.household_id ? { householdId: row.household_id } : {}),
    ...(row.person_id ? { personId: row.person_id } : {}),
    status: row.status,
    controlPerformedForNewPayments: false,
  }));

  return ctx;
}

export interface RuleRunResultSummary {
  domain: 'lss' | 'economic_assistance';
  rulesEvaluated: number;
  flagsCreated: number;
  flagsBySeverity: Record<string, number>;
  dryRun: boolean;
}

async function persistFlags(
  db: DbClient,
  domain: 'lss' | 'economic_assistance',
  flags: RiskFlag[],
  dryRun: boolean,
): Promise<number> {
  let created = 0;
  for (const flag of flags) {
    // Idempotency: one open flag per rule+subject.
    const existing = await db.query(
      `select 1 from risk_flags
       where rule_key = $1 and subject_id = $2::uuid and status in ('open','under_review') limit 1`,
      [flag.ruleKey, flag.subjectId],
    );
    if (existing.rows.length > 0) continue;
    await db.query(
      `insert into risk_flags
         (rule_key, rule_version, domain, severity, subject_kind, subject_id, person_id,
          explanation, recommended_action, amount_at_risk_sek, dry_run)
       values ($1, $2, $3, $4, $5, $6::uuid, $7::uuid, $8, $9, $10, $11)`,
      [
        flag.ruleKey,
        flag.ruleVersion,
        domain,
        flag.severity,
        flag.subjectKind,
        flag.subjectId,
        flag.personId ?? null,
        flag.explanation,
        flag.recommendedAction,
        flag.amountAtRiskSek ?? null,
        dryRun,
      ],
    );
    created++;
  }
  return created;
}

export async function runPaymentControlRules(
  db: DbClient,
  domain: 'lss' | 'economic_assistance',
  options: { dryRun?: boolean } = {},
): Promise<RuleRunResultSummary> {
  const dryRun = options.dryRun ?? false;
  let flags: RiskFlag[];
  let rulesEvaluated: number;
  if (domain === 'lss') {
    const engine = new RuleEngine<LssRuleContext>();
    engine.registerAll(ALL_LSS_RULES);
    const context = await loadLssContext(db);
    flags = engine.run(context).flags;
    rulesEvaluated = ALL_LSS_RULES.length;
  } else {
    const engine = new RuleEngine<EaRuleContext>();
    engine.registerAll(ALL_EA_RULES);
    const context = await loadEaContext(db);
    flags = engine.run(context).flags;
    rulesEvaluated = ALL_EA_RULES.length;
  }

  const flagsBySeverity: Record<string, number> = {};
  for (const flag of flags) {
    flagsBySeverity[flag.severity] = (flagsBySeverity[flag.severity] ?? 0) + 1;
  }
  const flagsCreated = await persistFlags(db, domain, flags, dryRun);
  return { domain, rulesEvaluated, flagsCreated, flagsBySeverity, dryRun };
}
