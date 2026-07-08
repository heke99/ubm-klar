import type { RegistryStatus } from '@ubm-klar/shared-types';

export interface LegalSourceVersion {
  sourceKey: string;
  version: string;
  status: RegistryStatus;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface VersionResolution<T> {
  resolved?: T;
  requiresManualReview: boolean;
  reason?: string;
}

/**
 * Resolves which version of a legal source applies at a given date.
 * Fails safe: ambiguity or unclear statuses resolve to manual review rather
 * than silently picking a version.
 */
export function resolveLegalSourceVersion(
  versions: LegalSourceVersion[],
  sourceKey: string,
  atDate: string,
): VersionResolution<LegalSourceVersion> {
  const candidates = versions.filter(
    (v) =>
      v.sourceKey === sourceKey &&
      (!v.effectiveFrom || v.effectiveFrom <= atDate) &&
      (!v.effectiveTo || v.effectiveTo >= atDate),
  );
  if (candidates.length === 0) {
    return {
      requiresManualReview: true,
      reason: `No version of ${sourceKey} is effective at ${atDate}`,
    };
  }
  const usable = candidates.filter((v) => v.status === 'active' || v.status === 'pilot');
  if (usable.length === 0) {
    const statuses = [...new Set(candidates.map((v) => v.status))].join(', ');
    return {
      requiresManualReview: true,
      reason: `Version(s) of ${sourceKey} at ${atDate} have status ${statuses}; manual review required`,
    };
  }
  // Latest effectiveFrom wins
  const resolved = [...usable].sort((a, b) =>
    (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''),
  )[0]!;
  return { resolved, requiresManualReview: false };
}

export interface UbmPhaseConfiguration {
  phaseKey: 'phase_1_request_based_2026' | 'phase_2_recurring_2029';
  enabled: boolean;
  featureFlagKey?: string;
  effectiveFrom: string;
}

export const DEFAULT_UBM_PHASES: UbmPhaseConfiguration[] = [
  {
    phaseKey: 'phase_1_request_based_2026',
    enabled: true,
    effectiveFrom: '2026-07-01',
  },
  {
    phaseKey: 'phase_2_recurring_2029',
    enabled: false,
    featureFlagKey: 'ubm_recurring_reporting_2029',
    effectiveFrom: '2029-07-01',
  },
];

export interface PhaseCheckInput {
  phases: UbmPhaseConfiguration[];
  featureFlags: Record<string, boolean>;
  atDate: string;
}

/** A phase is usable when effective, enabled, and (if flagged) its flag is on. */
export function isPhaseActive(
  input: PhaseCheckInput,
  phaseKey: UbmPhaseConfiguration['phaseKey'],
): { active: boolean; reason: string } {
  const phase = input.phases.find((p) => p.phaseKey === phaseKey);
  if (!phase) return { active: false, reason: `Phase ${phaseKey} is not configured` };
  if (input.atDate < phase.effectiveFrom) {
    return { active: false, reason: `Phase is not effective until ${phase.effectiveFrom}` };
  }
  if (!phase.enabled) return { active: false, reason: 'Phase is disabled in configuration' };
  if (phase.featureFlagKey && !input.featureFlags[phase.featureFlagKey]) {
    return {
      active: false,
      reason: `Feature flag ${phase.featureFlagKey} is off (official specifications pending)`,
    };
  }
  return { active: true, reason: 'Phase active' };
}
