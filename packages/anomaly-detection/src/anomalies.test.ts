import { describe, expect, it } from 'vitest';
import { detectAnomalies, type AnomalyWindowInput } from './anomalies';

function window(overrides: Partial<AnomalyWindowInput> = {}): AnomalyWindowInput {
  return {
    windowStart: '2026-07-07T00:00:00Z',
    windowEnd: '2026-07-08T00:00:00Z',
    failedAuthorizationsByUser: {},
    roleChangesByActor: {},
    recipientChangesByActor: {},
    breakGlassWithoutIncident: [],
    personOpensByUser: {},
    protectedViewsWithoutCase: [],
    ...overrides,
  };
}

describe('detectAnomalies', () => {
  it('is silent on a normal window', () => {
    expect(
      detectAnomalies(
        window({ failedAuthorizationsByUser: { u1: 2 }, personOpensByUser: { u1: 20 } }),
      ),
    ).toHaveLength(0);
  });

  it('flags failed authorization bursts, escalating to critical', () => {
    const high = detectAnomalies(window({ failedAuthorizationsByUser: { u1: 15 } }));
    expect(high[0]).toMatchObject({
      ruleKey: 'security_failed_authorization_burst',
      severity: 'high',
    });
    const critical = detectAnomalies(window({ failedAuthorizationsByUser: { u1: 40 } }));
    expect(critical[0]!.severity).toBe('critical');
  });

  it('flags role change and recipient change bursts', () => {
    const findings = detectAnomalies(
      window({ roleChangesByActor: { admin1: 8 }, recipientChangesByActor: { eco1: 9 } }),
    );
    expect(findings.map((f) => f.ruleKey).sort()).toEqual([
      'payment_recipient_change_burst',
      'security_role_change_burst',
    ]);
  });

  it('flags break-glass sessions without incident reference', () => {
    const findings = detectAnomalies(
      window({ breakGlassWithoutIncident: [{ sessionId: 's1', initiatedBy: 'u1' }] }),
    );
    expect(findings[0]!.ruleKey).toBe('security_break_glass_without_incident');
  });

  it('flags protected identity access without case as critical privacy anomaly', () => {
    const findings = detectAnomalies(
      window({ protectedViewsWithoutCase: [{ userId: 'u1', personId: 'p1' }] }),
    );
    expect(findings[0]).toMatchObject({
      ruleKey: 'privacy_protected_identity_access',
      severity: 'critical',
      category: 'privacy',
    });
  });

  it('flags high-volume person access', () => {
    const findings = detectAnomalies(window({ personOpensByUser: { u1: 100 } }));
    expect(findings[0]!.ruleKey).toBe('privacy_high_volume_person_access');
  });
});
