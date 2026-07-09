import { describe, expect, it } from 'vitest';
import { RuleEngine } from '@ubm-klar/rule-engine';
import { ALL_EA_RULES } from './rules';
import { emptyEaContext, type EaRuleContext } from './types';

function runRule(ruleKey: string, ctx: Partial<EaRuleContext>) {
  const engine = new RuleEngine<EaRuleContext>();
  engine.registerAll(ALL_EA_RULES.filter((r) => r.ruleKey === ruleKey));
  return engine.run({ ...emptyEaContext(), ...ctx }).flags;
}

const decision = {
  id: 'd1',
  householdId: 'h1',
  applicationId: 'a1',
  decisionKind: 'approval' as const,
  status: 'active' as const,
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  approvedAmountSek: 10000,
  decidedAt: '2026-05-28',
  accountReferenceAtDecision: 'KONTO-1',
};

const household = {
  id: 'h1',
  memberPersonIds: ['p1', 'p2'],
  protectedIdentity: false,
  elevatedAccessProtection: false,
  accountReferences: ['KONTO-1'],
};

const payment = {
  id: 'pay1',
  decisionId: 'd1',
  householdId: 'h1',
  personId: 'p1',
  amountSek: 10000,
  paymentDate: '2026-06-25',
  status: 'paid',
  accountReference: 'KONTO-1',
  recipientKind: 'applicant' as const,
  recipientPersonId: 'p1',
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
};

describe('EA rules 1-4: payment/decision basics', () => {
  it('rule 1 flags payments without decision', () => {
    const { decisionId: _d, ...noDecision } = payment;
    const flags = runRule('ea_payment_without_decision', {
      payments: [noDecision as typeof payment],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.severity).toBe('critical');
  });

  it('rule 2 flags payments exceeding the approved amount', () => {
    const flags = runRule('ea_payment_exceeds_approved_amount', {
      decisions: [decision],
      payments: [{ ...payment, amountSek: 12500 }],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.amountAtRiskSek).toBe(2500);
  });

  it('rule 3 flags payments after decision validity', () => {
    const flags = runRule('ea_payment_after_decision_validity', {
      decisions: [decision],
      payments: [{ ...payment, paymentDate: '2026-08-01' }],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 4 flags duplicate payments per household and period', () => {
    const flags = runRule('ea_duplicate_payment_household_period', {
      payments: [payment, { ...payment, id: 'pay2' }],
    });
    expect(flags).toHaveLength(1);
  });
});

describe('EA rules 5-7: income and household integrity', () => {
  it('rule 5 flags income without period', () => {
    const flags = runRule('ea_income_without_period', {
      incomes: [
        { id: 'i1', kind: 'declared', personId: 'p1', amountSek: 5000, usedInDecision: true },
      ],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 6 flags income verified after decision', () => {
    const flags = runRule('ea_income_verified_after_decision', {
      decisions: [decision],
      incomes: [
        {
          id: 'i1',
          kind: 'verified',
          applicationId: 'a1',
          personId: 'p1',
          amountSek: 7000,
          usedInDecision: false,
          verifiedAt: '2026-06-15',
        },
      ],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 7 flags household members missing from calculation', () => {
    const flags = runRule('ea_household_member_missing_from_calculation', {
      decisions: [decision],
      households: [household],
      calculations: [
        {
          id: 'c1',
          applicationId: 'a1',
          decisionId: 'd1',
          includedPersonIds: ['p1'],
          usedDeclaredIncomeOnly: false,
          totalIncomeSek: 0,
        },
      ],
    });
    expect(flags).toHaveLength(1);
  });
});

describe('EA rules 8-9: documentation', () => {
  it('rule 8 flags housing cost without document', () => {
    const flags = runRule('ea_housing_cost_without_document', {
      housingRecords: [
        {
          id: 'hr1',
          householdId: 'h1',
          monthlyCostSek: 8000,
          hasContractDocument: false,
          hasCostDocumentLink: false,
        },
      ],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 9 flags applications missing required attachments', () => {
    const flags = runRule('ea_application_missing_required_attachment', {
      applications: [
        {
          id: 'a1',
          householdId: 'h1',
          requiredDocumentRoles: ['income_statement', 'rent_receipt'],
          attachedDocumentRoles: ['income_statement'],
        },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.explanation).toContain('rent_receipt');
  });
});

describe('EA rules 10-12: recovery claims and accounts', () => {
  it('rule 10 flags payments despite uncontrolled recovery claims', () => {
    const flags = runRule('ea_payment_despite_recovery_claim', {
      payments: [payment],
      recoveryClaims: [
        { id: 'c1', householdId: 'h1', status: 'open', controlPerformedForNewPayments: false },
      ],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 10 accepts payments when control was performed', () => {
    const flags = runRule('ea_payment_despite_recovery_claim', {
      payments: [payment],
      recoveryClaims: [
        { id: 'c1', householdId: 'h1', status: 'open', controlPerformedForNewPayments: true },
      ],
    });
    expect(flags).toHaveLength(0);
  });

  it('rule 11 flags accounts shared across households', () => {
    const flags = runRule('ea_account_shared_across_households', {
      households: [household, { ...household, id: 'h2' }],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.subjectId).toBe('KONTO-1');
  });

  it('rule 12 flags account changes near payment', () => {
    const flags = runRule('ea_account_changed_near_payment', {
      payments: [payment],
      households: [{ ...household, lastAccountChangeAt: '2026-06-20' }],
    });
    expect(flags).toHaveLength(1);
  });
});

describe('EA rules 13-15: decision state', () => {
  it('rule 13 flags payments based on superseded decisions', () => {
    const flags = runRule('ea_decision_changed_old_payment_details', {
      decisions: [{ ...decision, status: 'superseded' }],
      payments: [payment],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 14 flags payments linked to rejections', () => {
    const flags = runRule('ea_payment_despite_rejection', {
      decisions: [{ ...decision, decisionKind: 'rejection' }],
      payments: [payment],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.severity).toBe('critical');
  });

  it('rule 15 flags payments during reconsideration', () => {
    const flags = runRule('ea_payment_during_reconsideration', {
      decisions: [{ ...decision, status: 'under_reconsideration' }],
      payments: [payment],
    });
    expect(flags).toHaveLength(1);
  });
});

describe('EA rules 16-20: consistency', () => {
  it('rule 16 flags income not used in decision', () => {
    const flags = runRule('ea_income_not_used_in_decision', {
      incomes: [
        {
          id: 'i1',
          kind: 'declared',
          applicationId: 'a1',
          personId: 'p1',
          amountSek: 6000,
          usedInDecision: false,
        },
      ],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 17 flags households changed after decision', () => {
    const flags = runRule('ea_household_changed_after_decision', {
      decisions: [decision],
      households: [{ ...household, membersChangedAfterDecision: true }],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 18 flags housing cost without document link', () => {
    const flags = runRule('ea_housing_cost_without_document_link', {
      housingRecords: [
        {
          id: 'hr1',
          householdId: 'h1',
          monthlyCostSek: 8000,
          hasContractDocument: true,
          hasCostDocumentLink: false,
        },
      ],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 19 flags recipients outside the household', () => {
    const flags = runRule('ea_payment_recipient_outside_household', {
      households: [household],
      payments: [{ ...payment, recipientPersonId: 'p99' }],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 19 accepts verified landlords', () => {
    const flags = runRule('ea_payment_recipient_outside_household', {
      households: [household],
      payments: [{ ...payment, recipientPersonId: 'p99', recipientKind: 'landlord' }],
    });
    expect(flags).toHaveLength(0);
  });

  it('rule 20 flags period mismatches', () => {
    const flags = runRule('ea_application_decision_payment_period_mismatch', {
      decisions: [decision],
      payments: [{ ...payment, periodStart: '2026-07-01', periodEnd: '2026-07-31' }],
    });
    expect(flags).toHaveLength(1);
  });
});

describe('EA rules 21-25: files, recipients and access', () => {
  it('rule 21 flags payment file rows without approved decision', () => {
    const flags = runRule('ea_payment_file_row_without_decision', {
      decisions: [{ ...decision, decisionKind: 'rejection' }],
      paymentFileRows: [
        {
          id: 'row1',
          householdId: 'h1',
          amountSek: 5000,
          paymentDate: '2026-06-25',
          matchedDecisionId: 'd1',
        },
        { id: 'row2', householdId: 'h1', amountSek: 5000, paymentDate: '2026-06-25' },
      ],
    });
    expect(flags).toHaveLength(2);
  });

  it('rule 22 flags recipient changes between decision and payment', () => {
    const flags = runRule('ea_recipient_changed_after_decision', {
      decisions: [decision],
      payments: [{ ...payment, accountReference: 'KONTO-NY' }],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 23 flags calculations that ignored verified income', () => {
    const flags = runRule('ea_calculation_ignored_verified_income', {
      calculations: [
        {
          id: 'c1',
          applicationId: 'a1',
          includedPersonIds: ['p1'],
          usedDeclaredIncomeOnly: true,
          totalIncomeSek: 0,
        },
      ],
      incomes: [
        {
          id: 'i1',
          kind: 'verified',
          applicationId: 'a1',
          personId: 'p1',
          amountSek: 9000,
          usedInDecision: false,
        },
      ],
    });
    expect(flags).toHaveLength(1);
  });

  it('rule 24 flags protected households without elevated access', () => {
    const flags = runRule('ea_protected_household_without_elevated_access', {
      households: [
        { ...household, protectedIdentity: true, elevatedAccessProtection: false },
        { ...household, id: 'h2', protectedIdentity: true, elevatedAccessProtection: true },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.severity).toBe('critical');
  });

  it('rule 25 flags sensitive reveals without reason', () => {
    const flags = runRule('ea_sensitive_field_reveal_without_reason', {
      sensitiveReveals: [
        { entityId: 'e1', fieldKey: 'declared_income', actorUserId: 'u1', reasonRecorded: false },
        { entityId: 'e2', fieldKey: 'declared_income', actorUserId: 'u2', reasonRecorded: true },
      ],
    });
    expect(flags).toHaveLength(1);
  });
});

describe('EA rule catalogue', () => {
  it('contains all 25 rules with legal source references', () => {
    expect(ALL_EA_RULES).toHaveLength(25);
    expect(new Set(ALL_EA_RULES.map((r) => r.ruleKey)).size).toBe(25);
    for (const rule of ALL_EA_RULES) {
      expect(rule.domain).toBe('economic_assistance');
      expect(rule.legalSourceKey).toBe('sol_2001_453');
    }
  });

  it('produces no flags on a clean context', () => {
    const engine = new RuleEngine<EaRuleContext>();
    engine.registerAll(ALL_EA_RULES);
    const result = engine.run({
      ...emptyEaContext(),
      decisions: [decision],
      households: [household],
      payments: [payment],
    });
    expect(result.rulesEvaluated).toBe(25);
    expect(result.flags).toHaveLength(0);
  });
});
