import { describe, expect, it } from 'vitest';
import {
  createBreakGlassSession,
  createSupportSession,
  isSessionActive,
  MAX_BREAK_GLASS_SESSION_MS,
  MAX_SUPPORT_SESSION_MS,
  SupportSessionError,
  type SupportSessionRequest,
} from './support-sessions';

function request(overrides: Partial<SupportSessionRequest> = {}): SupportSessionRequest {
  return {
    supportCaseReference: 'SUP-1001',
    requestedBySupportUser: 'support-tech-1',
    approvedByMunicipalityUser: 'kommun-admin-1',
    scope: 'import_status',
    reason: 'Felsökning av importkö som fastnat (ärende SUP-1001)',
    requestedDurationMs: 2 * 60 * 60 * 1000,
    ...overrides,
  };
}

describe('support JIT sessions', () => {
  it('creates approved, scoped, time-limited sessions without PII access', () => {
    const session = createSupportSession(request(), 1_000_000);
    expect(session.piiAccess).toBe(false);
    expect(session.expiresAt).toBe(1_000_000 + 2 * 60 * 60 * 1000);
    expect(isSessionActive(session, 1_000_001)).toBe(true);
    expect(isSessionActive(session, session.expiresAt)).toBe(false);
  });

  it('requires municipality approval', () => {
    const r = request();
    delete r.approvedByMunicipalityUser;
    expect(() => createSupportSession(r)).toThrow(SupportSessionError);
  });

  it('rejects self-approval', () => {
    expect(() =>
      createSupportSession(request({ approvedByMunicipalityUser: 'support-tech-1' })),
    ).toThrow('self-approved');
  });

  it('requires a meaningful reason', () => {
    expect(() => createSupportSession(request({ reason: 'test' }))).toThrow('reason');
  });

  it('caps session duration', () => {
    expect(() =>
      createSupportSession(request({ requestedDurationMs: MAX_SUPPORT_SESSION_MS + 1 })),
    ).toThrow('limited');
  });
});

describe('break-glass sessions', () => {
  it('requires the break-glass role', () => {
    expect(() =>
      createBreakGlassSession({
        initiatedBy: 'u1',
        hasBreakGlassRole: false,
        reason: 'Incident 42: återställning av produktionsdata efter felaktig migrering',
        requestedDurationMs: 60 * 60 * 1000,
      }),
    ).toThrow('break_glass_admin');
  });

  it('requires a substantive reason', () => {
    expect(() =>
      createBreakGlassSession({
        initiatedBy: 'u1',
        hasBreakGlassRole: true,
        reason: 'akut',
        requestedDurationMs: 60 * 60 * 1000,
      }),
    ).toThrow('min 20');
  });

  it('caps duration at 4 hours and starts with pending post-review', () => {
    const session = createBreakGlassSession(
      {
        initiatedBy: 'u1',
        hasBreakGlassRole: true,
        reason: 'Incident 42: återställning av felaktig ärendestatus i produktion',
        incidentReference: 'INC-42',
        requestedDurationMs: MAX_BREAK_GLASS_SESSION_MS,
      },
      0,
    );
    expect(session.expiresAt).toBe(MAX_BREAK_GLASS_SESSION_MS);
    expect(session.postReviewStatus).toBe('pending');
    expect(() =>
      createBreakGlassSession({
        initiatedBy: 'u1',
        hasBreakGlassRole: true,
        reason: 'Incident 42: återställning av felaktig ärendestatus i produktion',
        requestedDurationMs: MAX_BREAK_GLASS_SESSION_MS + 1,
      }),
    ).toThrow('limited');
  });
});
