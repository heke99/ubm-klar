import type { RiskFinding, RiskRuleDefinition } from '@ubm-klar/rule-engine';
import type { EaRuleContext } from './types';

type EaRule = RiskRuleDefinition<EaRuleContext>;

function base(
  ruleKey: string,
  title: string,
  description: string,
  severity: EaRule['severity'],
  recommendedAction: string,
  evaluate: EaRule['evaluate'],
): EaRule {
  return {
    ruleKey,
    version: '1.0.0',
    status: 'active',
    domain: 'economic_assistance',
    title,
    description,
    severity,
    recommendedAction,
    legalSourceKey: 'sol_2001_453',
    legalSourceVersion: '2026-07-01',
    evaluate,
  };
}

const decisionsById = (ctx: EaRuleContext) => new Map(ctx.decisions.map((d) => [d.id, d]));
const householdsById = (ctx: EaRuleContext) => new Map(ctx.households.map((h) => [h.id, h]));

/** Rule 1: Payment lacks decision. */
export const eaRule01PaymentWithoutDecision = base(
  'ea_payment_without_decision',
  'Utbetalning saknar beslut',
  'Utbetalning har skapats utan koppling till beslut.',
  'critical',
  'Stoppa utbetalningen och utred beslutskopplingen.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.payments.flatMap((p) => {
      if (p.decisionId && decisions.has(p.decisionId)) return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: 'Utbetalningen saknar giltig beslutskoppling.',
          evidenceReferences: [`ea_payment:${p.id}`],
          amountAtRiskSek: p.amountSek,
          ...(p.personId ? { personId: p.personId } : {}),
        },
      ];
    });
  },
);

/** Rule 2: Payment exceeds approved amount. */
export const eaRule02PaymentExceedsApproved = base(
  'ea_payment_exceeds_approved_amount',
  'Utbetalning överstiger beviljat belopp',
  'Utbetalt belopp är högre än beslutets beviljade belopp.',
  'high',
  'Utred mellanskillnaden och initiera återkrav vid behov.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.payments.flatMap((p) => {
      const decision = p.decisionId ? decisions.get(p.decisionId) : undefined;
      if (!decision || p.amountSek <= decision.approvedAmountSek + 0.005) return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: `Utbetalt ${p.amountSek} SEK överstiger beviljat ${decision.approvedAmountSek} SEK.`,
          evidenceReferences: [`ea_payment:${p.id}`, `ea_decision:${decision.id}`],
          amountAtRiskSek: p.amountSek - decision.approvedAmountSek,
          ...(p.personId ? { personId: p.personId } : {}),
        },
      ];
    });
  },
);

/** Rule 3: Payment occurs after decision validity. */
export const eaRule03PaymentAfterDecisionValidity = base(
  'ea_payment_after_decision_validity',
  'Utbetalning efter beslutets giltighetstid',
  'Utbetalning har gjorts efter att beslutet slutat gälla.',
  'high',
  'Utred och initiera återkrav vid behov.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.payments.flatMap((p) => {
      const decision = p.decisionId ? decisions.get(p.decisionId) : undefined;
      if (!decision || p.paymentDate <= decision.periodEnd) return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: `Utbetalning ${p.paymentDate} efter beslutets giltighet t.o.m. ${decision.periodEnd}.`,
          evidenceReferences: [`ea_payment:${p.id}`, `ea_decision:${decision.id}`],
          amountAtRiskSek: p.amountSek,
          ...(p.personId ? { personId: p.personId } : {}),
        },
      ];
    });
  },
);

/** Rule 4: Duplicate payment to same household and period. */
export const eaRule04DuplicatePayment = base(
  'ea_duplicate_payment_household_period',
  'Dubblettutbetalning till samma hushåll och period',
  'Två utbetalningar till samma hushåll med samma belopp och period.',
  'critical',
  'Stoppa/återkräv dubbletten.',
  (ctx) => {
    const findings: RiskFinding[] = [];
    const seen = new Map<string, string>();
    for (const p of ctx.payments) {
      if (!p.householdId) continue;
      const key = `${p.householdId}|${p.amountSek}|${p.periodStart ?? p.paymentDate}`;
      const first = seen.get(key);
      if (first) {
        findings.push({
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: `Möjlig dubblett av utbetalning ${first} (samma hushåll, belopp och period).`,
          evidenceReferences: [`ea_payment:${first}`, `ea_payment:${p.id}`],
          amountAtRiskSek: p.amountSek,
        });
      } else {
        seen.set(key, p.id);
      }
    }
    return findings;
  },
);

/** Rule 5: Income record lacks period. */
export const eaRule05IncomeWithoutPeriod = base(
  'ea_income_without_period',
  'Inkomstuppgift saknar period',
  'Inkomstposten saknar angiven period.',
  'medium',
  'Komplettera inkomstuppgiften med period.',
  (ctx) =>
    ctx.incomes
      .filter((i) => !i.periodStart || !i.periodEnd)
      .map((i) => ({
        subjectKind: 'ea_income',
        subjectId: i.id,
        explanation: 'Inkomstuppgiften saknar period.',
        evidenceReferences: [`ea_income:${i.id}`],
        personId: i.personId,
      })),
);

/** Rule 6: Income verified after decision affects eligibility. */
export const eaRule06IncomeVerifiedAfterDecision = base(
  'ea_income_verified_after_decision',
  'Inkomst verifierad efter beslut påverkar rätten',
  'Verifierad inkomst inkom efter beslutet och kan påverka biståndsrätten.',
  'high',
  'Ompröva beslutet mot den verifierade inkomsten.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.incomes.flatMap((income) => {
      if (income.kind !== 'verified' || !income.verifiedAt || income.usedInDecision) return [];
      const relatedDecision = [...decisions.values()].find(
        (d) =>
          d.applicationId !== undefined &&
          d.applicationId === income.applicationId &&
          income.verifiedAt! > d.decidedAt,
      );
      if (!relatedDecision) return [];
      return [
        {
          subjectKind: 'ea_income',
          subjectId: income.id,
          explanation: `Inkomsten verifierades ${income.verifiedAt} efter beslutet ${relatedDecision.decidedAt}.`,
          evidenceReferences: [`ea_income:${income.id}`, `ea_decision:${relatedDecision.id}`],
          amountAtRiskSek: income.amountSek,
          personId: income.personId,
        },
      ];
    });
  },
);

/** Rule 7: Household member missing from calculation. */
export const eaRule07MemberMissingFromCalculation = base(
  'ea_household_member_missing_from_calculation',
  'Hushållsmedlem saknas i beräkning',
  'En hushållsmedlem ingår inte i normberäkningen.',
  'medium',
  'Kontrollera beräkningen mot hushållets sammansättning.',
  (ctx) => {
    const households = householdsById(ctx);
    return ctx.calculations.flatMap((calc) => {
      const decision = calc.decisionId
        ? ctx.decisions.find((d) => d.id === calc.decisionId)
        : undefined;
      const household = decision ? households.get(decision.householdId) : undefined;
      if (!household) return [];
      const missing = household.memberPersonIds.filter((m) => !calc.includedPersonIds.includes(m));
      if (missing.length === 0) return [];
      return [
        {
          subjectKind: 'ea_calculation',
          subjectId: calc.id,
          explanation: `${missing.length} hushållsmedlem(mar) saknas i beräkningen.`,
          evidenceReferences: [`ea_calculation:${calc.id}`, `ea_household:${household.id}`],
        },
      ];
    });
  },
);

/** Rule 8: Housing cost lacks supporting document. */
export const eaRule08HousingCostWithoutDocument = base(
  'ea_housing_cost_without_document',
  'Boendekostnad saknar underlag',
  'Boendekostnaden saknar styrkande dokument (kontrakt/kvitto).',
  'medium',
  'Begär in hyresavi/kontrakt innan kostnaden godkänns.',
  (ctx) =>
    ctx.housingRecords
      .filter((h) => (h.monthlyCostSek ?? 0) > 0 && !h.hasContractDocument)
      .map((h) => ({
        subjectKind: 'ea_housing_record',
        subjectId: h.id,
        explanation: 'Boendekostnad utan styrkande dokument.',
        evidenceReferences: [`ea_housing_record:${h.id}`],
        amountAtRiskSek: h.monthlyCostSek ?? 0,
      })),
);

/** Rule 9: Application lacks required attachment. */
export const eaRule09ApplicationMissingAttachment = base(
  'ea_application_missing_required_attachment',
  'Ansökan saknar obligatorisk bilaga',
  'Obligatoriska bilagor saknas i ansökan.',
  'medium',
  'Begär komplettering innan beslut.',
  (ctx) =>
    ctx.applications.flatMap((app) => {
      const missing = app.requiredDocumentRoles.filter(
        (role) => !app.attachedDocumentRoles.includes(role),
      );
      if (missing.length === 0) return [];
      return [
        {
          subjectKind: 'ea_application',
          subjectId: app.id,
          explanation: `Saknade bilagor: ${missing.join(', ')}.`,
          evidenceReferences: [`ea_application:${app.id}`],
        },
      ];
    }),
);

/** Rule 10: Recovery claim exists but new payment occurs without control. */
export const eaRule10PaymentDespiteRecoveryClaim = base(
  'ea_payment_despite_recovery_claim',
  'Ny utbetalning trots återkrav utan kontroll',
  'Utbetalning till hushåll med aktivt återkrav utan dokumenterad kontroll.',
  'high',
  'Dokumentera kontroll/kvittning innan ny utbetalning.',
  (ctx) => {
    const activeClaims = ctx.recoveryClaims.filter(
      (c) =>
        ['open', 'partially_recovered', 'disputed'].includes(c.status) &&
        !c.controlPerformedForNewPayments,
    );
    return ctx.payments.flatMap((p) => {
      const claim = activeClaims.find(
        (c) =>
          (c.householdId && c.householdId === p.householdId) ||
          (c.personId && c.personId === p.personId),
      );
      if (!claim) return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: 'Ny utbetalning utan kontroll trots aktivt återkrav.',
          evidenceReferences: [`ea_payment:${p.id}`, `ea_recovery_claim:${claim.id}`],
          amountAtRiskSek: p.amountSek,
        },
      ];
    });
  },
);

/** Rule 11: Account used by multiple households without explanation. */
export const eaRule11AccountSharedAcrossHouseholds = base(
  'ea_account_shared_across_households',
  'Konto används av flera hushåll',
  'Samma kontoreferens används av flera hushåll utan förklaring.',
  'high',
  'Utred kontokopplingen; risk för felaktiga eller bedrägliga utbetalningar.',
  (ctx) => {
    const findings: RiskFinding[] = [];
    const byAccount = new Map<string, Set<string>>();
    for (const household of ctx.households) {
      for (const account of household.accountReferences) {
        const set = byAccount.get(account) ?? new Set<string>();
        set.add(household.id);
        byAccount.set(account, set);
      }
    }
    for (const [account, households] of byAccount) {
      if (households.size > 1) {
        findings.push({
          subjectKind: 'account_reference',
          subjectId: account,
          explanation: `Kontot används av ${households.size} hushåll.`,
          evidenceReferences: [...households].map((h) => `ea_household:${h}`),
        });
      }
    }
    return findings;
  },
);

/** Rule 12: Account changed close to payment date. */
export const eaRule12AccountChangedNearPayment = base(
  'ea_account_changed_near_payment',
  'Konto ändrat nära utbetalningsdatum',
  'Hushållets konto ändrades kort före utbetalning.',
  'high',
  'Verifiera kontobytet med den enskilde via känd kontaktväg.',
  (ctx) => {
    const households = householdsById(ctx);
    const windowDays = ctx.accountChangeWindowDays ?? 14;
    return ctx.payments.flatMap((p) => {
      const household = p.householdId ? households.get(p.householdId) : undefined;
      if (!household?.lastAccountChangeAt) return [];
      const days =
        Math.abs(
          new Date(p.paymentDate).getTime() - new Date(household.lastAccountChangeAt).getTime(),
        ) /
        (24 * 60 * 60 * 1000);
      if (days > windowDays) return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: `Kontot ändrades ${household.lastAccountChangeAt}, ${Math.round(days)} dagar före utbetalningen.`,
          evidenceReferences: [`ea_payment:${p.id}`, `ea_household:${household.id}`],
          amountAtRiskSek: p.amountSek,
        },
      ];
    });
  },
);

/** Rule 13: Decision changed but old payment details are used. */
export const eaRule13DecisionChangedOldPaymentDetails = base(
  'ea_decision_changed_old_payment_details',
  'Beslut ändrat men gamla betalningsuppgifter används',
  'Utbetalning använder betalningsuppgifter från ett ersatt beslut.',
  'high',
  'Uppdatera betalningsuppgifterna enligt det gällande beslutet.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.payments.flatMap((p) => {
      const decision = p.decisionId ? decisions.get(p.decisionId) : undefined;
      if (!decision || decision.status !== 'superseded') return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: 'Utbetalningen bygger på ett ersatt beslut.',
          evidenceReferences: [`ea_payment:${p.id}`, `ea_decision:${decision.id}`],
          amountAtRiskSek: p.amountSek,
        },
      ];
    });
  },
);

/** Rule 14: Rejection exists but payment was still created. */
export const eaRule14PaymentDespiteRejection = base(
  'ea_payment_despite_rejection',
  'Utbetalning trots avslag',
  'Utbetalning skapades trots att beslutet är ett avslag.',
  'critical',
  'Stoppa utbetalningen omedelbart.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.payments.flatMap((p) => {
      const decision = p.decisionId ? decisions.get(p.decisionId) : undefined;
      if (!decision || decision.decisionKind !== 'rejection') return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: 'Utbetalning kopplad till avslagsbeslut.',
          evidenceReferences: [`ea_payment:${p.id}`, `ea_decision:${decision.id}`],
          amountAtRiskSek: p.amountSek,
        },
      ];
    });
  },
);

/** Rule 15: Reconsideration is ongoing but payment goes through. */
export const eaRule15PaymentDuringReconsideration = base(
  'ea_payment_during_reconsideration',
  'Utbetalning under pågående omprövning',
  'Utbetalning genomförs medan beslutet omprövas.',
  'medium',
  'Kontrollera om utbetalningen bör pausas tills omprövningen är klar.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.payments.flatMap((p) => {
      const decision = p.decisionId ? decisions.get(p.decisionId) : undefined;
      if (!decision || decision.status !== 'under_reconsideration') return [];
      if (['paused', 'stopped', 'cancelled'].includes(p.status)) return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: 'Utbetalning genomförs trots pågående omprövning.',
          evidenceReferences: [`ea_payment:${p.id}`, `ea_decision:${decision.id}`],
          amountAtRiskSek: p.amountSek,
        },
      ];
    });
  },
);

/** Rule 16: Income was not used in decision. */
export const eaRule16IncomeNotUsedInDecision = base(
  'ea_income_not_used_in_decision',
  'Inkomst användes inte i beslut',
  'Registrerad inkomst har inte beaktats i beslutet.',
  'high',
  'Kontrollera om beslutet blivit för högt och ompröva.',
  (ctx) =>
    ctx.incomes
      .filter((i) => !i.usedInDecision && i.amountSek > 0 && i.applicationId)
      .map((i) => ({
        subjectKind: 'ea_income',
        subjectId: i.id,
        explanation: `Inkomst om ${i.amountSek} SEK har inte använts i beslutet.`,
        evidenceReferences: [`ea_income:${i.id}`],
        amountAtRiskSek: i.amountSek,
        personId: i.personId,
      })),
);

/** Rule 17: Household changed after decision. */
export const eaRule17HouseholdChangedAfterDecision = base(
  'ea_household_changed_after_decision',
  'Hushållet ändrat efter beslut',
  'Hushållets sammansättning ändrades efter beslutet.',
  'medium',
  'Kontrollera om beslutet behöver omprövas.',
  (ctx) => {
    const changedHouseholds = ctx.households.filter((h) => h.membersChangedAfterDecision);
    return ctx.decisions.flatMap((d) => {
      const household = changedHouseholds.find((h) => h.id === d.householdId);
      if (!household || d.status !== 'active') return [];
      return [
        {
          subjectKind: 'ea_decision',
          subjectId: d.id,
          explanation: 'Hushållets sammansättning har ändrats efter beslutet.',
          evidenceReferences: [`ea_decision:${d.id}`, `ea_household:${household.id}`],
        },
      ];
    });
  },
);

/** Rule 18: Housing cost lacks document link. */
export const eaRule18HousingCostWithoutDocumentLink = base(
  'ea_housing_cost_without_document_link',
  'Boendekostnad saknar dokumentlänk',
  'Boendekostnad i beräkningen saknar länk till dokument.',
  'low',
  'Koppla dokumentet till boendeposten.',
  (ctx) =>
    ctx.housingRecords
      .filter((h) => (h.monthlyCostSek ?? 0) > 0 && h.hasContractDocument && !h.hasCostDocumentLink)
      .map((h) => ({
        subjectKind: 'ea_housing_record',
        subjectId: h.id,
        explanation: 'Boendekostnaden saknar länk till styrkande dokument.',
        evidenceReferences: [`ea_housing_record:${h.id}`],
      })),
);

/** Rule 19: Payment recipient differs from household. */
export const eaRule19RecipientOutsideHousehold = base(
  'ea_payment_recipient_outside_household',
  'Betalningsmottagare utanför hushållet',
  'Utbetalningens mottagare tillhör inte hushållet och är inte verifierad tredje part.',
  'high',
  'Verifiera mottagaren (t.ex. hyresvärd) eller stoppa utbetalningen.',
  (ctx) => {
    const households = householdsById(ctx);
    return ctx.payments.flatMap((p) => {
      if (!p.householdId || !p.recipientPersonId) return [];
      if (p.recipientKind === 'landlord' || p.recipientKind === 'other_verified') return [];
      const household = households.get(p.householdId);
      if (!household || household.memberPersonIds.includes(p.recipientPersonId)) return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: 'Mottagaren ingår inte i hushållet.',
          evidenceReferences: [`ea_payment:${p.id}`, `ea_household:${household.id}`],
          amountAtRiskSek: p.amountSek,
        },
      ];
    });
  },
);

/** Rule 20: Application, decision and payment periods do not match. */
export const eaRule20PeriodMismatch = base(
  'ea_application_decision_payment_period_mismatch',
  'Perioder för ansökan, beslut och utbetalning matchar inte',
  'Utbetalningens period ligger utanför besluts- och ansökningsperioden.',
  'medium',
  'Kontrollera periodkedjan ansökan → beslut → utbetalning.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    const applications = new Map(ctx.applications.map((a) => [a.id, a]));
    return ctx.payments.flatMap((p) => {
      const decision = p.decisionId ? decisions.get(p.decisionId) : undefined;
      if (!decision || !p.periodStart || !p.periodEnd) return [];
      const outsideDecision =
        p.periodStart < decision.periodStart || p.periodEnd > decision.periodEnd;
      const application = decision.applicationId
        ? applications.get(decision.applicationId)
        : undefined;
      const outsideApplication =
        application?.periodStart !== undefined &&
        application.periodEnd !== undefined &&
        (decision.periodStart < application.periodStart ||
          decision.periodEnd > application.periodEnd);
      if (!outsideDecision && !outsideApplication) return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: outsideDecision
            ? 'Utbetalningsperioden ligger utanför beslutsperioden.'
            : 'Beslutsperioden ligger utanför ansökningsperioden.',
          evidenceReferences: [`ea_payment:${p.id}`, `ea_decision:${decision.id}`],
          amountAtRiskSek: p.amountSek,
        },
      ];
    });
  },
);

/** Rule 21: Payment file contains payment not connected to approved decision. */
export const eaRule21PaymentFileRowWithoutDecision = base(
  'ea_payment_file_row_without_decision',
  'Betalningsfil innehåller utbetalning utan godkänt beslut',
  'Rad i betalningsfil kan inte kopplas till ett godkänt beslut.',
  'critical',
  'Stoppa raden och utred.',
  (ctx) => {
    const approvedDecisionIds = new Set(
      ctx.decisions
        .filter((d) => ['approval', 'partial_approval'].includes(d.decisionKind))
        .map((d) => d.id),
    );
    return ctx.paymentFileRows.flatMap((row) => {
      if (row.matchedDecisionId && approvedDecisionIds.has(row.matchedDecisionId)) return [];
      return [
        {
          subjectKind: 'payment_file_row',
          subjectId: row.id,
          explanation: 'Raden i betalningsfilen saknar koppling till godkänt beslut.',
          evidenceReferences: [`payment_file_row:${row.id}`],
          amountAtRiskSek: row.amountSek,
        },
      ];
    });
  },
);

/** Rule 22: Payment recipient changed after decision but before payment. */
export const eaRule22RecipientChangedAfterDecision = base(
  'ea_recipient_changed_after_decision',
  'Mottagare ändrad efter beslut men före utbetalning',
  'Kontouppgiften ändrades mellan beslut och utbetalning.',
  'high',
  'Verifiera ändringen innan utbetalning genomförs.',
  (ctx) => {
    const decisions = decisionsById(ctx);
    return ctx.payments.flatMap((p) => {
      const decision = p.decisionId ? decisions.get(p.decisionId) : undefined;
      if (!decision?.accountReferenceAtDecision || !p.accountReference) return [];
      if (decision.accountReferenceAtDecision === p.accountReference) return [];
      return [
        {
          subjectKind: 'ea_payment',
          subjectId: p.id,
          explanation: 'Utbetalningens konto avviker från kontot som var registrerat vid beslutet.',
          evidenceReferences: [`ea_payment:${p.id}`, `ea_decision:${decision.id}`],
          amountAtRiskSek: p.amountSek,
        },
      ];
    });
  },
);

/** Rule 23: Verified income exists but calculation used declared income only. */
export const eaRule23CalculationIgnoredVerifiedIncome = base(
  'ea_calculation_ignored_verified_income',
  'Beräkning använde endast deklarerad inkomst trots verifierad inkomst',
  'Verifierad inkomst fanns men beräkningen använde bara deklarerade uppgifter.',
  'high',
  'Räkna om med verifierad inkomst.',
  (ctx) =>
    ctx.calculations.flatMap((calc) => {
      if (!calc.usedDeclaredIncomeOnly) return [];
      const verified = ctx.incomes.filter(
        (i) => i.kind === 'verified' && i.applicationId === calc.applicationId,
      );
      if (verified.length === 0) return [];
      return [
        {
          subjectKind: 'ea_calculation',
          subjectId: calc.id,
          explanation: `Beräkningen använde deklarerad inkomst trots ${verified.length} verifierad(e) inkomstpost(er).`,
          evidenceReferences: [
            `ea_calculation:${calc.id}`,
            ...verified.map((v) => `ea_income:${v.id}`),
          ],
        },
      ];
    }),
);

/** Rule 24: Household has protected identity marker but access controls are not elevated. */
export const eaRule24ProtectedHouseholdWithoutElevatedAccess = base(
  'ea_protected_household_without_elevated_access',
  'Skyddad identitet i hushåll utan förhöjd åtkomstkontroll',
  'Hushåll med skyddad identitet saknar förhöjt åtkomstskydd.',
  'critical',
  'Aktivera förhöjt åtkomstskydd omedelbart och granska åtkomstloggen.',
  (ctx) =>
    ctx.households
      .filter((h) => h.protectedIdentity && !h.elevatedAccessProtection)
      .map((h) => ({
        subjectKind: 'ea_household',
        subjectId: h.id,
        explanation: 'Hushåll med skyddad identitet utan förhöjt åtkomstskydd.',
        evidenceReferences: [`ea_household:${h.id}`],
      })),
);

/** Rule 25: Sensitive economic assistance field was revealed without reason. */
export const eaRule25SensitiveRevealWithoutReason = base(
  'ea_sensitive_field_reveal_without_reason',
  'Känsligt fält visades utan angivet skäl',
  'Ett maskerat känsligt fält visades utan att skäl registrerades.',
  'high',
  'Granska åtkomsten (inre sekretess) och följ upp med berörd användare.',
  (ctx) =>
    ctx.sensitiveReveals
      .filter((r) => !r.reasonRecorded)
      .map((r) => ({
        subjectKind: 'sensitive_field_reveal',
        subjectId: r.entityId,
        explanation: `Fältet ${r.fieldKey} visades av ${r.actorUserId} utan skäl.`,
        evidenceReferences: [`entity:${r.entityId}`, `user:${r.actorUserId}`],
      })),
);

export const ALL_EA_RULES: EaRule[] = [
  eaRule01PaymentWithoutDecision,
  eaRule02PaymentExceedsApproved,
  eaRule03PaymentAfterDecisionValidity,
  eaRule04DuplicatePayment,
  eaRule05IncomeWithoutPeriod,
  eaRule06IncomeVerifiedAfterDecision,
  eaRule07MemberMissingFromCalculation,
  eaRule08HousingCostWithoutDocument,
  eaRule09ApplicationMissingAttachment,
  eaRule10PaymentDespiteRecoveryClaim,
  eaRule11AccountSharedAcrossHouseholds,
  eaRule12AccountChangedNearPayment,
  eaRule13DecisionChangedOldPaymentDetails,
  eaRule14PaymentDespiteRejection,
  eaRule15PaymentDuringReconsideration,
  eaRule16IncomeNotUsedInDecision,
  eaRule17HouseholdChangedAfterDecision,
  eaRule18HousingCostWithoutDocumentLink,
  eaRule19RecipientOutsideHousehold,
  eaRule20PeriodMismatch,
  eaRule21PaymentFileRowWithoutDecision,
  eaRule22RecipientChangedAfterDecision,
  eaRule23CalculationIgnoredVerifiedIncome,
  eaRule24ProtectedHouseholdWithoutElevatedAccess,
  eaRule25SensitiveRevealWithoutReason,
];
