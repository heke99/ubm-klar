import { describe, expect, it } from 'vitest';
import { authorize, type AccessContext, type AccessSubject } from './authorize';

function subject(overrides: Partial<AccessSubject> = {}): AccessSubject {
  return {
    userId: 'user-1',
    roles: ['lss_case_worker'],
    departmentIds: ['dep-lss'],
    unitIds: [],
    committeeIds: [],
    assignedCaseIds: ['case-1'],
    sessionKind: 'normal',
    ...overrides,
  };
}

const context: AccessContext = {
  enabledModules: [
    'lss',
    'economic_assistance',
    'payment_control',
    'ubm_readiness',
    'control_cases',
    'document_vault',
    'import_gateway',
  ],
};

describe('RBAC', () => {
  it('allows a case worker to read an assigned LSS case', () => {
    const decision = authorize(
      subject(),
      'case.lss.read',
      { kind: 'lss_case', caseId: 'case-1', departmentId: 'dep-lss', module: 'lss' },
      context,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('log_data_access');
  });

  it('denies permissions no role grants', () => {
    const decision = authorize(subject(), 'ubm.export.approve', { kind: 'ubm_export' }, context);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.at(-1)).toContain('No role grants');
  });
});

describe('no-PII hard wall', () => {
  it('denies PII permissions for no-PII support roles even if matrix were misconfigured', () => {
    const decision = authorize(
      subject({ roles: ['support_technician_no_pii'] }),
      'person.read',
      { kind: 'person' },
      context,
    );
    expect(decision.allowed).toBe(false);
  });

  it('denies support JIT sessions any PII permission', () => {
    const decision = authorize(
      subject({
        roles: ['controller'],
        sessionKind: 'support_jit',
        sessionExpiresAt: Date.now() + 60_000,
      }),
      'payment.read',
      { kind: 'payment' },
      context,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.at(-1)).toContain('Support JIT');
  });

  it('allows support JIT sessions technical status reads', () => {
    const decision = authorize(
      subject({
        roles: ['support_technician_no_pii'],
        sessionKind: 'support_jit',
        sessionExpiresAt: Date.now() + 60_000,
      }),
      'support.technical_status.read',
      { kind: 'health' },
      context,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('time_limited_session');
  });
});

describe('session expiry', () => {
  it('denies expired break-glass sessions', () => {
    const decision = authorize(
      subject({
        roles: ['break_glass_admin'],
        sessionKind: 'break_glass',
        sessionExpiresAt: Date.now() - 1,
      }),
      'break_glass.initiate',
      { kind: 'system' },
      context,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.at(-1)).toContain('expired');
  });
});

describe('module entitlement', () => {
  it('denies module permissions when the module is not enabled', () => {
    const decision = authorize(
      subject(),
      'case.lss.read',
      { kind: 'lss_case', caseId: 'case-1', module: 'lss' },
      { enabledModules: ['economic_assistance'] },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.at(-1)).toContain('not enabled');
  });
});

describe('need-to-know', () => {
  it('denies case workers access to unassigned cases', () => {
    const decision = authorize(
      subject(),
      'case.lss.read',
      { kind: 'lss_case', caseId: 'case-999', departmentId: 'dep-lss' },
      context,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.at(-1)).toContain('Need-to-know');
  });

  it('allows reviewer mandates (DPO) without case assignment', () => {
    const decision = authorize(
      subject({ roles: ['dpo'], assignedCaseIds: [] }),
      'audit.read',
      { kind: 'audit_log', caseId: 'case-999' },
      context,
    );
    expect(decision.allowed).toBe(true);
  });

  it('denies access outside own department for department-bound roles', () => {
    const decision = authorize(
      subject(),
      'case.lss.read',
      { kind: 'lss_case', caseId: 'case-1', departmentId: 'dep-other' },
      context,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.at(-1)).toContain('department');
  });
});

describe('sensitive data classes', () => {
  it('requires a reason for sensitive field reveal', () => {
    const decision = authorize(
      subject(),
      'person.sensitive_field.reveal',
      { kind: 'person', caseId: 'case-1', dataClasses: ['income_data'] },
      context,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.obligations).toContain('require_reason');
  });

  it('allows sensitive reveal with reason and logs it', () => {
    const decision = authorize(
      subject(),
      'person.sensitive_field.reveal',
      { kind: 'person', caseId: 'case-1', dataClasses: ['income_data'] },
      { ...context, reason: 'Handläggning av pågående ärende, kontroll av inkomstuppgift' },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('log_sensitive_reveal');
  });

  it('requires elevated role or assignment for protected identity', () => {
    const denied = authorize(
      subject({ assignedCaseIds: [] }),
      'case.lss.read',
      { kind: 'lss_case', caseId: 'case-1', protectedIdentity: true, departmentId: 'dep-lss' },
      { ...context, reason: 'Behörig handläggning av skyddat ärende' },
    );
    expect(denied.allowed).toBe(false);

    const allowed = authorize(
      subject(),
      'case.lss.read',
      { kind: 'lss_case', caseId: 'case-1', protectedIdentity: true, departmentId: 'dep-lss' },
      { ...context, reason: 'Behörig handläggning av skyddat ärende' },
    );
    expect(allowed.allowed).toBe(true);
    expect(allowed.obligations).toContain('log_sensitive_reveal');
  });

  it('denies protected identity access without reason even with elevated role', () => {
    const decision = authorize(
      subject({ roles: ['control_investigator'] }),
      'case.control.read',
      { kind: 'control_case', protectedIdentity: true },
      context,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.obligations).toContain('require_reason');
  });

  it('adds masking obligation when reading resources with sensitive classes', () => {
    const decision = authorize(
      subject(),
      'case.lss.read',
      { kind: 'lss_case', caseId: 'case-1', dataClasses: ['health_medical'] },
      { ...context, reason: 'Handläggning av pågående ärende med vårdintyg' },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('mask_sensitive_fields');
  });
});
