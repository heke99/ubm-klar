import { describe, expect, it } from 'vitest';
import { RuleEngine, type RiskRuleDefinition } from './rule-engine';

interface TestContext {
  payments: Array<{ id: string; amount: number; hasDecision: boolean }>;
}

function rule(overrides: Partial<RiskRuleDefinition<TestContext>> = {}): RiskRuleDefinition<TestContext> {
  return {
    ruleKey: 'payment_without_decision',
    version: '1.0.0',
    status: 'active',
    domain: 'payment_control',
    title: 'Utbetalning utan beslut',
    description: 'Utbetalning saknar koppling till beslut',
    severity: 'high',
    recommendedAction: 'Stoppa utbetalningen och utred beslutskopplingen.',
    evaluate: (ctx) =>
      ctx.payments
        .filter((p) => !p.hasDecision)
        .map((p) => ({
          subjectKind: 'payment',
          subjectId: p.id,
          explanation: `Utbetalning ${p.id} saknar beslut.`,
          evidenceReferences: [`payment:${p.id}`],
          amountAtRiskSek: p.amount,
        })),
    ...overrides,
  };
}

const context: TestContext = {
  payments: [
    { id: 'p1', amount: 1000, hasDecision: true },
    { id: 'p2', amount: 2500, hasDecision: false },
  ],
};

describe('RuleEngine', () => {
  it('produces explainable flags with rule version metadata', () => {
    const engine = new RuleEngine<TestContext>();
    engine.register(rule());
    const result = engine.run(context);
    expect(result.flags).toHaveLength(1);
    const flag = result.flags[0]!;
    expect(flag.ruleKey).toBe('payment_without_decision');
    expect(flag.ruleVersion).toBe('1.0.0');
    expect(flag.severity).toBe('high');
    expect(flag.explanation).toContain('p2');
    expect(flag.evidenceReferences).toContain('payment:p2');
  });

  it('skips draft rules and reports why', () => {
    const engine = new RuleEngine<TestContext>();
    engine.register(rule({ status: 'draft' }));
    const result = engine.run(context);
    expect(result.flags).toHaveLength(0);
    expect(result.rulesSkipped[0]).toMatchObject({
      ruleKey: 'payment_without_decision',
      reason: 'no version with allowed status',
    });
  });

  it('uses the latest allowed version of each rule', () => {
    const engine = new RuleEngine<TestContext>();
    engine.register(rule({ version: '1.0.0' }));
    engine.register(
      rule({
        version: '1.1.0',
        severity: 'critical',
      }),
    );
    const result = engine.run(context);
    expect(result.flags[0]!.ruleVersion).toBe('1.1.0');
    expect(result.flags[0]!.severity).toBe('critical');
  });

  it('rejects duplicate rule versions', () => {
    const engine = new RuleEngine<TestContext>();
    engine.register(rule());
    expect(() => engine.register(rule())).toThrow('already registered');
  });

  it('supports dry-run mode', () => {
    const engine = new RuleEngine<TestContext>();
    engine.register(rule());
    const result = engine.run(context, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.flags[0]!.dryRun).toBe(true);
  });

  it('honours severity overrides from findings', () => {
    const engine = new RuleEngine<TestContext>();
    engine.register(
      rule({
        evaluate: () => [
          {
            subjectKind: 'payment',
            subjectId: 'p9',
            explanation: 'extra allvarlig',
            evidenceReferences: [],
            severityOverride: 'critical',
          },
        ],
      }),
    );
    const result = engine.run(context);
    expect(result.flags[0]!.severity).toBe('critical');
  });
});
