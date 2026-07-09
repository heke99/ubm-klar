import type { LssRuleContext } from './types';

/**
 * Deterministic synthetic demo data for LSS. NO REAL PII:
 * - personnummer use month 90+ (structurally invalid) and are marked synthetic
 * - names come from a fixed synthetic list
 * Demo data may only be seeded into demo/test environments.
 */

export interface DemoPerson {
  id: string;
  syntheticPersonnummer: string;
  givenName: string;
  familyName: string;
  isSynthetic: true;
  protectedIdentity: boolean;
}

export interface LssDemoDataset {
  persons: DemoPerson[];
  context: LssRuleContext;
  ubmRequestIds: string[];
  counts: Record<string, number>;
}

/** mulberry32 deterministic PRNG. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GIVEN_NAMES = ['Testa', 'Demo', 'Fiktiv', 'Övning', 'Prov', 'Exempel', 'Syntet', 'Modell'];
const FAMILY_NAMES = [
  'Testsson',
  'Demosson',
  'Fiktivsson',
  'Övningsson',
  'Provsson',
  'Exempelsson',
];

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Synthetic personnummer: month 90+ can never be a real Swedish identity number. */
export function syntheticPersonnummer(rng: () => number, index: number): string {
  const year = 1940 + Math.floor(rng() * 70);
  const month = 90 + Math.floor(rng() * 9); // 90-98: structurally invalid on purpose
  const day = 10 + Math.floor(rng() * 18);
  const suffix = String(index % 10000).padStart(4, '0');
  return `${year}${month}${day}-${suffix}`;
}

export function isSyntheticPersonnummer(value: string): boolean {
  const month = Number(value.slice(4, 6));
  return month >= 90;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface LssDemoOptions {
  seed?: number;
  personCount?: number;
  decisionCount?: number;
  providerCount?: number;
  timeReportCount?: number;
  invoiceCount?: number;
  paymentCount?: number;
  recoveryClaimCount?: number;
  ubmRequestCount?: number;
}

export function generateLssDemoData(options: LssDemoOptions = {}): LssDemoDataset {
  const {
    seed = 20260707,
    personCount = 500,
    decisionCount = 1000,
    providerCount = 100,
    timeReportCount = 2000,
    invoiceCount = 1500,
    paymentCount = 3000,
    recoveryClaimCount = 20,
    ubmRequestCount = 10,
  } = options;
  const rng = createRng(seed);

  const persons: DemoPerson[] = Array.from({ length: personCount }, (_, i) => ({
    id: `demo-person-${i + 1}`,
    syntheticPersonnummer: syntheticPersonnummer(rng, i + 1),
    givenName: pick(rng, GIVEN_NAMES),
    familyName: pick(rng, FAMILY_NAMES),
    isSynthetic: true,
    protectedIdentity: rng() < 0.02,
  }));

  const providers = Array.from({ length: providerCount }, (_, i) => {
    const orgNumber = `5566${String(10 + i).padStart(2, '0')}-${String(1000 + i).slice(-4)}`;
    const hasPermit = rng() > 0.05;
    return {
      id: `demo-provider-${i + 1}`,
      organizationId: `demo-org-${i + 1}`,
      orgNumber,
      status: (rng() < 0.92 ? 'active' : 'under_review') as 'active' | 'under_review',
      contractedOrgNumbers: [orgNumber],
      ivoPermits: [
        {
          status: (hasPermit ? 'active' : 'expired') as 'active' | 'expired',
          validFrom: '2024-01-01',
          ...(hasPermit ? {} : { validTo: '2025-12-31' }),
        },
      ],
      contracts: [{ status: 'active' as const, validFrom: '2024-01-01' }],
      approvedAccountReferences: [`BG-${5000 + i}-${1000 + i}`],
      riskFlags: [] as Array<{ flagKind: string; manuallyReviewed: boolean }>,
      ...(rng() < 0.05 ? { lastAccountChangeAt: '2026-06-25' } : {}),
    };
  });

  const decisions = Array.from({ length: decisionCount }, (_, i) => {
    const person = pick(rng, persons);
    const startMonth = 1 + Math.floor(rng() * 6);
    return {
      id: `demo-decision-${i + 1}`,
      personId: person.id,
      status: (rng() < 0.9 ? 'active' : 'expired') as 'active' | 'expired',
      periodStart: isoDate(2026, startMonth, 1),
      periodEnd: isoDate(2026, startMonth + 5, 28),
      hoursPerWeek: 20 + Math.floor(rng() * 100),
    };
  });

  const timeReports = Array.from({ length: timeReportCount }, (_, i) => {
    const decision = pick(rng, decisions);
    const provider = pick(rng, providers);
    const month = 1 + Math.floor(rng() * 6);
    const totalHours = decision.hoursPerWeek * 4 * (0.7 + rng() * 0.4);
    return {
      id: `demo-timereport-${i + 1}`,
      personId: decision.personId,
      providerId: provider.id,
      decisionId: decision.id,
      periodStart: isoDate(2026, month, 1),
      periodEnd: isoDate(2026, month, 28),
      totalHours: Math.round(totalHours),
      approved: rng() > 0.05,
      rows: [
        {
          assistantId: `demo-assistant-${1 + Math.floor(rng() * 300)}`,
          workDate: isoDate(2026, month, 1 + Math.floor(rng() * 27)),
          startHour: 8,
          endHour: 16,
          hours: 8,
        },
      ],
    };
  });

  const invoices = Array.from({ length: invoiceCount }, (_, i) => {
    const report = pick(rng, timeReports);
    const provider = providers.find((p) => p.id === report.providerId)!;
    const anomalous = rng() < 0.04;
    return {
      id: `demo-invoice-${i + 1}`,
      providerId: provider.id,
      invoiceOrgNumber: provider.orgNumber,
      personId: report.personId,
      // ~2% of invoices intentionally lack decision link (demo risk flags)
      ...(rng() < 0.98 ? { decisionId: report.decisionId } : {}),
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      totalHours: anomalous ? report.totalHours * 2 : report.totalHours,
      totalAmountSek: Math.round(report.totalHours * 320),
      status: (rng() < 0.85 ? 'approved' : 'received') as 'approved' | 'received',
    };
  });

  const payments = Array.from({ length: paymentCount }, (_, i) => {
    const invoice = pick(rng, invoices);
    const provider = providers.find((p) => p.id === invoice.providerId)!;
    return {
      id: `demo-payment-${i + 1}`,
      personId: invoice.personId,
      providerId: invoice.providerId,
      invoiceId: invoice.id,
      ...(invoice.decisionId ? { decisionId: invoice.decisionId } : {}),
      batchId: `demo-batch-${1 + Math.floor(i / 200)}`,
      amountSek: invoice.totalAmountSek,
      paymentDate: invoice.periodEnd,
      status: rng() < 0.9 ? 'paid' : 'approved',
      recipientOrganizationId: provider.organizationId,
      recipientAccountReference: provider.approvedAccountReferences[0]!,
    };
  });

  const recoveryClaims = Array.from({ length: recoveryClaimCount }, (_, i) => {
    const payment = pick(rng, payments);
    return {
      id: `demo-claim-${i + 1}`,
      ...(payment.personId ? { personId: payment.personId } : {}),
      ...(payment.providerId ? { providerId: payment.providerId } : {}),
      status: 'open' as const,
    };
  });

  const paymentBatches = Array.from({ length: Math.ceil(paymentCount / 200) }, (_, i) => ({
    id: `demo-batch-${i + 1}`,
    scheduledDate: isoDate(2026, 7, 25),
    status: 'created',
    recipientProviderIds: [
      ...new Set(
        payments
          .filter((p) => p.batchId === `demo-batch-${i + 1}`)
          .flatMap((p) => (p.providerId ? [p.providerId] : [])),
      ),
    ],
    recipientPersonIds: [],
  }));

  const context: LssRuleContext = {
    decisions,
    timeReports,
    invoices,
    payments,
    providers,
    protectedPersons: persons.map((p) => ({
      personId: p.id,
      protectedIdentity: p.protectedIdentity,
      // one intentional gap for demo flows
      hasElevatedAccessProtection: p.protectedIdentity ? p.id !== 'demo-person-13' : false,
    })),
    documents: [],
    documentAccessEvents: [],
    paymentFileRows: [],
    paymentBatches,
    recoveryClaims,
  };

  const ubmRequestIds = Array.from(
    { length: ubmRequestCount },
    (_, i) => `demo-ubm-request-${i + 1}`,
  );

  return {
    persons,
    context,
    ubmRequestIds,
    counts: {
      persons: persons.length,
      decisions: decisions.length,
      providers: providers.length,
      timeReports: timeReports.length,
      invoices: invoices.length,
      payments: payments.length,
      recoveryClaims: recoveryClaims.length,
      ubmRequests: ubmRequestIds.length,
    },
  };
}
