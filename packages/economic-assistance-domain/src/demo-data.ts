import type { EaRuleContext } from './types';

/**
 * Deterministic synthetic demo data for economic assistance. NO REAL PII:
 * synthetic personnummer (month >= 90) and fixed synthetic names only.
 */
export interface EaDemoPerson {
  id: string;
  syntheticPersonnummer: string;
  givenName: string;
  familyName: string;
  isSynthetic: true;
}

export interface EaDemoDataset {
  persons: EaDemoPerson[];
  context: EaRuleContext;
  counts: Record<string, number>;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GIVEN = ['Testa', 'Demo', 'Fiktiv', 'Övning', 'Prov', 'Exempel'];
const FAMILY = ['Testsson', 'Demosson', 'Fiktivsson', 'Övningsson'];

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface EaDemoOptions {
  seed?: number;
  personCount?: number;
  householdCount?: number;
  applicationCount?: number;
  decisionCount?: number;
  incomeCount?: number;
  housingCount?: number;
  paymentCount?: number;
  recoveryClaimCount?: number;
}

export function generateEaDemoData(options: EaDemoOptions = {}): EaDemoDataset {
  const {
    seed = 20260708,
    personCount = 1000,
    householdCount = 600,
    applicationCount = 2000,
    decisionCount = 2000,
    incomeCount = 3000,
    housingCount = 1000,
    paymentCount = 2500,
    recoveryClaimCount = 100,
  } = options;
  const rng = createRng(seed);

  const persons: EaDemoPerson[] = Array.from({ length: personCount }, (_, i) => ({
    id: `ea-person-${i + 1}`,
    syntheticPersonnummer: `19${70 + (i % 30)}9${1 + (i % 8)}${10 + (i % 18)}-${String(i % 10000).padStart(4, '0')}`,
    givenName: pick(rng, GIVEN),
    familyName: pick(rng, FAMILY),
    isSynthetic: true,
  }));

  const households = Array.from({ length: householdCount }, (_, i) => {
    const memberCount = 1 + Math.floor(rng() * 4);
    const start = Math.floor(rng() * (personCount - memberCount));
    const account = `KONTO-${3000 + i}`;
    const protectedIdentity = rng() < 0.02;
    return {
      id: `ea-household-${i + 1}`,
      memberPersonIds: persons.slice(start, start + memberCount).map((p) => p.id),
      protectedIdentity,
      elevatedAccessProtection: protectedIdentity ? rng() > 0.05 : false,
      accountReferences: [account],
      ...(rng() < 0.03 ? { lastAccountChangeAt: '2026-06-20' } : {}),
      ...(rng() < 0.04 ? { membersChangedAfterDecision: true } : {}),
    };
  });

  const applications = Array.from({ length: applicationCount }, (_, i) => {
    const household = pick(rng, households);
    const month = 1 + Math.floor(rng() * 6);
    const missingAttachment = rng() < 0.05;
    return {
      id: `ea-application-${i + 1}`,
      householdId: household.id,
      periodStart: isoDate(2026, month, 1),
      periodEnd: isoDate(2026, month, 28),
      requiredDocumentRoles: ['income_statement', 'rent_receipt'],
      attachedDocumentRoles: missingAttachment
        ? ['income_statement']
        : ['income_statement', 'rent_receipt'],
    };
  });

  const decisions = Array.from({ length: decisionCount }, (_, i) => {
    const application = applications[i % applications.length]!;
    const roll = rng();
    const decisionKind =
      roll < 0.8 ? ('approval' as const) : roll < 0.9 ? ('partial_approval' as const) : ('rejection' as const);
    return {
      id: `ea-decision-${i + 1}`,
      householdId: application.householdId,
      applicationId: application.id,
      decisionKind,
      status:
        rng() < 0.93
          ? ('active' as const)
          : rng() < 0.5
            ? ('superseded' as const)
            : ('under_reconsideration' as const),
      periodStart: application.periodStart!,
      periodEnd: application.periodEnd!,
      approvedAmountSek: decisionKind === 'rejection' ? 0 : 8000 + Math.floor(rng() * 8000),
      decidedAt: application.periodStart!,
      accountReferenceAtDecision:
        households.find((h) => h.id === application.householdId)?.accountReferences[0] ?? 'KONTO-0',
    };
  });

  const incomes = Array.from({ length: incomeCount }, (_, i) => {
    const application = pick(rng, applications);
    const household = households.find((h) => h.id === application.householdId)!;
    const kind = rng() < 0.6 ? ('declared' as const) : ('verified' as const);
    const missingPeriod = rng() < 0.03;
    return {
      id: `ea-income-${i + 1}`,
      kind,
      applicationId: application.id,
      personId: household.memberPersonIds[0]!,
      amountSek: Math.floor(rng() * 15000),
      ...(missingPeriod
        ? {}
        : { periodStart: application.periodStart!, periodEnd: application.periodEnd! }),
      usedInDecision: rng() > 0.05,
      ...(kind === 'verified' ? { verifiedAt: application.periodStart! } : {}),
    };
  });

  const housingRecords = Array.from({ length: housingCount }, (_, i) => {
    const household = pick(rng, households);
    const hasDoc = rng() > 0.06;
    return {
      id: `ea-housing-${i + 1}`,
      householdId: household.id,
      monthlyCostSek: 4000 + Math.floor(rng() * 8000),
      hasContractDocument: hasDoc,
      hasCostDocumentLink: hasDoc && rng() > 0.05,
    };
  });

  const approvedDecisions = decisions.filter((d) => d.decisionKind !== 'rejection');
  const payments = Array.from({ length: paymentCount }, (_, i) => {
    // ~1.5% intentionally reference rejections (demo anomaly)
    const decision = rng() < 0.985 ? pick(rng, approvedDecisions) : pick(rng, decisions);
    const household = households.find((h) => h.id === decision.householdId)!;
    return {
      id: `ea-payment-${i + 1}`,
      decisionId: decision.id,
      householdId: decision.householdId,
      personId: household.memberPersonIds[0]!,
      amountSek: decision.approvedAmountSek || 5000,
      paymentDate: decision.periodEnd,
      status: rng() < 0.9 ? 'paid' : 'approved',
      accountReference: household.accountReferences[0]!,
      recipientKind: 'applicant' as const,
      recipientPersonId: household.memberPersonIds[0]!,
      periodStart: decision.periodStart,
      periodEnd: decision.periodEnd,
    };
  });

  const recoveryClaims = Array.from({ length: recoveryClaimCount }, (_, i) => {
    const payment = pick(rng, payments);
    return {
      id: `ea-claim-${i + 1}`,
      ...(payment.householdId ? { householdId: payment.householdId } : {}),
      status: 'open' as const,
      controlPerformedForNewPayments: rng() > 0.3,
    };
  });

  const calculations = decisions.slice(0, Math.floor(decisionCount / 2)).map((d, i) => {
    const household = households.find((h) => h.id === d.householdId)!;
    const skipMember = rng() < 0.03 && household.memberPersonIds.length > 1;
    return {
      id: `ea-calc-${i + 1}`,
      applicationId: d.applicationId!,
      decisionId: d.id,
      includedPersonIds: skipMember
        ? household.memberPersonIds.slice(1)
        : household.memberPersonIds,
      usedDeclaredIncomeOnly: rng() < 0.05,
      totalIncomeSek: Math.floor(rng() * 20000),
    };
  });

  const context: EaRuleContext = {
    decisions,
    applications,
    payments,
    incomes,
    households,
    housingRecords,
    calculations,
    recoveryClaims,
    paymentFileRows: [],
    sensitiveReveals: [],
  };

  return {
    persons,
    context,
    counts: {
      persons: persons.length,
      households: households.length,
      applications: applications.length,
      decisions: decisions.length,
      incomes: incomes.length,
      housingRecords: housingRecords.length,
      payments: payments.length,
      recoveryClaims: recoveryClaims.length,
    },
  };
}
