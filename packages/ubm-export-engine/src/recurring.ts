import { isFlagEnabled, FEATURE_FLAGS } from '@ubm-klar/config';
import type { RegistryStatus } from '@ubm-klar/shared-types';

/**
 * UBM Phase 2 (2029) recurring reporting. Everything here is feature-flagged
 * behind `ubm_recurring_reporting_2029` and additionally gated on dataset
 * schema status: `awaiting_official_specification` datasets can never open a
 * reporting period.
 */
export type ReportingPeriodStatus =
  | 'open'
  | 'collecting'
  | 'validating'
  | 'proposal_created'
  | 'in_review'
  | 'approved'
  | 'sent'
  | 'receipt_received'
  | 'closed'
  | 'failed';

export interface RecurringDatasetDefinition {
  datasetKey: string;
  scheduleKey: string;
  schemaKey: string;
  schemaVersion: string;
  status: RegistryStatus;
}

export interface ReportingPeriod {
  id: string;
  scheduleKey: string;
  periodStart: string;
  periodEnd: string;
  status: ReportingPeriodStatus;
}

export class RecurringReportingDisabledError extends Error {
  constructor(reason: string) {
    super(`Recurring UBM reporting is not available: ${reason}`);
    this.name = 'RecurringReportingDisabledError';
  }
}

export interface OpenPeriodInput {
  featureFlags: Record<string, boolean>;
  dataset: RecurringDatasetDefinition;
  periodStart: string;
  periodEnd: string;
  atDate: string;
}

export function openReportingPeriod(input: OpenPeriodInput): ReportingPeriod {
  if (!isFlagEnabled(input.featureFlags, FEATURE_FLAGS.UBM_RECURRING_REPORTING_2029)) {
    throw new RecurringReportingDisabledError(
      'feature flag ubm_recurring_reporting_2029 is off (official specifications pending)',
    );
  }
  if (input.dataset.status === 'awaiting_official_specification') {
    throw new RecurringReportingDisabledError(
      `dataset ${input.dataset.datasetKey} awaits official specification and cannot be reported`,
    );
  }
  if (!['pilot', 'active'].includes(input.dataset.status)) {
    throw new RecurringReportingDisabledError(
      `dataset ${input.dataset.datasetKey} has status ${input.dataset.status}`,
    );
  }
  if (input.atDate < '2029-07-01') {
    throw new RecurringReportingDisabledError(
      'phase 2 recurring reporting is not effective before 2029-07-01',
    );
  }
  return {
    id: `${input.dataset.scheduleKey}:${input.periodStart}`,
    scheduleKey: input.dataset.scheduleKey,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    status: 'open',
  };
}

const PERIOD_TRANSITIONS: Record<ReportingPeriodStatus, ReportingPeriodStatus[]> = {
  open: ['collecting', 'failed'],
  collecting: ['validating', 'failed'],
  validating: ['proposal_created', 'collecting', 'failed'],
  proposal_created: ['in_review'],
  in_review: ['approved', 'validating'],
  approved: ['sent'],
  sent: ['receipt_received', 'failed'],
  receipt_received: ['closed'],
  closed: [],
  failed: ['open'],
};

export function transitionPeriod(
  period: ReportingPeriod,
  to: ReportingPeriodStatus,
): ReportingPeriod {
  const allowed = PERIOD_TRANSITIONS[period.status] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid reporting period transition: ${period.status} -> ${to}`);
  }
  return { ...period, status: to };
}

export interface ExportRowSnapshot {
  entityKind: string;
  entityId: string;
  payload: Record<string, string>;
}

export interface ExportDifference {
  differenceKind: 'added' | 'removed' | 'changed';
  entityKind: string;
  entityId: string;
  fieldKey?: string;
  detail: string;
}

/** Computes differences from the previous period's export (shown to reviewers). */
export function diffExports(
  previous: ExportRowSnapshot[],
  current: ExportRowSnapshot[],
): ExportDifference[] {
  const differences: ExportDifference[] = [];
  const keyOf = (r: ExportRowSnapshot) => `${r.entityKind}:${r.entityId}`;
  const previousByKey = new Map(previous.map((r) => [keyOf(r), r]));
  const currentByKey = new Map(current.map((r) => [keyOf(r), r]));

  for (const [key, row] of currentByKey) {
    const before = previousByKey.get(key);
    if (!before) {
      differences.push({
        differenceKind: 'added',
        entityKind: row.entityKind,
        entityId: row.entityId,
        detail: 'Ny post jämfört med föregående period.',
      });
      continue;
    }
    for (const [field, value] of Object.entries(row.payload)) {
      if (before.payload[field] !== value) {
        differences.push({
          differenceKind: 'changed',
          entityKind: row.entityKind,
          entityId: row.entityId,
          fieldKey: field,
          detail: `Fältet ${field} ändrades sedan föregående period.`,
        });
      }
    }
  }
  for (const [key, row] of previousByKey) {
    if (!currentByKey.has(key)) {
      differences.push({
        differenceKind: 'removed',
        entityKind: row.entityKind,
        entityId: row.entityId,
        detail: 'Posten fanns i föregående period men saknas nu.',
      });
    }
  }
  return differences;
}
