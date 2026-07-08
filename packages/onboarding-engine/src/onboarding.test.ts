import { describe, expect, it } from 'vitest';
import {
  buildRecommendations,
  computeReadinessScores,
  isGoLiveReady,
  ONBOARDING_STEPS,
  type StepStatus,
} from './onboarding';

function allCompleted(): Record<string, StepStatus> {
  return Object.fromEntries(ONBOARDING_STEPS.map((s) => [s.stepKey, 'completed' as StepStatus]));
}

describe('onboarding program', () => {
  it('covers all eight stages', () => {
    const stages = new Set(ONBOARDING_STEPS.map((s) => s.stage));
    expect(stages.size).toBe(8);
  });

  it('computes all eight readiness scores', () => {
    const scores = computeReadinessScores({});
    expect(scores).toHaveLength(8);
    expect(scores.every((s) => s.score === 0)).toBe(true);
  });

  it('scores 100 when everything is completed', () => {
    const scores = computeReadinessScores(allCompleted());
    expect(scores.every((s) => s.score === 100)).toBe(true);
  });

  it('computes partial scores', () => {
    const progress = allCompleted();
    progress.ubm_receipt_handling = 'not_started';
    const scores = computeReadinessScores(progress);
    const ubm = scores.find((s) => s.scoreKey === 'ubm_readiness')!;
    expect(ubm.score).toBeLessThan(100);
    expect(ubm.score).toBeGreaterThan(80);
  });

  it('collects blockers into scores', () => {
    const progress = allCompleted();
    progress.gl_rls_tests = 'blocked';
    const scores = computeReadinessScores(progress);
    const production = scores.find((s) => s.scoreKey === 'production_readiness')!;
    expect(production.blockers).toContain('gl_rls_tests');
  });

  it('treats not_applicable as fulfilled', () => {
    const progress = allCompleted();
    progress.dep_siem = 'not_applicable';
    const scores = computeReadinessScores(progress);
    expect(scores.every((s) => s.score === 100)).toBe(true);
  });
});

describe('recommendations', () => {
  it('emits critical recommendations for blockers', () => {
    const progress = allCompleted();
    progress.gl_dpia = 'blocked';
    const recommendations = buildRecommendations(computeReadinessScores(progress));
    expect(recommendations.some((r) => r.priority === 'critical')).toBe(true);
  });

  it('emits nothing when everything is done', () => {
    expect(buildRecommendations(computeReadinessScores(allCompleted()))).toHaveLength(0);
  });
});

describe('go-live gate', () => {
  it('blocks go-live until production readiness is 100%', () => {
    const progress = allCompleted();
    progress.gl_final_approval = 'not_started';
    const result = isGoLiveReady(computeReadinessScores(progress));
    expect(result.ready).toBe(false);
  });

  it('blocks go-live on blocked steps', () => {
    const progress = allCompleted();
    progress.gl_restore_test = 'blocked';
    const result = isGoLiveReady(computeReadinessScores(progress));
    expect(result.ready).toBe(false);
    expect(result.reason).toContain('gl_restore_test');
  });

  it('approves go-live when everything is complete', () => {
    expect(isGoLiveReady(computeReadinessScores(allCompleted())).ready).toBe(true);
  });
});
