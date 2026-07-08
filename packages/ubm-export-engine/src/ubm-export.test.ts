import { describe, expect, it } from 'vitest';
import { createWorkflow, decideStep } from '@ubm-klar/approval-workflows';
import { EvidenceChain } from '@ubm-klar/evidence-chain';
import {
  assertSendable,
  buildExportPackage,
  ExportNotApprovedError,
  registerReceipt,
  type UbmExportPackageInput,
} from './export-package';
import {
  diffExports,
  openReportingPeriod,
  RecurringReportingDisabledError,
  transitionPeriod,
  type OpenPeriodInput,
} from './recurring';

function packageInput(overrides: Partial<UbmExportPackageInput> = {}): UbmExportPackageInput {
  return {
    proposalId: 'proposal-1234',
    requestNumber: 'UBM-2026-0001',
    domain: 'lss',
    schemaKey: 'ubm_request_response_lss',
    schemaVersion: '1.0.0',
    legalSourceKey: 'lag_2023_456_uppgiftsskyldighet',
    legalSourceVersion: '2026-07-01',
    ruleSetVersion: '1.0.0',
    rows: [
      {
        entityKind: 'lss_decision',
        entityId: 'd1',
        payload: { decision_number: 'LSS-1', hours_per_week: '84' },
      },
    ],
    documents: [
      { documentId: 'doc1', fileHashSha256: 'abc123', exportMode: 'reference_only' },
    ],
    createdBy: 'maker-1',
    ...overrides,
  };
}

describe('buildExportPackage', () => {
  it('produces deterministic hashes and version metadata', async () => {
    const clock = () => new Date('2026-07-20T10:00:00Z');
    const a = await buildExportPackage(packageInput(), undefined, clock);
    const b = await buildExportPackage(packageInput(), undefined, clock);
    expect(a.payloadHashSha256).toBe(b.payloadHashSha256);
    expect(a.manifestHashSha256).toBe(b.manifestHashSha256);
    expect(a.manifest.schemaVersion).toBe('1.0.0');
    expect(a.manifest.legalSourceVersion).toBe('2026-07-01');
    expect(a.manifest.ruleSetVersion).toBe('1.0.0');
    expect(a.signature).toContain('UNSIGNED:');
  });

  it('hash changes when payload changes', async () => {
    const a = await buildExportPackage(packageInput());
    const b = await buildExportPackage(
      packageInput({
        rows: [
          {
            entityKind: 'lss_decision',
            entityId: 'd1',
            payload: { decision_number: 'LSS-1', hours_per_week: '90' },
          },
        ],
      }),
    );
    expect(a.payloadHashSha256).not.toBe(b.payloadHashSha256);
  });
});

describe('assertSendable', () => {
  function approvedWorkflow() {
    let wf = createWorkflow({
      kind: 'ubm_export',
      subjectKind: 'ubm_submission',
      subjectId: 's1',
      createdBy: 'maker-1',
      requiredRoles: ['ubm_export_manager'],
    });
    wf = decideStep(wf, {
      stepId: wf.steps[0]!.id,
      decision: 'approved',
      decidedBy: 'checker-1',
      actingRole: 'ubm_export_manager',
    });
    return wf;
  }

  it('allows approved workflow + approved transport', () => {
    expect(() =>
      assertSendable({
        approvalWorkflow: approvedWorkflow(),
        transportProfile: 'manual_download',
        transportApproved: true,
      }),
    ).not.toThrow();
  });

  it('blocks unapproved workflows', () => {
    const wf = createWorkflow({
      kind: 'ubm_export',
      subjectKind: 'ubm_submission',
      subjectId: 's1',
      createdBy: 'maker-1',
      requiredRoles: ['ubm_export_manager'],
    });
    expect(() =>
      assertSendable({ approvalWorkflow: wf, transportProfile: 'manual_download', transportApproved: true }),
    ).toThrow(ExportNotApprovedError);
  });

  it('blocks the pending official UBM transport', () => {
    expect(() =>
      assertSendable({
        approvalWorkflow: approvedWorkflow(),
        transportProfile: 'ubm_official_transport_pending',
        transportApproved: true,
      }),
    ).toThrow('official UBM transport');
  });
});

describe('receipts and evidence chain', () => {
  it('registers receipts into the evidence chain', () => {
    const chain = new EvidenceChain('ubm_submission', 'sub-1');
    const receipt = registerReceipt('sub-1', 'manual_confirmation', 'kvittens-innehåll', chain);
    expect(receipt.receiptHashSha256).toHaveLength(64);
    expect(chain.list()).toHaveLength(1);
    expect(chain.verify().valid).toBe(true);
  });
});

function openInput(overrides: Partial<OpenPeriodInput> = {}): OpenPeriodInput {
  return {
    featureFlags: { ubm_recurring_reporting_2029: true },
    dataset: {
      datasetKey: 'lss_monthly',
      scheduleKey: 'lss_monthly_schedule',
      schemaKey: 'ubm_recurring_lss',
      schemaVersion: '1.0.0',
      status: 'active',
    },
    periodStart: '2029-07-01',
    periodEnd: '2029-07-31',
    atDate: '2029-08-01',
    ...overrides,
  };
}

describe('recurring reporting 2029', () => {
  it('is blocked without the feature flag', () => {
    expect(() => openReportingPeriod(openInput({ featureFlags: {} }))).toThrow(
      RecurringReportingDisabledError,
    );
  });

  it('is blocked for datasets awaiting official specification', () => {
    expect(() =>
      openReportingPeriod(
        openInput({
          dataset: { ...openInput().dataset, status: 'awaiting_official_specification' },
        }),
      ),
    ).toThrow('awaits official specification');
  });

  it('is blocked before 2029-07-01', () => {
    expect(() => openReportingPeriod(openInput({ atDate: '2028-12-31' }))).toThrow(
      'not effective before',
    );
  });

  it('opens periods and walks the closure flow when enabled', () => {
    let period = openReportingPeriod(openInput());
    expect(period.status).toBe('open');
    period = transitionPeriod(period, 'collecting');
    period = transitionPeriod(period, 'validating');
    period = transitionPeriod(period, 'proposal_created');
    period = transitionPeriod(period, 'in_review');
    period = transitionPeriod(period, 'approved');
    period = transitionPeriod(period, 'sent');
    period = transitionPeriod(period, 'receipt_received');
    period = transitionPeriod(period, 'closed');
    expect(period.status).toBe('closed');
  });

  it('rejects invalid period transitions', () => {
    const period = openReportingPeriod(openInput());
    expect(() => transitionPeriod(period, 'sent')).toThrow('Invalid reporting period transition');
  });

  it('computes differences from the previous period', () => {
    const previous = [
      { entityKind: 'lss_decision', entityId: 'd1', payload: { hours: '80' } },
      { entityKind: 'lss_decision', entityId: 'd2', payload: { hours: '40' } },
    ];
    const current = [
      { entityKind: 'lss_decision', entityId: 'd1', payload: { hours: '90' } },
      { entityKind: 'lss_decision', entityId: 'd3', payload: { hours: '20' } },
    ];
    const diff = diffExports(previous, current);
    expect(diff).toHaveLength(3);
    expect(diff.map((d) => d.differenceKind).sort()).toEqual(['added', 'changed', 'removed']);
  });
});
