export interface AccessEventSample {
  actorUserId: string;
  accessKind: string;
  personId?: string;
  caseId?: string;
  hasCaseAssignment: boolean;
  hasReason: boolean;
  occurredAt: Date;
}

export type CuriosityFindingKind =
  | 'high_volume_person_access'
  | 'off_hours_access'
  | 'unrelated_department_access'
  | 'protected_identity_access_without_case'
  | 'repeated_search_same_person'
  | 'access_without_case_assignment';

export interface CuriosityFinding {
  userId: string;
  findingKind: CuriosityFindingKind;
  severity: 'low' | 'medium' | 'high' | 'critical';
  eventCount: number;
  windowStart: Date;
  windowEnd: Date;
  explanation: string;
}

export interface CuriosityThresholds {
  maxPersonOpensPerDay: number;
  maxRepeatedSearchesSamePerson: number;
  officeHoursStart: number;
  officeHoursEnd: number;
  maxOffHoursEvents: number;
}

export const DEFAULT_CURIOSITY_THRESHOLDS: CuriosityThresholds = {
  maxPersonOpensPerDay: 60,
  maxRepeatedSearchesSamePerson: 5,
  officeHoursStart: 6,
  officeHoursEnd: 20,
  maxOffHoursEvents: 10,
};

/**
 * Curiosity-browsing detection over a day's worth of data access events for
 * one user. Pure function: fed from data_access_events, results land in
 * access_review_findings for DPO review.
 */
export function detectCuriosityBrowsing(
  events: AccessEventSample[],
  thresholds: CuriosityThresholds = DEFAULT_CURIOSITY_THRESHOLDS,
): CuriosityFinding[] {
  if (events.length === 0) return [];
  const findings: CuriosityFinding[] = [];
  const userId = events[0]!.actorUserId;
  const windowStart = new Date(Math.min(...events.map((e) => e.occurredAt.getTime())));
  const windowEnd = new Date(Math.max(...events.map((e) => e.occurredAt.getTime())));
  const base = { userId, windowStart, windowEnd };

  const personOpens = events.filter((e) => e.accessKind === 'person_record_open');
  if (personOpens.length > thresholds.maxPersonOpensPerDay) {
    findings.push({
      ...base,
      findingKind: 'high_volume_person_access',
      severity: personOpens.length > thresholds.maxPersonOpensPerDay * 2 ? 'high' : 'medium',
      eventCount: personOpens.length,
      explanation: `${personOpens.length} personposter öppnade under perioden (tröskel ${thresholds.maxPersonOpensPerDay}).`,
    });
  }

  const offHours = events.filter((e) => {
    const hour = e.occurredAt.getUTCHours();
    return hour < thresholds.officeHoursStart || hour >= thresholds.officeHoursEnd;
  });
  if (offHours.length > thresholds.maxOffHoursEvents) {
    findings.push({
      ...base,
      findingKind: 'off_hours_access',
      severity: 'medium',
      eventCount: offHours.length,
      explanation: `${offHours.length} åtkomster utanför kontorstid.`,
    });
  }

  const searchesByPerson = new Map<string, number>();
  for (const event of events) {
    if (event.accessKind === 'person_search' && event.personId) {
      searchesByPerson.set(event.personId, (searchesByPerson.get(event.personId) ?? 0) + 1);
    }
  }
  for (const [personId, count] of searchesByPerson) {
    if (count > thresholds.maxRepeatedSearchesSamePerson) {
      findings.push({
        ...base,
        findingKind: 'repeated_search_same_person',
        severity: 'high',
        eventCount: count,
        explanation: `Samma person (${personId.slice(0, 8)}…) har sökts ${count} gånger.`,
      });
    }
  }

  const protectedWithoutCase = events.filter(
    (e) => e.accessKind === 'protected_identity_view' && !e.hasCaseAssignment,
  );
  if (protectedWithoutCase.length > 0) {
    findings.push({
      ...base,
      findingKind: 'protected_identity_access_without_case',
      severity: 'critical',
      eventCount: protectedWithoutCase.length,
      explanation: 'Åtkomst till skyddade personuppgifter utan ärendekoppling.',
    });
  }

  const withoutAssignment = events.filter(
    (e) => e.accessKind === 'case_open' && !e.hasCaseAssignment && !e.hasReason,
  );
  if (withoutAssignment.length > 0) {
    findings.push({
      ...base,
      findingKind: 'access_without_case_assignment',
      severity: 'high',
      eventCount: withoutAssignment.length,
      explanation: `${withoutAssignment.length} ärendeöppningar utan tilldelning eller angivet skäl.`,
    });
  }

  return findings;
}
