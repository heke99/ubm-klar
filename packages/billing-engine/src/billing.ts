import { assertNoPii } from '@ubm-klar/config';
import type { ModuleId } from '@ubm-klar/shared-types';

/** Commercial plans. Billing never touches citizen data. */
export type PlanKey =
  'ubm_klar_start' | 'ubm_klar_lss' | 'ubm_klar_eb' | 'ubm_klar_kontroll' | 'ubm_klar_enterprise';

export interface PlanDefinition {
  planKey: PlanKey;
  nameSv: string;
  includedModules: ModuleId[];
  entitlements: string[];
}

export const PLAN_CATALOG: PlanDefinition[] = [
  {
    planKey: 'ubm_klar_start',
    nameSv: 'UBM Klar Start',
    includedModules: [
      'platform_foundation',
      'municipal_data_plane',
      'ubm_readiness',
      'import_gateway',
      'data_quality',
    ],
    entitlements: [
      'readiness_assessment',
      'import_templates',
      'manual_ubm_requests',
      'basic_dashboards',
    ],
  },
  {
    planKey: 'ubm_klar_lss',
    nameSv: 'UBM Klar LSS',
    includedModules: ['lss', 'payment_control', 'document_vault', 'control_cases'],
    entitlements: [
      'lss_data_model',
      'lss_payment_control',
      'provider_checks',
      'lss_ubm_export_proposals',
    ],
  },
  {
    planKey: 'ubm_klar_eb',
    nameSv: 'UBM Klar Ekonomiskt Bistånd',
    includedModules: ['economic_assistance', 'payment_control', 'document_vault', 'control_cases'],
    entitlements: ['ea_data_model', 'income_housing_controls', 'ea_ubm_export_proposals'],
  },
  {
    planKey: 'ubm_klar_kontroll',
    nameSv: 'UBM Klar Kontroll',
    includedModules: ['payment_control', 'control_cases', 'import_gateway'],
    entitlements: [
      'payment_file_import',
      'reconciliation',
      'risk_rules',
      'control_cases',
      'recovery_claim_tracking',
    ],
  },
  {
    planKey: 'ubm_klar_enterprise',
    nameSv: 'UBM Klar Enterprise',
    includedModules: [
      'platform_foundation',
      'municipal_data_plane',
      'ubm_readiness',
      'payment_control',
      'lss',
      'economic_assistance',
      'import_gateway',
      'document_vault',
      'data_quality',
      'control_cases',
      'compliance_legal',
      'cybersecurity',
      'archive',
      'accessibility',
    ],
    entitlements: [
      'model_b_isolated_data_plane',
      'model_c_support',
      'sso',
      'siem',
      'support_jit',
      'production_readiness_gates',
      'exit_export',
      'archive_e_archive',
    ],
  },
];

export interface Subscription {
  planKey: PlanKey;
  status: 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired';
  startsAt: string;
  endsAt?: string;
}

export interface EntitlementCheck {
  entitled: boolean;
  reason: string;
}

/** Feature gating: modules/entitlements only from active or trial subscriptions. */
export function resolveEntitlements(subscriptions: Subscription[], atDate: string): Set<string> {
  const entitlements = new Set<string>();
  for (const subscription of subscriptions) {
    if (!['active', 'trial'].includes(subscription.status)) continue;
    if (subscription.startsAt > atDate) continue;
    if (subscription.endsAt && subscription.endsAt < atDate) continue;
    const plan = PLAN_CATALOG.find((p) => p.planKey === subscription.planKey);
    if (!plan) continue;
    for (const entitlement of plan.entitlements) entitlements.add(entitlement);
    for (const moduleId of plan.includedModules) entitlements.add(`module:${moduleId}`);
  }
  return entitlements;
}

export function checkEntitlement(
  subscriptions: Subscription[],
  entitlementKey: string,
  atDate: string,
): EntitlementCheck {
  const entitlements = resolveEntitlements(subscriptions, atDate);
  if (entitlements.has(entitlementKey)) {
    return { entitled: true, reason: 'Included in an active subscription' };
  }
  return {
    entitled: false,
    reason: `No active subscription includes "${entitlementKey}". Contact your account manager.`,
  };
}

export function enabledModules(subscriptions: Subscription[], atDate: string): ModuleId[] {
  const entitlements = resolveEntitlements(subscriptions, atDate);
  return [...entitlements]
    .filter((e) => e.startsWith('module:'))
    .map((e) => e.slice('module:'.length) as ModuleId);
}

export interface BillingEvent {
  eventType:
    | 'subscription_started'
    | 'subscription_renewed'
    | 'subscription_cancelled'
    | 'onboarding_fee'
    | 'enterprise_single_tenant_fee'
    | 'municipality_data_plane_fee'
    | 'support_package_fee'
    | 'implementation_package_fee'
    | 'readiness_assessment_fee'
    | 'usage_report';
  amountSek?: number;
  reference?: string;
  occurredAt: string;
}

/** Billing events must never contain citizen data; enforced at construction. */
export function createBillingEvent(event: BillingEvent): BillingEvent {
  return assertNoPii(event, 'billing.event');
}

export interface UsageMetric {
  metricKey:
    | 'active_users'
    | 'import_batches'
    | 'ubm_requests_handled'
    | 'exports_generated'
    | 'payment_file_rows_reconciled'
    | 'storage_gb';
  periodStart: string;
  periodEnd: string;
  /** Aggregate count only — never row-level municipal data. */
  value: number;
}

export function createUsageMetric(metric: UsageMetric): UsageMetric {
  return assertNoPii(metric, 'billing.usage_metric');
}
