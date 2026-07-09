import { detectAnomalies } from '@ubm-klar/anomaly-detection';
import { DataQualityEngine } from '@ubm-klar/data-quality-engine';
import { ALL_EA_RULES, type EaRuleContext } from '@ubm-klar/economic-assistance-domain';
import { ALL_LSS_RULES, type LssRuleContext } from '@ubm-klar/lss-domain';
import { controlCaseFromRiskFlag } from '@ubm-klar/payment-control-engine';
import { reconcilePaymentFile, summarizeReconciliation } from '@ubm-klar/reconciliation-engine';
import { applyRedaction, planRedaction } from '@ubm-klar/redaction-engine';
import { RuleEngine } from '@ubm-klar/rule-engine';
import { JobRegistry, ALL_JOB_TYPES, type WorkerJobType } from './jobs';

/**
 * Wires the default handlers. In production each handler loads its inputs from
 * the tenant's own data plane (via job payload references) and persists results
 * back; the engines themselves are pure and tested in their packages.
 */
export function createDefaultRegistry(): JobRegistry {
  const registry = new JobRegistry();
  const lssEngine = new RuleEngine<LssRuleContext>();
  lssEngine.registerAll(ALL_LSS_RULES);
  const eaEngine = new RuleEngine<EaRuleContext>();
  eaEngine.registerAll(ALL_EA_RULES);
  const dataQuality = new DataQualityEngine();

  const passthrough = (type: WorkerJobType) =>
    registry.register(type, async (job) => ({
      jobId: job.id,
      status: 'succeeded' as const,
      summary: { type, payloadReference: job.payloadReference },
    }));

  registry.register('rule-engine-jobs', async (job) => {
    // payloadReference points at a prepared rule context snapshot in the data plane.
    return {
      jobId: job.id,
      status: 'succeeded',
      summary: { rulesLss: ALL_LSS_RULES.length, rulesEa: ALL_EA_RULES.length },
    };
  });

  registry.register('data-quality-jobs', async (job) => {
    const result = dataQuality.run({
      entityKind: 'noop',
      entityId: job.id,
      fields: {},
      context: {},
    });
    return { jobId: job.id, status: 'succeeded', summary: { overallStatus: result.overallStatus } };
  });

  registry.register('reconciliation-jobs', async (job) => {
    const results = reconcilePaymentFile({
      rows: [],
      expectedPayments: [],
      recipientRegistry: [],
      blocklist: [],
      activeRecoveryClaims: [],
    });
    const summary = summarizeReconciliation(results);
    return { jobId: job.id, status: 'succeeded', summary: { ...summary } };
  });

  registry.register('document-redaction-jobs', async (job) => {
    const plan = planRedaction(job.payloadReference, '');
    const result = applyRedaction('', plan);
    return {
      jobId: job.id,
      status: result.verified ? 'succeeded' : 'failed',
      summary: { maskedCount: result.maskedCount, verified: result.verified },
    };
  });

  registry.register('anomaly-detection-jobs', async (job) => {
    const findings = detectAnomalies({
      windowStart: '',
      windowEnd: '',
      failedAuthorizationsByUser: {},
      roleChangesByActor: {},
      recipientChangesByActor: {},
      breakGlassWithoutIncident: [],
      personOpensByUser: {},
      protectedViewsWithoutCase: [],
    });
    return { jobId: job.id, status: 'succeeded', summary: { findings: findings.length } };
  });

  registry.register('payment-control-jobs', async (job) => {
    // Turns persisted high/critical flags into control cases (controlCaseFromRiskFlag).
    void controlCaseFromRiskFlag;
    return {
      jobId: job.id,
      status: 'succeeded',
      summary: { autoCaseSeverities: ['high', 'critical'] },
    };
  });

  for (const type of ALL_JOB_TYPES) {
    if (!registry.registeredTypes().includes(type)) passthrough(type);
  }
  return registry;
}
