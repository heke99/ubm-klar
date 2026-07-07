import type { DataQualityStatus } from '@ubm-klar/shared-types';
import {
  SHARED_DATA_QUALITY_CHECKS,
  type DataQualityCheck,
  type DataQualityFinding,
  type DataQualitySubject,
} from './checks';

export interface DataQualityResult {
  entityKind: string;
  entityId: string;
  overallStatus: DataQualityStatus;
  findings: DataQualityFinding[];
  checkedAt: string;
}

/** Severity ordering for aggregating findings to one overall status. */
const STATUS_SEVERITY: Record<DataQualityStatus, number> = {
  valid: 0,
  valid_with_warning: 1,
  requires_mapping_fix: 2,
  requires_source_system_fix: 3,
  requires_lineage_fix: 4,
  requires_classification_review: 5,
  requires_manual_review: 6,
  requires_dpo_review: 7,
  requires_legal_review: 8,
  blocked: 9,
};

export function aggregateStatus(findings: DataQualityFinding[]): DataQualityStatus {
  let worst: DataQualityStatus = 'valid';
  for (const finding of findings) {
    if (STATUS_SEVERITY[finding.status] > STATUS_SEVERITY[worst]) {
      worst = finding.status;
    }
  }
  return worst;
}

export class DataQualityEngine {
  constructor(
    private readonly checks: DataQualityCheck[] = SHARED_DATA_QUALITY_CHECKS,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  run(subject: DataQualitySubject): DataQualityResult {
    const findings: DataQualityFinding[] = [];
    for (const check of this.checks) {
      if (!check.appliesTo(subject)) continue;
      const finding = check.run(subject);
      if (finding) findings.push(finding);
    }
    return {
      entityKind: subject.entityKind,
      entityId: subject.entityId,
      overallStatus: aggregateStatus(findings),
      findings,
      checkedAt: this.clock().toISOString(),
    };
  }

  runBatch(subjects: DataQualitySubject[]): DataQualityResult[] {
    return subjects.map((s) => this.run(s));
  }
}

export interface DataQualityReport {
  total: number;
  byStatus: Record<DataQualityStatus, number>;
  byCheck: Record<string, number>;
  blockedShare: number;
}

export function buildReport(results: DataQualityResult[]): DataQualityReport {
  const byStatus = Object.fromEntries(
    Object.keys(STATUS_SEVERITY).map((k) => [k, 0]),
  ) as Record<DataQualityStatus, number>;
  const byCheck: Record<string, number> = {};
  for (const result of results) {
    byStatus[result.overallStatus] += 1;
    for (const finding of result.findings) {
      byCheck[finding.checkKey] = (byCheck[finding.checkKey] ?? 0) + 1;
    }
  }
  const blocked = byStatus.blocked;
  return {
    total: results.length,
    byStatus,
    byCheck,
    blockedShare: results.length === 0 ? 0 : blocked / results.length,
  };
}
