import { describe, expect, it } from 'vitest';
import { RuleEngine } from '@ubm-klar/rule-engine';
import { ALL_LSS_RULES } from './rules';
import { emptyLssContext, type LssRuleContext } from './types';

function runRule(ruleKey: string, ctx: Partial<LssRuleContext>) {
  const engine = new RuleEngine<LssRuleContext>();
  engine.registerAll(ALL_LSS_RULES.filter((r) => r.ruleKey === ruleKey));
  return engine.run({ ...emptyLssContext(), ...ctx }).flags;
}

const decision = {
  id: 'd1',
  personId: 'p1',
  status: 'active' as const,
  periodStart: '2026-01-01',
  periodEnd: '2026-06-30',
  hoursPerWeek: 40,
};

const provider = {
  id: 'prov1',
  organizationId: 'org1',
  orgNumber: '556600-1234',
  status: 'active' as const,
  contractedOrgNumbers: ['556600-1234'],
  ivoPermits: [{ status: 'active' as const, validFrom: '2024-01-01' }],
  contracts: [{ status: 'active' as const, validFrom: '2024-01-01' }],
  approvedAccountReferences: ['BG-5050-1055'],
  riskFlags: [],
};

const invoice = {
  id: 'inv1',
  providerId: 'prov1',
  invoiceOrgNumber: '556600-1234',
  personId: 'p1',
  decisionId: 'd1',
  periodStart: '2026-02-01',
  periodEnd: '2026-02-28',
  totalHours: 160,
  totalAmountSek: 51200,
  status: 'approved' as const,
};

const timeReport = {
  id: 'tr1',
  personId: 'p1',
  providerId: 'prov1',
  decisionId: 'd1',
  periodStart: '2026-02-01',
  periodEnd: '2026-02-28',
  totalHours: 160,
  approved: true,
  rows: [{ assistantId: 'a1', workDate: '2026-02-03', startHour: 8, endHour: 16, hours: 8 }],
};

const payment = {
  id: 'pay1',
  personId: 'p1',
  providerId: 'prov1',
  invoiceId: 'inv1',
  decisionId: 'd1',
  amountSek: 51200,
  paymentDate: '2026-03-05',
  status: 'paid',
  recipientOrganizationId: 'org1',
  recipientAccountReference: 'BG-5050-1055',
};

describe('LSS rules 1-2: payment outside decision period', () => {
  it('flags payment after decision end', () => {
    const flags = runRule('lss_payment_after_decision_end', {
      decisions: [decision],
      payments: [{ ...payment, paymentDate: '2026-08-01' }],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.explanation).toContain('efter beslutets slutdatum');
  });

  it('flags payment before decision start', () => {
    const flags = runRule('lss_payment_before_decision_start', {
      decisions: [decision],
      payments: [{ ...payment, paymentDate: '2025-12-15' }],
    });
    expect(flags).toHaveLength(1);
  });

  it('does not flag payments inside the period', () => {
    expect(
      runRule('lss_payment_after_decision_end', { decisions: [decision], payments: [payment] }),
    ).toHaveLength(0);
    expect(
      runRule('lss_payment_before_decision_start', { decisions: [decision], payments: [payment] }),
    ).toHaveLength(0);
  });
});

describe('LSS rule 3: billed hours exceed decision', () => {
  it('flags invoices exceeding decided hours', () => {
    const flags = runRule('lss_billed_hours_exceed_decision', {
      decisions: [decision],
      invoices: [{ ...invoice, totalHours: 400 }],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.amountAtRiskSek).toBe(51200);
  });
  it('accepts invoices within decided hours', () => {
    expect(
      runRule('lss_billed_hours_exceed_decision', {
        decisions: [decision],
        invoices: [invoice],
      }),
    ).toHaveLength(0);
  });
});

describe('LSS rule 4: time report missing', () => {
  it('flags invoiced period without time report', () => {
    const flags = runRule('lss_time_report_missing_for_invoice', { invoices: [invoice] });
    expect(flags).toHaveLength(1);
  });
  it('accepts invoices covered by reports', () => {
    expect(
      runRule('lss_time_report_missing_for_invoice', {
        invoices: [invoice],
        timeReports: [timeReport],
      }),
    ).toHaveLength(0);
  });
});

describe('LSS rules 5-7: provider checks', () => {
  it('flags invoices from unknown or inactive providers', () => {
    expect(runRule('lss_invoice_without_approved_provider', { invoices: [invoice] })).toHaveLength(
      1,
    );
    expect(
      runRule('lss_invoice_without_approved_provider', {
        invoices: [invoice],
        providers: [{ ...provider, status: 'suspended' }],
      }),
    ).toHaveLength(1);
    expect(
      runRule('lss_invoice_without_approved_provider', {
        invoices: [invoice],
        providers: [provider],
      }),
    ).toHaveLength(0);
  });

  it('flags invoicing providers without active IVO permit', () => {
    const flags = runRule('lss_provider_without_ivo_permit', {
      invoices: [invoice],
      providers: [{ ...provider, ivoPermits: [{ status: 'revoked', validFrom: '2024-01-01' }] }],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.severity).toBe('critical');
  });

  it('flags invoice org number mismatch', () => {
    const flags = runRule('lss_invoice_org_number_mismatch', {
      invoices: [{ ...invoice, invoiceOrgNumber: '559999-0000' }],
      providers: [provider],
    });
    expect(flags).toHaveLength(1);
  });
});

describe('LSS rules 8-9: assistant time anomalies', () => {
  it('flags overlapping shifts for the same assistant', () => {
    const flags = runRule('lss_assistant_overlapping_time', {
      timeReports: [
        {
          ...timeReport,
          id: 'tr1',
          rows: [
            { assistantId: 'a1', workDate: '2026-02-03', startHour: 8, endHour: 16, hours: 8 },
          ],
        },
        {
          ...timeReport,
          id: 'tr2',
          personId: 'p2',
          rows: [
            { assistantId: 'a1', workDate: '2026-02-03', startHour: 14, endHour: 22, hours: 8 },
          ],
        },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.subjectId).toBe('a1');
  });

  it('flags unreasonable daily hours', () => {
    const flags = runRule('lss_assistant_unreasonable_hours', {
      timeReports: [
        {
          ...timeReport,
          rows: [
            { assistantId: 'a1', workDate: '2026-02-03', startHour: 0, endHour: 12, hours: 12 },
            { assistantId: 'a1', workDate: '2026-02-03', startHour: 12, endHour: 23, hours: 11 },
          ],
        },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.explanation).toContain('23');
  });
});

describe('LSS rules 10-11: duplicates', () => {
  it('flags duplicate invoices for same person and period', () => {
    const flags = runRule('lss_duplicate_invoice', {
      invoices: [invoice, { ...invoice, id: 'inv2' }],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.evidenceReferences).toContain('provider_invoice:inv1');
  });

  it('flags duplicate payments', () => {
    const flags = runRule('lss_duplicate_payment', {
      payments: [payment, { ...payment, id: 'pay2' }],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.severity).toBe('critical');
  });
});

describe('LSS rules 12-13: recovery claims and account changes', () => {
  it('flags payments despite active recovery claim', () => {
    const flags = runRule('lss_payment_despite_recovery_claim', {
      payments: [payment],
      recoveryClaims: [{ id: 'c1', personId: 'p1', status: 'open' }],
    });
    expect(flags).toHaveLength(1);
  });

  it('flags account changes near payment date', () => {
    const flags = runRule('lss_account_changed_near_payment', {
      payments: [payment],
      providers: [{ ...provider, lastAccountChangeAt: '2026-03-01' }],
    });
    expect(flags).toHaveLength(1);
  });

  it('ignores old account changes', () => {
    expect(
      runRule('lss_account_changed_near_payment', {
        payments: [payment],
        providers: [{ ...provider, lastAccountChangeAt: '2025-01-01' }],
      }),
    ).toHaveLength(0);
  });
});

describe('LSS rules 14-15: protection and classification', () => {
  it('flags protected identity without elevated protection', () => {
    const flags = runRule('lss_protected_identity_without_elevated_protection', {
      protectedPersons: [
        { personId: 'p1', protectedIdentity: true, hasElevatedAccessProtection: false },
        { personId: 'p2', protectedIdentity: true, hasElevatedAccessProtection: true },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.personId).toBe('p1');
  });

  it('flags misclassified medical documents', () => {
    const flags = runRule('lss_medical_document_misclassified', {
      documents: [
        { id: 'doc1', documentType: 'medical_certificate', documentClass: 'standard' },
        { id: 'doc2', documentType: 'medical_certificate', documentClass: 'medical' },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.subjectId).toBe('doc1');
  });
});

describe('LSS rules 16-18: invoice/payment linkage', () => {
  it('flags invoices without decision link', () => {
    const { decisionId: _omit, ...withoutDecision } = invoice;
    const flags = runRule('lss_invoice_without_decision_link', {
      invoices: [withoutDecision as typeof invoice],
    });
    expect(flags).toHaveLength(1);
  });

  it('flags payment recipient differing from contracted provider', () => {
    const flags = runRule('lss_payment_recipient_differs_from_provider', {
      payments: [{ ...payment, recipientAccountReference: 'BG-6666-6666' }],
      providers: [provider],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.severity).toBe('critical');
  });

  it('flags invoicing after decision ended', () => {
    const flags = runRule('lss_ended_decision_still_invoiced', {
      decisions: [{ ...decision, status: 'terminated' }],
      invoices: [invoice],
    });
    expect(flags).toHaveLength(1);
  });
});

describe('LSS rules 19-20: time report quality', () => {
  it('flags unapproved time reports', () => {
    const flags = runRule('lss_time_report_without_approval', {
      timeReports: [{ ...timeReport, approved: false }],
    });
    expect(flags).toHaveLength(1);
  });

  it('flags unusual hour increases (>50%)', () => {
    const flags = runRule('lss_unusual_hours_increase', {
      timeReports: [
        {
          ...timeReport,
          id: 'tr1',
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          totalHours: 100,
        },
        {
          ...timeReport,
          id: 'tr2',
          periodStart: '2026-02-01',
          periodEnd: '2026-02-28',
          totalHours: 180,
        },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.subjectId).toBe('tr2');
  });
});

describe('LSS rules 21-23: payment files and batches', () => {
  it('flags payment file rows with unknown recipients', () => {
    const flags = runRule('lss_payment_file_unknown_recipient', {
      providers: [provider],
      paymentFileRows: [
        {
          id: 'row1',
          recipientOrgNumber: '559999-9999',
          amountSek: 10000,
          paymentDate: '2026-03-01',
        },
        {
          id: 'row2',
          recipientOrgNumber: '556600-1234',
          amountSek: 5000,
          paymentDate: '2026-03-01',
        },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.subjectId).toBe('row1');
  });

  it('flags paid payments without approved invoice', () => {
    const flags = runRule('lss_paid_without_approved_invoice', {
      invoices: [{ ...invoice, status: 'received' }],
      payments: [payment],
    });
    expect(flags).toHaveLength(1);
  });

  it('flags batches containing recipients with active recovery claims', () => {
    const flags = runRule('lss_recovery_claim_recipient_in_batch', {
      recoveryClaims: [{ id: 'c1', providerId: 'prov1', status: 'open' }],
      paymentBatches: [
        {
          id: 'batch1',
          status: 'created',
          recipientProviderIds: ['prov1'],
          recipientPersonIds: [],
        },
      ],
    });
    expect(flags).toHaveLength(1);
  });
});

describe('LSS rules 24-25: reviews and access', () => {
  it('flags provider risk flags without manual review', () => {
    const flags = runRule('lss_provider_flag_without_review', {
      providers: [
        { ...provider, riskFlags: [{ flagKind: 'media_report', manuallyReviewed: false }] },
      ],
    });
    expect(flags).toHaveLength(1);
  });

  it('flags sensitive document access without reason', () => {
    const flags = runRule('lss_sensitive_document_access_without_reason', {
      documentAccessEvents: [
        { documentId: 'doc1', documentClass: 'medical', actorUserId: 'u1', reasonRecorded: false },
        { documentId: 'doc2', documentClass: 'medical', actorUserId: 'u2', reasonRecorded: true },
        { documentId: 'doc3', documentClass: 'standard', actorUserId: 'u3', reasonRecorded: false },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.subjectId).toBe('doc1');
  });
});

describe('rule catalogue', () => {
  it('contains all 25 LSS rules with legal source versions', () => {
    expect(ALL_LSS_RULES).toHaveLength(25);
    for (const rule of ALL_LSS_RULES) {
      expect(rule.domain).toBe('lss');
      expect(rule.legalSourceKey).toBeDefined();
      expect(rule.legalSourceVersion).toBeDefined();
    }
    expect(new Set(ALL_LSS_RULES.map((r) => r.ruleKey)).size).toBe(25);
  });

  it('runs the full catalogue on a clean context without flags', () => {
    const engine = new RuleEngine<LssRuleContext>();
    engine.registerAll(ALL_LSS_RULES);
    const result = engine.run({
      ...emptyLssContext(),
      decisions: [decision],
      providers: [provider],
      invoices: [invoice],
      timeReports: [timeReport],
      payments: [payment],
    });
    expect(result.rulesEvaluated).toBe(25);
    expect(result.flags).toHaveLength(0);
  });
});
