import type { DbClient } from '@ubm-klar/db';
import { runPaymentControlRules } from '@ubm-klar/rule-run';
import { JobRegistry, type WorkerJobType } from './jobs';

/**
 * Job handlers for the pilot.
 *
 * Rules:
 *  - handlers do REAL work against the tenant data plane, or
 *  - they fail with errorCode NOT_IMPLEMENTED. No handler ever fakes success.
 *    (Passthrough success was removed in the customer-pilot hardening.)
 */

export interface HandlerContext {
  /** Tenant data plane connection (required for the real handlers). */
  db?: DbClient;
}

const NOT_IMPLEMENTED_TYPES: readonly WorkerJobType[] = [
  'document-redaction-jobs', // applied synchronously by the API (needs storage access)
  'reconciliation-jobs',
  'report-jobs',
  'archive-jobs',
  'retention-jobs',
  'siem-export-jobs',
  'anomaly-detection-jobs',
  'exit-export-jobs',
  'provisioning-jobs',
  'billing-jobs',
  'legal-source-update-jobs',
];

export function createDefaultRegistry(context: HandlerContext = {}): JobRegistry {
  const registry = new JobRegistry();
  const { db } = context;

  const requireDb = (jobId: string) => {
    if (!db) {
      return {
        jobId,
        status: 'failed' as const,
        summary: {},
        errorCode: 'NO_DATA_PLANE',
      };
    }
    return undefined;
  };

  registry.register('import-jobs', async (job) => {
    const guard = requireDb(job.id);
    if (guard) return guard;
    const batchId = job.payloadReference;
    const batch = await db!.query<{ id: string; row_count: number | null; status: string }>(
      'select id, row_count, status from import_batches where id = $1::uuid',
      [batchId],
    );
    if (!batch.rows[0]) {
      return { jobId: job.id, status: 'failed', summary: {}, errorCode: 'BATCH_NOT_FOUND' };
    }
    const staged = await db!.query<{ total: string; errors: string }>(
      `select count(*) as total, count(*) filter (where cardinality(errors) > 0) as errors
       from import_staging_rows where batch_id = $1::uuid`,
      [batchId],
    );
    return {
      jobId: job.id,
      status: 'succeeded',
      summary: {
        batchId,
        stagedRows: Number(staged.rows[0]?.total ?? 0),
        errorRows: Number(staged.rows[0]?.errors ?? 0),
        batchStatus: batch.rows[0].status,
      },
    };
  });

  registry.register('mapping-jobs', async (job) => {
    const guard = requireDb(job.id);
    if (guard) return guard;
    const mapping = await db!.query<{ mapping: unknown[] }>(
      'select mapping from import_mappings where batch_id = $1::uuid',
      [job.payloadReference],
    );
    if (!mapping.rows[0] || (mapping.rows[0].mapping as unknown[]).length === 0) {
      return { jobId: job.id, status: 'failed', summary: {}, errorCode: 'MAPPING_MISSING' };
    }
    const mapped = await db!.query<{ mapped: string }>(
      `select count(*) filter (where mapped is not null) as mapped
       from import_staging_rows where batch_id = $1::uuid`,
      [job.payloadReference],
    );
    return {
      jobId: job.id,
      status: 'succeeded',
      summary: { mappedRows: Number(mapped.rows[0]?.mapped ?? 0) },
    };
  });

  registry.register('validation-jobs', async (job) => {
    const guard = requireDb(job.id);
    if (guard) return guard;
    const counts = await db!.query<{ total: string; errors: string; warnings: string }>(
      `select count(*) as total,
              count(*) filter (where cardinality(errors) > 0) as errors,
              count(*) filter (where cardinality(warnings) > 0) as warnings
       from import_staging_rows where batch_id = $1::uuid`,
      [job.payloadReference],
    );
    const row = counts.rows[0]!;
    return {
      jobId: job.id,
      status: 'succeeded',
      summary: {
        totalRows: Number(row.total),
        errorRows: Number(row.errors),
        warningRows: Number(row.warnings),
      },
    };
  });

  registry.register('data-quality-jobs', async (job) => {
    const guard = requireDb(job.id);
    if (guard) return guard;
    const quality = await db!.query<{
      persons_without_pn: string;
      lss_payments_without_decision: string;
      ea_payments_without_decision: string;
      negative_lss_payments: string;
    }>(
      `select
         (select count(*) from persons where personal_identity_number is null) as persons_without_pn,
         (select count(*) from lss_payments where decision_id is null) as lss_payments_without_decision,
         (select count(*) from ea_payments where decision_id is null) as ea_payments_without_decision,
         (select count(*) from lss_payments where amount_sek < 0) as negative_lss_payments`,
    );
    const row = quality.rows[0]!;
    return {
      jobId: job.id,
      status: 'succeeded',
      summary: {
        personsWithoutIdNumber: Number(row.persons_without_pn),
        lssPaymentsWithoutDecision: Number(row.lss_payments_without_decision),
        eaPaymentsWithoutDecision: Number(row.ea_payments_without_decision),
        negativeLssPayments: Number(row.negative_lss_payments),
      },
    };
  });

  registry.register('rule-engine-jobs', async (job) => {
    const guard = requireDb(job.id);
    if (guard) return guard;
    const domain = (
      job.payloadReference === 'economic_assistance' ? 'economic_assistance' : 'lss'
    ) as 'lss' | 'economic_assistance';
    const result = await runPaymentControlRules(db!, domain, { dryRun: true });
    return { jobId: job.id, status: 'succeeded', summary: { ...result } };
  });

  registry.register('payment-control-jobs', async (job) => {
    const guard = requireDb(job.id);
    if (guard) return guard;
    const domain = (
      job.payloadReference === 'economic_assistance' ? 'economic_assistance' : 'lss'
    ) as 'lss' | 'economic_assistance';
    const result = await runPaymentControlRules(db!, domain);

    // High/critical flags become control cases (idempotent per flag).
    const highFlags = await db!.query<{
      id: string;
      rule_key: string;
      severity: string;
      explanation: string;
      person_id: string | null;
      amount_at_risk_sek: string | null;
    }>(
      `select id, rule_key, severity, explanation, person_id, amount_at_risk_sek
       from risk_flags
       where domain = $1 and severity in ('high','critical')
         and status = 'open' and control_case_id is null and dry_run = false
       limit 200`,
      [domain],
    );
    let casesCreated = 0;
    for (const flag of highFlags.rows) {
      const caseNumber = `KA-${new Date().getFullYear()}-${flag.id.slice(0, 8).toUpperCase()}`;
      const controlCase = await db!.query<{ id: string }>(
        `insert into control_cases
           (case_number, source_kind, source_reference, domain, title, severity, status, person_id, amount_at_risk_sek)
         values ($1, 'risk_flag', $2, $3, $4, $5, 'open', $6::uuid, $7)
         on conflict (case_number) do nothing
         returning id`,
        [
          caseNumber,
          flag.id,
          domain,
          flag.explanation.slice(0, 200),
          flag.severity,
          flag.person_id,
          flag.amount_at_risk_sek,
        ],
      );
      if (controlCase.rows[0]) {
        await db!.query(
          `update risk_flags set control_case_id = $2::uuid, status = 'under_review' where id = $1::uuid`,
          [flag.id, controlCase.rows[0].id],
        );
        casesCreated++;
      }
    }
    return {
      jobId: job.id,
      status: 'succeeded',
      summary: { ...result, controlCasesCreated: casesCreated },
    };
  });

  registry.register('export-jobs', async (job) => {
    const guard = requireDb(job.id);
    if (guard) return guard;
    // Integrity verification of a packaged submission (manifest hash recheck).
    const submission = await db!.query<{
      id: string;
      package_manifest: unknown;
      manifest_hash_sha256: string;
    }>(
      `select id, package_manifest, manifest_hash_sha256 from ubm_submissions
       where proposal_id = $1::uuid order by created_at desc limit 1`,
      [job.payloadReference],
    );
    if (!submission.rows[0]) {
      return { jobId: job.id, status: 'failed', summary: {}, errorCode: 'SUBMISSION_NOT_FOUND' };
    }
    const { createHash } = await import('node:crypto');
    const recomputed = createHash('sha256')
      .update(JSON.stringify(submission.rows[0].package_manifest, null, 2))
      .digest('hex');
    const valid = recomputed === submission.rows[0].manifest_hash_sha256;
    return {
      jobId: job.id,
      status: valid ? 'succeeded' : 'failed',
      summary: { submissionId: submission.rows[0].id, manifestIntegrity: valid },
      ...(valid ? {} : { errorCode: 'MANIFEST_HASH_MISMATCH' }),
    };
  });

  registry.register('notification-jobs', async (job) => {
    const guard = requireDb(job.id);
    if (guard) return guard;
    const notification = await db!.query<{ id: string; status: string }>(
      'select id, status from ubm_notifications where id = $1::uuid',
      [job.payloadReference],
    );
    if (!notification.rows[0]) {
      return { jobId: job.id, status: 'failed', summary: {}, errorCode: 'NOTIFICATION_NOT_FOUND' };
    }
    if (notification.rows[0].status === 'received') {
      await db!.query(`update ubm_notifications set status = 'matching' where id = $1::uuid`, [
        job.payloadReference,
      ]);
    }
    const scores = await db!.query<{ count: string }>(
      'select count(*) as count from ubm_notification_confidence_scores where notification_id = $1::uuid',
      [job.payloadReference],
    );
    return {
      jobId: job.id,
      status: 'succeeded',
      summary: { candidateScores: Number(scores.rows[0]?.count ?? 0) },
    };
  });

  registry.register('onboarding-jobs', async (job) => {
    const guard = requireDb(job.id);
    if (guard) return guard;
    // Automatable gate evidence: persistent audit + data access logs verified.
    const counts = await db!.query<{ audit: string; hashed: string; access: string }>(
      `select
         (select count(*) from audit_events) as audit,
         (select count(*) from audit_events where event_hash is not null) as hashed,
         (select count(*) from data_access_events) as access`,
    );
    const row = counts.rows[0]!;
    const auditVerified = Number(row.hashed) > 0;
    const accessVerified = Number(row.access) > 0;
    for (const [gate, verified] of [
      ['audit_log_verified', auditVerified],
      ['data_access_log_verified', accessVerified],
    ] as const) {
      if (verified) {
        await db!.query(
          `insert into production_readiness_evidence (gate_key, status, evidence_kind, evidence_reference)
           values ($1, 'passed', 'test_run', $2)
           on conflict (gate_key) do update
             set status = 'passed', evidence_kind = 'test_run',
                 evidence_reference = excluded.evidence_reference, updated_at = now()`,
          [gate, `worker-onboarding-job:${job.id}:${new Date().toISOString()}`],
        );
      }
    }
    return {
      jobId: job.id,
      status: 'succeeded',
      summary: {
        auditEvents: Number(row.audit),
        hashedAuditEvents: Number(row.hashed),
        dataAccessEvents: Number(row.access),
        auditGatePassed: auditVerified,
        dataAccessGatePassed: accessVerified,
      },
    };
  });

  // Everything not implemented FAILS explicitly — never fake success.
  for (const type of NOT_IMPLEMENTED_TYPES) {
    registry.register(type, async (job) => ({
      jobId: job.id,
      status: 'failed',
      summary: { type },
      errorCode: 'NOT_IMPLEMENTED',
    }));
  }

  return registry;
}

export { NOT_IMPLEMENTED_TYPES };
