import { describe, expect, it } from 'vitest';
import { PiiLeakError } from '@ubm-klar/config';
import {
  checkEntitlement,
  createBillingEvent,
  createUsageMetric,
  enabledModules,
  PLAN_CATALOG,
  resolveEntitlements,
  type Subscription,
} from './billing';

const activeLss: Subscription = {
  planKey: 'ubm_klar_lss',
  status: 'active',
  startsAt: '2026-01-01',
};

describe('plan catalogue', () => {
  it('defines all five packages', () => {
    expect(PLAN_CATALOG.map((p) => p.planKey)).toEqual([
      'ubm_klar_start',
      'ubm_klar_lss',
      'ubm_klar_eb',
      'ubm_klar_kontroll',
      'ubm_klar_enterprise',
    ]);
  });
});

describe('entitlements and feature gating', () => {
  it('resolves entitlements from active subscriptions', () => {
    const entitlements = resolveEntitlements([activeLss], '2026-07-07');
    expect(entitlements.has('lss_payment_control')).toBe(true);
    expect(entitlements.has('module:lss')).toBe(true);
    expect(entitlements.has('exit_export')).toBe(false);
  });

  it('ignores cancelled or expired subscriptions', () => {
    expect(resolveEntitlements([{ ...activeLss, status: 'cancelled' }], '2026-07-07').size).toBe(0);
    expect(resolveEntitlements([{ ...activeLss, endsAt: '2026-06-30' }], '2026-07-07').size).toBe(
      0,
    );
  });

  it('gates features with explanations', () => {
    const denied = checkEntitlement([activeLss], 'exit_export', '2026-07-07');
    expect(denied.entitled).toBe(false);
    expect(denied.reason).toContain('exit_export');
    const allowed = checkEntitlement(
      [{ planKey: 'ubm_klar_enterprise', status: 'active', startsAt: '2026-01-01' }],
      'exit_export',
      '2026-07-07',
    );
    expect(allowed.entitled).toBe(true);
  });

  it('maps subscriptions to enabled modules', () => {
    const modules = enabledModules([activeLss], '2026-07-07');
    expect(modules).toContain('lss');
    expect(modules).toContain('payment_control');
    expect(modules).not.toContain('economic_assistance');
  });
});

describe('no citizen data in billing', () => {
  it('accepts clean billing events and metrics', () => {
    expect(
      createBillingEvent({
        eventType: 'onboarding_fee',
        amountSek: 50000,
        reference: 'ORDER-1001',
        occurredAt: '2026-07-07T10:00:00Z',
      }).amountSek,
    ).toBe(50000);
    expect(
      createUsageMetric({
        metricKey: 'ubm_requests_handled',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        value: 14,
      }).value,
    ).toBe(14);
  });

  it('rejects billing events containing personal identity numbers', () => {
    expect(() =>
      createBillingEvent({
        eventType: 'usage_report',
        reference: 'gällande 19811218-9876',
        occurredAt: '2026-07-07T10:00:00Z',
      }),
    ).toThrow(PiiLeakError);
  });
});
