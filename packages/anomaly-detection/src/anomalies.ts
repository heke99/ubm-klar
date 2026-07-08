/**
 * Privacy/security anomaly detection over event windows. Pure functions; the
 * anomaly-detection worker feeds windows from data_access_events, auth logs and
 * payment_account_change_logs, and persists findings to anomaly_events.
 */
export interface AnomalyWindowInput {
  windowStart: string;
  windowEnd: string;
  /** Denied authorization attempts per user. */
  failedAuthorizationsByUser: Record<string, number>;
  /** Role mapping changes per actor. */
  roleChangesByActor: Record<string, number>;
  /** Payment recipient/account changes per actor. */
  recipientChangesByActor: Record<string, number>;
  /** Break-glass sessions without incident reference. */
  breakGlassWithoutIncident: Array<{ sessionId: string; initiatedBy: string }>;
  /** Person-record opens per user. */
  personOpensByUser: Record<string, number>;
  /** Protected-identity views without case assignment. */
  protectedViewsWithoutCase: Array<{ userId: string; personId: string }>;
}

export interface AnomalyThresholds {
  maxFailedAuthorizations: number;
  maxRoleChanges: number;
  maxRecipientChanges: number;
  maxPersonOpens: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  maxFailedAuthorizations: 10,
  maxRoleChanges: 5,
  maxRecipientChanges: 5,
  maxPersonOpens: 60,
};

export interface AnomalyFinding {
  ruleKey:
    | 'security_failed_authorization_burst'
    | 'security_role_change_burst'
    | 'payment_recipient_change_burst'
    | 'security_break_glass_without_incident'
    | 'privacy_high_volume_person_access'
    | 'privacy_protected_identity_access';
  category: 'privacy' | 'security' | 'payment';
  severity: 'low' | 'medium' | 'high' | 'critical';
  subjectKind: string;
  subjectId: string;
  explanation: string;
  eventCount: number;
}

export function detectAnomalies(
  input: AnomalyWindowInput,
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];

  for (const [userId, count] of Object.entries(input.failedAuthorizationsByUser)) {
    if (count > thresholds.maxFailedAuthorizations) {
      findings.push({
        ruleKey: 'security_failed_authorization_burst',
        category: 'security',
        severity: count > thresholds.maxFailedAuthorizations * 3 ? 'critical' : 'high',
        subjectKind: 'user',
        subjectId: userId,
        explanation: `${count} nekade behörighetsförsök under fönstret.`,
        eventCount: count,
      });
    }
  }

  for (const [actorId, count] of Object.entries(input.roleChangesByActor)) {
    if (count > thresholds.maxRoleChanges) {
      findings.push({
        ruleKey: 'security_role_change_burst',
        category: 'security',
        severity: 'high',
        subjectKind: 'user',
        subjectId: actorId,
        explanation: `${count} rolländringar under fönstret.`,
        eventCount: count,
      });
    }
  }

  for (const [actorId, count] of Object.entries(input.recipientChangesByActor)) {
    if (count > thresholds.maxRecipientChanges) {
      findings.push({
        ruleKey: 'payment_recipient_change_burst',
        category: 'payment',
        severity: 'high',
        subjectKind: 'user',
        subjectId: actorId,
        explanation: `${count} mottagar-/kontoändringar under fönstret.`,
        eventCount: count,
      });
    }
  }

  for (const session of input.breakGlassWithoutIncident) {
    findings.push({
      ruleKey: 'security_break_glass_without_incident',
      category: 'security',
      severity: 'high',
      subjectKind: 'break_glass_session',
      subjectId: session.sessionId,
      explanation: `Break-glass-session av ${session.initiatedBy} saknar incidentreferens.`,
      eventCount: 1,
    });
  }

  for (const [userId, count] of Object.entries(input.personOpensByUser)) {
    if (count > thresholds.maxPersonOpens) {
      findings.push({
        ruleKey: 'privacy_high_volume_person_access',
        category: 'privacy',
        severity: 'medium',
        subjectKind: 'user',
        subjectId: userId,
        explanation: `${count} personposter öppnade under fönstret.`,
        eventCount: count,
      });
    }
  }

  for (const view of input.protectedViewsWithoutCase) {
    findings.push({
      ruleKey: 'privacy_protected_identity_access',
      category: 'privacy',
      severity: 'critical',
      subjectKind: 'user',
      subjectId: view.userId,
      explanation: 'Åtkomst till skyddad identitet utan ärendekoppling.',
      eventCount: 1,
    });
  }

  return findings;
}
