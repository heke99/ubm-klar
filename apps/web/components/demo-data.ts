import {
  ALL_LSS_RULES,
  buildLssDashboard,
  generateLssDemoData,
  type LssRuleContext,
} from '@ubm-klar/lss-domain';
import {
  ALL_EA_RULES,
  buildEaDashboard,
  generateEaDemoData,
  type EaRuleContext,
} from '@ubm-klar/economic-assistance-domain';
import { RuleEngine, type RiskFlag } from '@ubm-klar/rule-engine';
import {
  computeReadinessScores,
  isGoLiveReady,
  ONBOARDING_STEPS,
  type StepStatus,
} from '@ubm-klar/onboarding-engine';

/**
 * Demo/test data provider for local rendering. Synthetic data only; production
 * deployments fetch the same shapes from the backend API against the
 * municipality's own data plane.
 */
const lssDemo = generateLssDemoData({
  personCount: 200,
  decisionCount: 400,
  providerCount: 40,
  timeReportCount: 800,
  invoiceCount: 600,
  paymentCount: 1200,
  recoveryClaimCount: 12,
  ubmRequestCount: 6,
});
const eaDemo = generateEaDemoData({
  personCount: 300,
  householdCount: 180,
  applicationCount: 500,
  decisionCount: 500,
  incomeCount: 700,
  housingCount: 250,
  paymentCount: 650,
  recoveryClaimCount: 25,
});

const lssEngine = new RuleEngine<LssRuleContext>();
lssEngine.registerAll(ALL_LSS_RULES);
const eaEngine = new RuleEngine<EaRuleContext>();
eaEngine.registerAll(ALL_EA_RULES);

const lssFlags: RiskFlag[] = lssEngine.run(lssDemo.context).flags;
const eaFlags: RiskFlag[] = eaEngine.run(eaDemo.context).flags;

export const demo = {
  lss: {
    context: lssDemo.context,
    flags: lssFlags,
    dashboard: buildLssDashboard(lssDemo.context, lssFlags),
    ubmRequestIds: lssDemo.ubmRequestIds,
  },
  ea: {
    context: eaDemo.context,
    flags: eaFlags,
    dashboard: buildEaDashboard(eaDemo.context, eaFlags),
  },
  allFlags: [...lssFlags, ...eaFlags],
};

const demoProgress: Record<string, StepStatus> = Object.fromEntries(
  ONBOARDING_STEPS.map((step, index) => [
    step.stepKey,
    index % 9 === 7 ? 'in_progress' : index % 13 === 11 ? 'not_started' : 'completed',
  ]),
);

export const readinessScores = computeReadinessScores(demoProgress);
export const goLive = isGoLiveReady(readinessScores);

export function formatSek(amount: number): string {
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  }).format(amount);
}
