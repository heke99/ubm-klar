import type { RegistryStatus, RiskSeverity } from '@ubm-klar/shared-types';

/**
 * Generic risk rule engine. Domain packages (LSS, economic assistance, payment
 * control) register versioned rules; the engine evaluates them against a
 * context, producing explainable risk flags with recommended actions and
 * evidence references. Supports dry-run (flags marked, nothing persisted).
 */
export interface RiskRuleDefinition<TContext> {
  ruleKey: string;
  version: string;
  status: RegistryStatus;
  domain: 'lss' | 'economic_assistance' | 'payment_control' | 'common';
  title: string;
  description: string;
  severity: RiskSeverity;
  recommendedAction: string;
  legalSourceKey?: string;
  legalSourceVersion?: string;
  /** Returns flags found in the context (empty array = no findings). */
  evaluate: (context: TContext) => RiskFinding[];
}

export interface RiskFinding {
  /** Stable identity of the flagged subject, e.g. payment id or invoice id. */
  subjectKind: string;
  subjectId: string;
  explanation: string;
  /** References to the records that prove the finding (evidence chain input). */
  evidenceReferences: string[];
  /** Optional numeric amount at risk (SEK). */
  amountAtRiskSek?: number;
  personId?: string;
  severityOverride?: RiskSeverity;
}

export interface RiskFlag extends RiskFinding {
  ruleKey: string;
  ruleVersion: string;
  severity: RiskSeverity;
  domain: string;
  title: string;
  recommendedAction: string;
  legalSourceKey?: string;
  legalSourceVersion?: string;
  dryRun: boolean;
  flaggedAt: string;
}

export interface RuleRunResult {
  flags: RiskFlag[];
  rulesEvaluated: number;
  rulesSkipped: Array<{ ruleKey: string; reason: string }>;
  dryRun: boolean;
}

export interface RuleEngineOptions {
  /** Only rules with these statuses run (default: pilot + active). */
  allowedStatuses?: RegistryStatus[];
  dryRun?: boolean;
  clock?: () => Date;
}

export class RuleEngine<TContext> {
  private rules = new Map<string, RiskRuleDefinition<TContext>>();

  register(rule: RiskRuleDefinition<TContext>): void {
    const key = `${rule.ruleKey}@${rule.version}`;
    if (this.rules.has(key)) {
      throw new Error(`Rule already registered: ${key}`);
    }
    this.rules.set(key, rule);
  }

  registerAll(rules: RiskRuleDefinition<TContext>[]): void {
    for (const rule of rules) this.register(rule);
  }

  /** Latest registered version per ruleKey with an allowed status. */
  activeRules(allowedStatuses: RegistryStatus[]): RiskRuleDefinition<TContext>[] {
    const byKey = new Map<string, RiskRuleDefinition<TContext>>();
    for (const rule of this.rules.values()) {
      if (!allowedStatuses.includes(rule.status)) continue;
      const existing = byKey.get(rule.ruleKey);
      if (!existing || compareVersions(rule.version, existing.version) > 0) {
        byKey.set(rule.ruleKey, rule);
      }
    }
    return [...byKey.values()];
  }

  run(context: TContext, options: RuleEngineOptions = {}): RuleRunResult {
    const allowedStatuses = options.allowedStatuses ?? ['pilot', 'active'];
    const dryRun = options.dryRun ?? false;
    const clock = options.clock ?? (() => new Date());
    const flags: RiskFlag[] = [];
    const rulesSkipped: Array<{ ruleKey: string; reason: string }> = [];

    const seenKeys = new Set([...this.rules.values()].map((r) => r.ruleKey));
    const active = this.activeRules(allowedStatuses);
    const activeKeys = new Set(active.map((r) => r.ruleKey));
    for (const key of seenKeys) {
      if (!activeKeys.has(key)) {
        rulesSkipped.push({ ruleKey: key, reason: 'no version with allowed status' });
      }
    }

    for (const rule of active) {
      const findings = rule.evaluate(context);
      for (const finding of findings) {
        flags.push({
          ...finding,
          ruleKey: rule.ruleKey,
          ruleVersion: rule.version,
          severity: finding.severityOverride ?? rule.severity,
          domain: rule.domain,
          title: rule.title,
          recommendedAction: rule.recommendedAction,
          ...(rule.legalSourceKey !== undefined ? { legalSourceKey: rule.legalSourceKey } : {}),
          ...(rule.legalSourceVersion !== undefined
            ? { legalSourceVersion: rule.legalSourceVersion }
            : {}),
          dryRun,
          flaggedAt: clock().toISOString(),
        });
      }
    }

    return { flags, rulesEvaluated: active.length, rulesSkipped, dryRun };
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
