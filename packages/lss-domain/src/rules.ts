import type { RiskFinding, RiskRuleDefinition } from '@ubm-klar/rule-engine';
import {
  periodsOverlap,
  weeksInPeriod,
  type LssRuleContext,
} from './types';

type LssRule = RiskRuleDefinition<LssRuleContext>;

function base(
  ruleKey: string,
  title: string,
  description: string,
  severity: LssRule['severity'],
  recommendedAction: string,
  evaluate: LssRule['evaluate'],
): LssRule {
  return {
    ruleKey,
    version: '1.0.0',
    status: 'active',
    domain: 'lss',
    title,
    description,
    severity,
    recommendedAction,
    legalSourceKey: 'lss_1993_387',
    legalSourceVersion: '2026-07-01',
    evaluate,
  };
}

const decisionsById = (ctx: LssRuleContext) => new Map(ctx.decisions.map((d) => [d.id, d]));
const providersById = (ctx: LssRuleContext) => new Map(ctx.providers.map((p) => [p.id, p]));

/** Rule 1: Payment after decision end date. */
export const lssRule01PaymentAfterDecisionEnd = base(
  'lss_payment_after_decision_end',
  'Utbetalning efter beslutets slutdatum',
  'Utbetalning har gjorts efter att beslutsperioden löpt ut.',
  'high',
  'Utred utbetalningen och initiera återkrav vid behov.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.payments.flatMap((p) => {
      const decision = p.decisionId ? decisions.get(p.decisionId) : undefined;
      if (!decision?.periodEnd || p.paymentDate <= decision.periodEnd) return [];
      return [
        {
          subjectKind: 'lss_payment',
          subjectId: p.id,
          explanation: `Utbetalning ${p.paymentDate} efter beslutets slutdatum ${decision.periodEnd}.`,
          evidenceReferences: [`lss_payment:${p.id}`, `lss_decision:${decision.id}`],
          amountAtRiskSek: p.amountSek,
          ...(p.personId ? { personId: p.personId } : {}),
        },
      ];
    });
  },
);

/** Rule 2: Payment before decision start date. */
export const lssRule02PaymentBeforeDecisionStart = base(
  'lss_payment_before_decision_start',
  'Utbetalning före beslutets startdatum',
  'Utbetalning har gjorts innan beslutsperioden börjat gälla.',
  'high',
  'Kontrollera beslutskopplingen och stoppa kommande utbetalningar.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.payments.flatMap((p) => {
      const decision = p.decisionId ? decisions.get(p.decisionId) : undefined;
      if (!decision || p.paymentDate >= decision.periodStart) return [];
      return [
        {
          subjectKind: 'lss_payment',
          subjectId: p.id,
          explanation: `Utbetalning ${p.paymentDate} före beslutets startdatum ${decision.periodStart}.`,
          evidenceReferences: [`lss_payment:${p.id}`, `lss_decision:${decision.id}`],
          amountAtRiskSek: p.amountSek,
          ...(p.personId ? { personId: p.personId } : {}),
        },
      ];
    });
  },
);

/** Rule 3: Billed hours exceed decision hours. */
export const lssRule03BilledHoursExceedDecision = base(
  'lss_billed_hours_exceed_decision',
  'Fakturerade timmar överstiger beslutade timmar',
  'Fakturans timmar för perioden överstiger beslutade timmar.',
  'high',
  'Begär rättelse från utföraren och håll inne betalning.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.invoices.flatMap((inv) => {
      const decision = inv.decisionId ? decisions.get(inv.decisionId) : undefined;
      if (!decision || inv.totalHours === undefined) return [];
      const allowed = decision.hoursPerWeek * weeksInPeriod(inv.periodStart, inv.periodEnd);
      if (inv.totalHours <= allowed * 1.001) return [];
      return [
        {
          subjectKind: 'provider_invoice',
          subjectId: inv.id,
          explanation: `Fakturerade ${inv.totalHours} timmar överstiger beslutade ~${allowed.toFixed(1)} timmar för perioden.`,
          evidenceReferences: [`provider_invoice:${inv.id}`, `lss_decision:${decision.id}`],
          amountAtRiskSek: inv.totalAmountSek,
          personId: inv.personId,
        },
      ];
    });
  },
);

/** Rule 4: Time report missing for invoiced period. */
export const lssRule04TimeReportMissing = base(
  'lss_time_report_missing_for_invoice',
  'Tidrapport saknas för fakturerad period',
  'Fakturerad period saknar tidrapport från utföraren.',
  'high',
  'Begär tidrapport innan fakturan godkänns.',
  (ctx) =>
    ctx.invoices.flatMap((inv) => {
      const hasReport = ctx.timeReports.some(
        (tr) =>
          tr.personId === inv.personId &&
          tr.providerId === inv.providerId &&
          periodsOverlap(tr.periodStart, tr.periodEnd, inv.periodStart, inv.periodEnd),
      );
      if (hasReport) return [];
      return [
        {
          subjectKind: 'provider_invoice',
          subjectId: inv.id,
          explanation: `Ingen tidrapport täcker fakturaperioden ${inv.periodStart}–${inv.periodEnd}.`,
          evidenceReferences: [`provider_invoice:${inv.id}`],
          amountAtRiskSek: inv.totalAmountSek,
          personId: inv.personId,
        },
      ];
    }),
);

/** Rule 5: Invoice lacks approved provider. */
export const lssRule05InvoiceWithoutApprovedProvider = base(
  'lss_invoice_without_approved_provider',
  'Faktura saknar godkänd utförare',
  'Fakturan kommer från en utförare som inte är aktiv/godkänd.',
  'critical',
  'Stoppa betalning och kontrollera utförarens status.',
  (ctx) => {
    const providers = providersById(ctx);
    return ctx.invoices.flatMap((inv) => {
      const provider = providers.get(inv.providerId);
      if (provider && provider.status === 'active') return [];
      return [
        {
          subjectKind: 'provider_invoice',
          subjectId: inv.id,
          explanation: provider
            ? `Utföraren har status "${provider.status}".`
            : 'Utföraren är okänd i utförarregistret.',
          evidenceReferences: [`provider_invoice:${inv.id}`, `assistance_provider:${inv.providerId}`],
          amountAtRiskSek: inv.totalAmountSek,
          personId: inv.personId,
        },
      ];
    });
  },
);

/** Rule 6: Provider lacks active IVO permit. */
export const lssRule06ProviderWithoutIvoPermit = base(
  'lss_provider_without_ivo_permit',
  'Utförare saknar aktivt IVO-tillstånd',
  'Utföraren saknar giltigt IVO-tillstånd för personlig assistans.',
  'critical',
  'Stoppa betalningar och kontakta utföraren; kontrollera mot IVO:s register.',
  (ctx) =>
    ctx.providers.flatMap((provider) => {
      const hasActive = provider.ivoPermits.some((p) => p.status === 'active');
      if (hasActive) return [];
      const invoiced = ctx.invoices.filter((i) => i.providerId === provider.id);
      if (invoiced.length === 0) return [];
      return [
        {
          subjectKind: 'assistance_provider',
          subjectId: provider.id,
          explanation: 'Utföraren fakturerar utan aktivt IVO-tillstånd.',
          evidenceReferences: [
            `assistance_provider:${provider.id}`,
            ...invoiced.map((i) => `provider_invoice:${i.id}`),
          ],
          amountAtRiskSek: invoiced.reduce((sum, i) => sum + i.totalAmountSek, 0),
        },
      ];
    }),
);

/** Rule 7: Invoice org number differs from contracted provider. */
export const lssRule07InvoiceOrgNumberMismatch = base(
  'lss_invoice_org_number_mismatch',
  'Fakturans organisationsnummer avviker från avtalad utförare',
  'Organisationsnumret på fakturan matchar inte avtalet.',
  'critical',
  'Stoppa betalning och utred om fakturan är felaktig eller bedräglig.',
  (ctx) => {
    const providers = providersById(ctx);
    return ctx.invoices.flatMap((inv) => {
      const provider = providers.get(inv.providerId);
      if (!provider || !inv.invoiceOrgNumber) return [];
      const contracted = [provider.orgNumber, ...provider.contractedOrgNumbers];
      if (contracted.includes(inv.invoiceOrgNumber)) return [];
      return [
        {
          subjectKind: 'provider_invoice',
          subjectId: inv.id,
          explanation: `Fakturans orgnr ${inv.invoiceOrgNumber} matchar inte avtalad utförare (${provider.orgNumber}).`,
          evidenceReferences: [`provider_invoice:${inv.id}`, `provider_contract:${provider.id}`],
          amountAtRiskSek: inv.totalAmountSek,
          personId: inv.personId,
        },
      ];
    });
  },
);

/** Rule 8: Same assistant reports overlapping time. */
export const lssRule08AssistantOverlappingTime = base(
  'lss_assistant_overlapping_time',
  'Assistent har överlappande tidrapporter',
  'Samma assistent har rapporterat överlappande arbetspass.',
  'high',
  'Begär rättelse av tidrapporterna och kontrollera fakturerade timmar.',
  (ctx) => {
    const findings: RiskFinding[] = [];
    const rowsByAssistant = new Map<
      string,
      Array<{ reportId: string; workDate: string; startHour: number; endHour: number }>
    >();
    for (const report of ctx.timeReports) {
      for (const row of report.rows) {
        const list = rowsByAssistant.get(row.assistantId) ?? [];
        list.push({
          reportId: report.id,
          workDate: row.workDate,
          startHour: row.startHour,
          endHour: row.endHour,
        });
        rowsByAssistant.set(row.assistantId, list);
      }
    }
    for (const [assistantId, rows] of rowsByAssistant) {
      const byDate = new Map<string, typeof rows>();
      for (const row of rows) {
        const list = byDate.get(row.workDate) ?? [];
        list.push(row);
        byDate.set(row.workDate, list);
      }
      for (const [date, dateRows] of byDate) {
        const sorted = [...dateRows].sort((a, b) => a.startHour - b.startHour);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i]!.startHour < sorted[i - 1]!.endHour) {
            findings.push({
              subjectKind: 'personal_assistant',
              subjectId: assistantId,
              explanation: `Assistenten har överlappande pass ${date} (${sorted[i - 1]!.startHour}-${sorted[i - 1]!.endHour} och ${sorted[i]!.startHour}-${sorted[i]!.endHour}).`,
              evidenceReferences: [
                `assistance_time_report:${sorted[i - 1]!.reportId}`,
                `assistance_time_report:${sorted[i]!.reportId}`,
              ],
            });
          }
        }
      }
    }
    return findings;
  },
);

/** Rule 9: Same assistant reports unreasonable number of hours. */
export const lssRule09AssistantUnreasonableHours = base(
  'lss_assistant_unreasonable_hours',
  'Assistent rapporterar orimligt antal timmar',
  'Samma assistent har rapporterat fler än 16 timmar under ett dygn.',
  'high',
  'Kontrollera tidrapporterna mot schema och arbetstidsregler.',
  (ctx) => {
    const findings: RiskFinding[] = [];
    const hoursByAssistantDate = new Map<string, { hours: number; reportIds: Set<string> }>();
    for (const report of ctx.timeReports) {
      for (const row of report.rows) {
        const key = `${row.assistantId}|${row.workDate}`;
        const entry = hoursByAssistantDate.get(key) ?? { hours: 0, reportIds: new Set<string>() };
        entry.hours += row.hours;
        entry.reportIds.add(report.id);
        hoursByAssistantDate.set(key, entry);
      }
    }
    for (const [key, entry] of hoursByAssistantDate) {
      if (entry.hours <= 16) continue;
      const [assistantId, date] = key.split('|') as [string, string];
      findings.push({
        subjectKind: 'personal_assistant',
        subjectId: assistantId,
        explanation: `Assistenten har rapporterat ${entry.hours} timmar den ${date}.`,
        evidenceReferences: [...entry.reportIds].map((id) => `assistance_time_report:${id}`),
      });
    }
    return findings;
  },
);

/** Rule 10: Duplicate invoice for same person and period. */
export const lssRule10DuplicateInvoice = base(
  'lss_duplicate_invoice',
  'Dubblettfaktura för samma person och period',
  'Två fakturor avser samma person och överlappande period från samma utförare.',
  'high',
  'Avvisa dubbletten och kontrollera tidigare betalningar.',
  (ctx) => {
    const findings: RiskFinding[] = [];
    for (let i = 0; i < ctx.invoices.length; i++) {
      for (let j = i + 1; j < ctx.invoices.length; j++) {
        const a = ctx.invoices[i]!;
        const b = ctx.invoices[j]!;
        if (
          a.personId === b.personId &&
          a.providerId === b.providerId &&
          periodsOverlap(a.periodStart, a.periodEnd, b.periodStart, b.periodEnd)
        ) {
          findings.push({
            subjectKind: 'provider_invoice',
            subjectId: b.id,
            explanation: `Fakturan överlappar faktura ${a.id} för samma person och period.`,
            evidenceReferences: [`provider_invoice:${a.id}`, `provider_invoice:${b.id}`],
            amountAtRiskSek: b.totalAmountSek,
            personId: b.personId,
          });
        }
      }
    }
    return findings;
  },
);

/** Rule 11: Duplicate payment for same person and period. */
export const lssRule11DuplicatePayment = base(
  'lss_duplicate_payment',
  'Dubblettutbetalning för samma person och period',
  'Två utbetalningar med samma person, belopp och datum.',
  'critical',
  'Stoppa/återkräv dubbletten.',
  (ctx) => {
    const findings: RiskFinding[] = [];
    const seen = new Map<string, string>();
    for (const p of ctx.payments) {
      if (!p.personId) continue;
      const key = `${p.personId}|${p.amountSek}|${p.paymentDate}`;
      const first = seen.get(key);
      if (first) {
        findings.push({
          subjectKind: 'lss_payment',
          subjectId: p.id,
          explanation: `Utbetalningen är en möjlig dubblett av ${first} (samma person, belopp och datum).`,
          evidenceReferences: [`lss_payment:${first}`, `lss_payment:${p.id}`],
          amountAtRiskSek: p.amountSek,
          personId: p.personId,
        });
      } else {
        seen.set(key, p.id);
      }
    }
    return findings;
  },
);

/** Rule 12: Payment despite active recovery claim. */
export const lssRule12PaymentDespiteRecoveryClaim = base(
  'lss_payment_despite_recovery_claim',
  'Utbetalning trots aktivt återkrav',
  'Ny utbetalning har gjorts till person/utförare med öppet återkrav.',
  'high',
  'Kontrollera om utbetalningen borde kvittats mot återkravet.',
  (ctx) => {
    const activeClaims = ctx.recoveryClaims.filter((c) =>
      ['open', 'partially_recovered', 'disputed'].includes(c.status),
    );
    return ctx.payments.flatMap((p) => {
      const claim = activeClaims.find(
        (c) =>
          (c.personId && c.personId === p.personId) ||
          (c.providerId && c.providerId === p.providerId),
      );
      if (!claim || ['stopped', 'cancelled'].includes(p.status)) return [];
      return [
        {
          subjectKind: 'lss_payment',
          subjectId: p.id,
          explanation: 'Utbetalning genomförd trots aktivt återkrav.',
          evidenceReferences: [`lss_payment:${p.id}`, `lss_recovery_claim:${claim.id}`],
          amountAtRiskSek: p.amountSek,
          ...(p.personId ? { personId: p.personId } : {}),
        },
      ];
    });
  },
);

/** Rule 13: Payment account changed close to payment date. */
export const lssRule13AccountChangedNearPayment = base(
  'lss_account_changed_near_payment',
  'Konto ändrat nära utbetalningsdatum',
  'Utförarens utbetalningskonto ändrades kort före utbetalning.',
  'high',
  'Verifiera kontobytet med utföraren via känd kontaktväg.',
  (ctx) => {
    const providers = providersById(ctx);
    const windowDays = ctx.accountChangeWindowDays ?? 14;
    return ctx.payments.flatMap((p) => {
      const provider = p.providerId ? providers.get(p.providerId) : undefined;
      if (!provider?.lastAccountChangeAt) return [];
      const days =
        Math.abs(
          new Date(p.paymentDate).getTime() - new Date(provider.lastAccountChangeAt).getTime(),
        ) /
        (24 * 60 * 60 * 1000);
      if (days > windowDays) return [];
      return [
        {
          subjectKind: 'lss_payment',
          subjectId: p.id,
          explanation: `Utbetalningskontot ändrades ${provider.lastAccountChangeAt}, ${Math.round(days)} dagar före utbetalningen.`,
          evidenceReferences: [`lss_payment:${p.id}`, `payment_account_change_log:${provider.id}`],
          amountAtRiskSek: p.amountSek,
          ...(p.personId ? { personId: p.personId } : {}),
        },
      ];
    });
  },
);

/** Rule 14: Protected identity lacks elevated access protection. */
export const lssRule14ProtectedIdentityWithoutProtection = base(
  'lss_protected_identity_without_elevated_protection',
  'Skyddad identitet saknar förhöjt åtkomstskydd',
  'Person med skyddad identitet saknar förhöjd åtkomstkontroll i systemet.',
  'critical',
  'Aktivera förhöjt åtkomstskydd omedelbart och granska åtkomstloggen.',
  (ctx) =>
    ctx.protectedPersons
      .filter((p) => p.protectedIdentity && !p.hasElevatedAccessProtection)
      .map((p) => ({
        subjectKind: 'person',
        subjectId: p.personId,
        explanation: 'Skyddad identitet utan förhöjt åtkomstskydd.',
        evidenceReferences: [`person:${p.personId}`],
        personId: p.personId,
      })),
);

/** Rule 15: Medical document is misclassified. */
export const lssRule15MedicalDocumentMisclassified = base(
  'lss_medical_document_misclassified',
  'Medicinskt dokument felklassificerat',
  'Dokument av medicinsk typ har inte klassats som medicinskt.',
  'high',
  'Omklassificera dokumentet och granska vilka som haft åtkomst.',
  (ctx) => {
    const medicalTypes = ['medical_certificate', 'lakarintyg', 'need_assessment_medical'];
    return ctx.documents
      .filter((d) => medicalTypes.includes(d.documentType) && d.documentClass !== 'medical')
      .map((d) => ({
        subjectKind: 'document',
        subjectId: d.id,
        explanation: `Dokument av typ ${d.documentType} är klassat som "${d.documentClass}" i stället för "medical".`,
        evidenceReferences: [`document:${d.id}`],
        ...(d.personId ? { personId: d.personId } : {}),
      }));
  },
);

/** Rule 16: Invoice lacks decision link. */
export const lssRule16InvoiceWithoutDecisionLink = base(
  'lss_invoice_without_decision_link',
  'Faktura saknar beslutskoppling',
  'Fakturan är inte kopplad till något beslut.',
  'high',
  'Koppla fakturan till rätt beslut innan betalning.',
  (ctx) =>
    ctx.invoices
      .filter((inv) => !inv.decisionId)
      .map((inv) => ({
        subjectKind: 'provider_invoice',
        subjectId: inv.id,
        explanation: 'Fakturan saknar koppling till beslut.',
        evidenceReferences: [`provider_invoice:${inv.id}`],
        amountAtRiskSek: inv.totalAmountSek,
        personId: inv.personId,
      })),
);

/** Rule 17: Payment recipient differs from contracted provider. */
export const lssRule17RecipientDiffersFromProvider = base(
  'lss_payment_recipient_differs_from_provider',
  'Betalningsmottagare avviker från avtalad utförare',
  'Utbetalningens mottagare är inte den avtalade utföraren.',
  'critical',
  'Stoppa utbetalningen och verifiera mottagaren.',
  (ctx) => {
    const providers = providersById(ctx);
    return ctx.payments.flatMap((p) => {
      const provider = p.providerId ? providers.get(p.providerId) : undefined;
      if (!provider) return [];
      const orgMismatch =
        p.recipientOrganizationId !== undefined &&
        p.recipientOrganizationId !== provider.organizationId;
      const accountMismatch =
        p.recipientAccountReference !== undefined &&
        provider.approvedAccountReferences.length > 0 &&
        !provider.approvedAccountReferences.includes(p.recipientAccountReference);
      if (!orgMismatch && !accountMismatch) return [];
      return [
        {
          subjectKind: 'lss_payment',
          subjectId: p.id,
          explanation: orgMismatch
            ? 'Mottagarorganisationen matchar inte den avtalade utföraren.'
            : 'Mottagarkontot finns inte bland utförarens godkända konton.',
          evidenceReferences: [`lss_payment:${p.id}`, `assistance_provider:${provider.id}`],
          amountAtRiskSek: p.amountSek,
          ...(p.personId ? { personId: p.personId } : {}),
        },
      ];
    });
  },
);

/** Rule 18: Cancelled/ended decision still has invoicing. */
export const lssRule18EndedDecisionStillInvoiced = base(
  'lss_ended_decision_still_invoiced',
  'Avslutat beslut faktureras fortfarande',
  'Faktura avser period efter att beslutet avslutats/upphört.',
  'high',
  'Avvisa fakturan och informera utföraren.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.invoices.flatMap((inv) => {
      const decision = inv.decisionId ? decisions.get(inv.decisionId) : undefined;
      if (!decision) return [];
      const ended = ['terminated', 'expired', 'superseded'].includes(decision.status);
      const invoicedAfterEnd =
        decision.periodEnd !== undefined && inv.periodStart > decision.periodEnd;
      if (!ended && !invoicedAfterEnd) return [];
      return [
        {
          subjectKind: 'provider_invoice',
          subjectId: inv.id,
          explanation: ended
            ? `Beslutet har status "${decision.status}" men fakturering fortsätter.`
            : 'Fakturaperioden börjar efter beslutets slutdatum.',
          evidenceReferences: [`provider_invoice:${inv.id}`, `lss_decision:${decision.id}`],
          amountAtRiskSek: inv.totalAmountSek,
          personId: inv.personId,
        },
      ];
    });
  },
);

/** Rule 19: Time report lacks approval. */
export const lssRule19TimeReportWithoutApproval = base(
  'lss_time_report_without_approval',
  'Tidrapport saknar godkännande',
  'Tidrapporten har använts som underlag utan godkännande.',
  'medium',
  'Begär godkännande innan fakturan betalas.',
  (ctx) =>
    ctx.timeReports
      .filter((tr) => !tr.approved)
      .map((tr) => ({
        subjectKind: 'assistance_time_report',
        subjectId: tr.id,
        explanation: `Tidrapporten ${tr.periodStart}–${tr.periodEnd} saknar godkännande.`,
        evidenceReferences: [`assistance_time_report:${tr.id}`],
        personId: tr.personId,
      })),
);

/** Rule 20: Unusual increase in hours compared to previous period. */
export const lssRule20UnusualHoursIncrease = base(
  'lss_unusual_hours_increase',
  'Ovanlig ökning av timmar jämfört med föregående period',
  'Rapporterade timmar har ökat kraftigt (>50%) jämfört med föregående period.',
  'medium',
  'Kontrollera om ökningen är motiverad av ändrat beslut eller behov.',
  (ctx) => {
    const findings: RiskFinding[] = [];
    const byPerson = new Map<string, typeof ctx.timeReports>();
    for (const tr of ctx.timeReports) {
      const list = byPerson.get(tr.personId) ?? [];
      list.push(tr);
      byPerson.set(tr.personId, list);
    }
    for (const [personId, reports] of byPerson) {
      const sorted = [...reports].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const curr = sorted[i]!;
        if (prev.totalHours > 0 && curr.totalHours > prev.totalHours * 1.5) {
          findings.push({
            subjectKind: 'assistance_time_report',
            subjectId: curr.id,
            explanation: `Timmarna ökade från ${prev.totalHours} till ${curr.totalHours} mellan perioderna.`,
            evidenceReferences: [
              `assistance_time_report:${prev.id}`,
              `assistance_time_report:${curr.id}`,
            ],
            personId,
          });
        }
      }
    }
    return findings;
  },
);

/** Rule 21: Payment file contains recipient not matching approved provider. */
export const lssRule21PaymentFileUnknownRecipient = base(
  'lss_payment_file_unknown_recipient',
  'Betalningsfil innehåller mottagare som inte matchar godkänd utförare',
  'Rad i betalningsfil har mottagare som inte finns bland godkända utförare.',
  'critical',
  'Stoppa filen och utred mottagaren.',
  (ctx) => {
    const knownOrgNumbers = new Set(
      ctx.providers.flatMap((p) => [p.orgNumber, ...p.contractedOrgNumbers]),
    );
    const knownAccounts = new Set(ctx.providers.flatMap((p) => p.approvedAccountReferences));
    return ctx.paymentFileRows.flatMap((row) => {
      const orgKnown = row.recipientOrgNumber ? knownOrgNumbers.has(row.recipientOrgNumber) : false;
      const accountKnown = row.recipientAccountReference
        ? knownAccounts.has(row.recipientAccountReference)
        : false;
      if (orgKnown || accountKnown) return [];
      return [
        {
          subjectKind: 'payment_file_row',
          subjectId: row.id,
          explanation: 'Mottagaren i betalningsfilen matchar ingen godkänd utförare.',
          evidenceReferences: [`payment_file_row:${row.id}`],
          amountAtRiskSek: row.amountSek,
        },
      ];
    });
  },
);

/** Rule 22: Payment status is paid but no approved invoice exists. */
export const lssRule22PaidWithoutApprovedInvoice = base(
  'lss_paid_without_approved_invoice',
  'Utbetald utan godkänd faktura',
  'Utbetalningen är markerad som betald men ingen godkänd faktura finns.',
  'critical',
  'Utred utbetalningen och initiera återkrav vid behov.',
  (ctx) => {
    const approvedInvoiceIds = new Set(
      ctx.invoices.filter((i) => ['approved', 'paid'].includes(i.status)).map((i) => i.id),
    );
    return ctx.payments.flatMap((p) => {
      if (p.status !== 'paid') return [];
      if (p.invoiceId && approvedInvoiceIds.has(p.invoiceId)) return [];
      return [
        {
          subjectKind: 'lss_payment',
          subjectId: p.id,
          explanation: p.invoiceId
            ? 'Utbetalningens faktura är inte godkänd.'
            : 'Utbetalningen saknar faktura.',
          evidenceReferences: [`lss_payment:${p.id}`],
          amountAtRiskSek: p.amountSek,
          ...(p.personId ? { personId: p.personId } : {}),
        },
      ];
    });
  },
);

/** Rule 23: Recovery claim exists but payment batch still includes recipient. */
export const lssRule23RecoveryClaimRecipientInBatch = base(
  'lss_recovery_claim_recipient_in_batch',
  'Mottagare med återkrav finns kvar i betalningsbatch',
  'En betalningsbatch innehåller mottagare med aktivt återkrav.',
  'high',
  'Ta bort mottagaren ur batchen eller dokumentera kvittningsbeslut.',
  (ctx) => {
    const activeClaims = ctx.recoveryClaims.filter((c) =>
      ['open', 'partially_recovered', 'disputed'].includes(c.status),
    );
    return ctx.paymentBatches.flatMap((batch) => {
      if (['cancelled', 'completed'].includes(batch.status)) return [];
      const conflicting = activeClaims.filter(
        (c) =>
          (c.providerId && batch.recipientProviderIds.includes(c.providerId)) ||
          (c.personId && batch.recipientPersonIds.includes(c.personId)),
      );
      return conflicting.map((claim) => ({
        subjectKind: 'lss_payment_batch',
        subjectId: batch.id,
        explanation: 'Betalningsbatchen innehåller mottagare med aktivt återkrav.',
        evidenceReferences: [`lss_payment_batch:${batch.id}`, `lss_recovery_claim:${claim.id}`],
      }));
    });
  },
);

/** Rule 24: Provider risk flag exists but no manual review was performed. */
export const lssRule24ProviderFlagWithoutReview = base(
  'lss_provider_flag_without_review',
  'Utförarflagga utan manuell granskning',
  'Utföraren har riskflaggor som inte granskats manuellt.',
  'medium',
  'Genomför manuell granskning av utförarens riskflaggor.',
  (ctx) =>
    ctx.providers.flatMap((provider) => {
      const unreviewed = provider.riskFlags.filter((f) => !f.manuallyReviewed);
      if (unreviewed.length === 0) return [];
      return [
        {
          subjectKind: 'assistance_provider',
          subjectId: provider.id,
          explanation: `${unreviewed.length} riskflagga/-or för utföraren saknar manuell granskning.`,
          evidenceReferences: [`assistance_provider:${provider.id}`],
        },
      ];
    }),
);

/** Rule 25: Sensitive LSS document was accessed without reason-required reveal. */
export const lssRule25SensitiveDocAccessWithoutReason = base(
  'lss_sensitive_document_access_without_reason',
  'Känsligt dokument öppnat utan angivet skäl',
  'Ett känsligt LSS-dokument öppnades utan att skäl registrerades.',
  'high',
  'Granska åtkomsten (inre sekretess) och följ upp med berörd användare.',
  (ctx) => {
    const sensitiveClasses = ['sensitive', 'medical', 'protected_identity', 'children'];
    return ctx.documentAccessEvents
      .filter((e) => sensitiveClasses.includes(e.documentClass) && !e.reasonRecorded)
      .map((e) => ({
        subjectKind: 'document_access',
        subjectId: e.documentId,
        explanation: `Användare ${e.actorUserId} öppnade känsligt dokument utan skäl.`,
        evidenceReferences: [`document:${e.documentId}`, `user:${e.actorUserId}`],
      }));
  },
);

export const ALL_LSS_RULES: LssRule[] = [
  lssRule01PaymentAfterDecisionEnd,
  lssRule02PaymentBeforeDecisionStart,
  lssRule03BilledHoursExceedDecision,
  lssRule04TimeReportMissing,
  lssRule05InvoiceWithoutApprovedProvider,
  lssRule06ProviderWithoutIvoPermit,
  lssRule07InvoiceOrgNumberMismatch,
  lssRule08AssistantOverlappingTime,
  lssRule09AssistantUnreasonableHours,
  lssRule10DuplicateInvoice,
  lssRule11DuplicatePayment,
  lssRule12PaymentDespiteRecoveryClaim,
  lssRule13AccountChangedNearPayment,
  lssRule14ProtectedIdentityWithoutProtection,
  lssRule15MedicalDocumentMisclassified,
  lssRule16InvoiceWithoutDecisionLink,
  lssRule17RecipientDiffersFromProvider,
  lssRule18EndedDecisionStillInvoiced,
  lssRule19TimeReportWithoutApproval,
  lssRule20UnusualHoursIncrease,
  lssRule21PaymentFileUnknownRecipient,
  lssRule22PaidWithoutApprovedInvoice,
  lssRule23RecoveryClaimRecipientInBatch,
  lssRule24ProviderFlagWithoutReview,
  lssRule25SensitiveDocAccessWithoutReason,
];
