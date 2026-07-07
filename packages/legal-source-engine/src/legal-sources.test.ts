import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UBM_PHASES,
  isPhaseActive,
  resolveLegalSourceVersion,
  type LegalSourceVersion,
} from './legal-sources';

const versions: LegalSourceVersion[] = [
  { sourceKey: 'lag_2023_456', version: '2026-07-01', status: 'active', effectiveFrom: '2026-07-01' },
  {
    sourceKey: 'lag_2023_456',
    version: '2029-07-01',
    status: 'awaiting_official_specification',
    effectiveFrom: '2029-07-01',
  },
  { sourceKey: 'lss', version: '1', status: 'active', effectiveFrom: '2020-01-01', effectiveTo: '2025-12-31' },
  { sourceKey: 'lss', version: '2', status: 'active', effectiveFrom: '2026-01-01' },
];

describe('resolveLegalSourceVersion', () => {
  it('resolves the active version at a date', () => {
    const result = resolveLegalSourceVersion(versions, 'lag_2023_456', '2026-08-01');
    expect(result.resolved?.version).toBe('2026-07-01');
    expect(result.requiresManualReview).toBe(false);
  });

  it('prefers the latest effective version', () => {
    const result = resolveLegalSourceVersion(versions, 'lss', '2026-08-01');
    expect(result.resolved?.version).toBe('2');
  });

  it('respects effectiveTo windows', () => {
    const result = resolveLegalSourceVersion(versions, 'lss', '2024-01-01');
    expect(result.resolved?.version).toBe('1');
  });

  it('requires manual review when nothing is effective', () => {
    const result = resolveLegalSourceVersion(versions, 'lag_2023_456', '2025-01-01');
    expect(result.requiresManualReview).toBe(true);
  });

  it('requires manual review for awaiting_official_specification statuses', () => {
    const result = resolveLegalSourceVersion(
      versions.filter((v) => v.version === '2029-07-01'),
      'lag_2023_456',
      '2029-08-01',
    );
    expect(result.requiresManualReview).toBe(true);
    expect(result.reason).toContain('awaiting_official_specification');
  });
});

describe('isPhaseActive', () => {
  it('phase 1 is active from 2026-07-01', () => {
    const result = isPhaseActive(
      { phases: DEFAULT_UBM_PHASES, featureFlags: {}, atDate: '2026-07-15' },
      'phase_1_request_based_2026',
    );
    expect(result.active).toBe(true);
  });

  it('phase 1 is inactive before its effective date', () => {
    const result = isPhaseActive(
      { phases: DEFAULT_UBM_PHASES, featureFlags: {}, atDate: '2026-01-01' },
      'phase_1_request_based_2026',
    );
    expect(result.active).toBe(false);
  });

  it('phase 2 stays off without the feature flag even after 2029', () => {
    const enabledPhases = DEFAULT_UBM_PHASES.map((p) =>
      p.phaseKey === 'phase_2_recurring_2029' ? { ...p, enabled: true } : p,
    );
    const withoutFlag = isPhaseActive(
      { phases: enabledPhases, featureFlags: {}, atDate: '2029-08-01' },
      'phase_2_recurring_2029',
    );
    expect(withoutFlag.active).toBe(false);
    expect(withoutFlag.reason).toContain('ubm_recurring_reporting_2029');

    const withFlag = isPhaseActive(
      {
        phases: enabledPhases,
        featureFlags: { ubm_recurring_reporting_2029: true },
        atDate: '2029-08-01',
      },
      'phase_2_recurring_2029',
    );
    expect(withFlag.active).toBe(true);
  });
});
