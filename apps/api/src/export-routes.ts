import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildZipArchive } from '@ubm-klar/import-engine';
import type { AuditLogger } from '@ubm-klar/audit';
import type { PermissionKey } from '@ubm-klar/access-control';
import type { Repositories } from './repositories';

/**
 * Export proposal review, maker-checker approval, packaging and manual
 * download/sending/receipt registration.
 *
 * Transport is manual_download ONLY: packages are downloaded by an authorized
 * user and delivered through the channel the municipality registers manually.
 * No official UBM transport exists.
 */

export interface ExportRoutesOptions {
  auditLogger: AuditLogger;
  requirePermission: (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: PermissionKey,
  ) => boolean;
}

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Builds the deterministic package content for a proposal (manifest + data + summary). */
async function buildPackageContent(repos: Repositories, proposalId: string) {
  const proposal = (await repos.exportProposals.getById(proposalId))!;
  const rows = await repos.exportProposals.listRows(proposalId);
  const request = proposal.requestId
    ? await repos.ubmRequests.getById(proposal.requestId)
    : undefined;
  const subjects = proposal.requestId
    ? await repos.ubmRequests.listSubjects(proposal.requestId)
    : [];
  const reviews = proposal.requestId
    ? (
        await repos.db.query<{
          review_kind: string;
          decision: string | null;
          comment: string | null;
        }>(
          'select review_kind, decision, comment from ubm_request_reviews where request_id = $1::uuid',
          [proposal.requestId],
        )
      ).rows
    : [];
  const approvals = await repos.db.query<{
    kind: string;
    status: string;
    created_by: string;
    decided_by: string | null;
    decision: string | null;
    comment: string | null;
    decided_at: Date | null;
  }>(
    `select w.kind, w.status, w.created_by, s.decided_by, s.decision, s.comment, s.decided_at
     from approval_workflows w
     left join approval_steps s on s.workflow_id = w.id
     where w.subject_kind = 'ubm_export_proposal' and w.subject_id = $1::uuid
     order by s.step_order`,
    [proposalId],
  );
  const documents = await repos.db.query<{ document_id: string; export_mode: string }>(
    'select document_id, export_mode from ubm_export_documents where proposal_id = $1::uuid',
    [proposalId],
  );

  const includedFields = [...new Set(rows.flatMap((row) => Object.keys(row.payload)))];
  const dataCategories = [...new Set(rows.map((row) => row.entityKind))];

  const manifest = {
    packageKind: 'ubm_klar_manual_export',
    notOfficialUbmFormat: true,
    proposalNumber: proposal.proposalNumber,
    requestId: proposal.requestId ?? null,
    requestNumber: request?.requestNumber ?? null,
    domain: proposal.domain,
    schema: { key: proposal.schemaKey, version: proposal.schemaVersion },
    matchedSubjects: subjects.map((s) => ({
      subjectKind: s.subjectKind,
      matchStatus: s.matchStatus,
      matchConfidence: s.matchConfidence ?? null,
      // person ids are internal UUIDs — the payload rows carry the data itself
      personRef: s.personId ?? null,
    })),
    dataCategories,
    includedFields,
    excludedFields: ['personal_identity_number_masked_fields', 'internal_notes', 'audit_metadata'],
    legalBasis: request?.legalSourceKey ?? 'ej angiven',
    purpose: `Svar på UBM-förfrågan ${request?.requestNumber ?? ''}`.trim(),
    dataClassification: 'sensitive_personal_data',
    secrecyAssessment: reviews.some((r) => r.review_kind === 'legal' && r.decision === 'approved')
      ? 'legal_review_approved'
      : 'not_reviewed',
    documents: documents.rows.map((d) => ({
      documentId: d.document_id,
      exportMode: d.export_mode,
    })),
    redactionPlan: documents.rows.some((d) => d.export_mode === 'redacted_document')
      ? 'redacted_copies_included'
      : 'references_only',
    dataLineage: 'row_level_lineage_via_import_staging',
    eligibility: {
      outcome: proposal.eligibilityOutcome,
      explanations: proposal.eligibilityExplanations,
    },
    riskWarnings: proposal.eligibilityExplanations.filter((e) => /krävs|blocker|saknar/i.test(e)),
    reviewerComments: reviews.map((r) => ({
      kind: r.review_kind,
      decision: r.decision,
      comment: r.comment,
    })),
    approverHistory: approvals.rows.map((a) => ({
      workflowKind: a.kind,
      status: a.status,
      decision: a.decision,
      comment: a.comment,
      decidedAt: a.decided_at?.toISOString() ?? null,
    })),
    signatureStatus: 'unsigned_manual_pilot',
    generatedBy: 'UBM Klar (fristående produkt, ej Utbetalningsmyndigheten)',
  };

  const dataJson = JSON.stringify(
    rows.map((row) => ({
      entityKind: row.entityKind,
      personRef: row.personId ?? null,
      data: row.payload,
    })),
    null,
    2,
  );
  const manifestJson = JSON.stringify(manifest, null, 2);
  const summary = [
    `# Exportsammanfattning — ${proposal.proposalNumber}`,
    '',
    `- Förfrågan: ${request?.requestNumber ?? '—'}`,
    `- Område: ${proposal.domain === 'lss' ? 'LSS' : 'Ekonomiskt bistånd'}`,
    `- Antal datarader: ${rows.length}`,
    `- Datakategorier: ${dataCategories.join(', ') || 'inga'}`,
    `- Lämplighetsutfall: ${proposal.eligibilityOutcome}`,
    `- Rättslig grund: ${manifest.legalBasis}`,
    `- Signaturstatus: ${manifest.signatureStatus}`,
    '',
    'Paketet är skapat av UBM Klar för MANUELL leverans. UBM Klar är en fristående',
    'produkt och paketet är inte i officiellt Utbetalningsmyndighets-format.',
  ].join('\n');

  const manifestHash = sha256(manifestJson);
  const dataHash = sha256(dataJson);
  const checksums = [`${manifestHash}  manifest.json`, `${dataHash}  data.json`].join('\n') + '\n';

  const zip = buildZipArchive([
    { fileName: 'manifest.json', data: Buffer.from(manifestJson) },
    { fileName: 'data.json', data: Buffer.from(dataJson) },
    { fileName: 'export-summary.md', data: Buffer.from(summary) },
    { fileName: 'checksums.txt', data: Buffer.from(checksums) },
  ]);
  return { manifest, manifestJson, manifestHash, zip, zipHash: sha256(zip), rowCount: rows.length };
}

export function registerExportRoutes(app: FastifyInstance, options: ExportRoutesOptions): void {
  const { auditLogger, requirePermission } = options;

  app.get<{ Params: { id: string } }>('/ubm/export-proposals/:id', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.request.read')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const proposal = await repos.exportProposals.getById(request.params.id);
    if (!proposal) return reply.status(404).send({ error: 'proposal_not_found' });
    const [rows, workflow, submissions] = await Promise.all([
      repos.exportProposals.listRows(proposal.id),
      repos.db.query<{ id: string; status: string; created_by: string }>(
        `select id, status, created_by from approval_workflows
         where subject_kind = 'ubm_export_proposal' and subject_id = $1::uuid
         order by created_at desc limit 1`,
        [proposal.id],
      ),
      repos.db.query<{
        id: string;
        submission_number: string;
        status: string;
        manifest_hash_sha256: string;
        sent_at: Date | null;
      }>(
        'select id, submission_number, status, manifest_hash_sha256, sent_at from ubm_submissions where proposal_id = $1::uuid',
        [proposal.id],
      ),
    ]);
    await repos.dataAccess.insert({
      actorUserId: await repos.users.ensureUserProfile(request.subject!.userId),
      accessKind: 'export_view',
      caseKind: 'ubm_export_proposal',
      caseId: proposal.id,
      sessionKind: request.subject!.sessionKind,
    });
    return {
      proposal,
      rows: rows.map((row) => ({ entityKind: row.entityKind, fields: Object.keys(row.payload) })),
      rowCount: rows.length,
      workflow: workflow.rows[0] ?? null,
      submissions: submissions.rows.map((s) => ({
        id: s.id,
        submissionNumber: s.submission_number,
        status: s.status,
        manifestHash: s.manifest_hash_sha256,
        sentAt: s.sent_at?.toISOString() ?? null,
      })),
    };
  });

  app.post<{ Params: { id: string } }>(
    '/ubm/export-proposals/:id/submit-for-review',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'ubm.proposal.create')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const proposal = await repos.exportProposals.getById(request.params.id);
      if (!proposal) return reply.status(404).send({ error: 'proposal_not_found' });
      if (proposal.status !== 'draft') {
        return reply.status(409).send({
          error: 'not_submittable',
          message:
            proposal.status === 'eligibility_blocked'
              ? 'Förslaget är blockerat av lämplighetsprövningen och kan inte skickas till granskning. Åtgärda blockeringarna först.'
              : `Förslaget har status ${proposal.status}.`,
        });
      }
      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
      const workflow = await repos.db.query<{ id: string }>(
        `insert into approval_workflows (kind, subject_kind, subject_id, created_by)
         values ('ubm_export', 'ubm_export_proposal', $1::uuid, $2::uuid) returning id`,
        [proposal.id, profileId],
      );
      await repos.db.query(
        `insert into approval_steps (workflow_id, step_order, required_role) values ($1::uuid, 1, 'ubm_export_manager')`,
        [workflow.rows[0]!.id],
      );
      await repos.exportProposals.updateStatus(proposal.id, 'in_review', workflow.rows[0]!.id);
      await auditLogger.record({
        eventKey: 'export.proposal_created',
        actorUserId: request.subject!.userId,
        subjectKind: 'ubm_export_proposal',
        subjectId: proposal.id,
        action: 'submitted_for_review',
        context: { workflowId: workflow.rows[0]!.id, correlationId: request.correlationId },
      });
      return { workflowId: workflow.rows[0]!.id, status: 'in_review' };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { decision: 'approved' | 'rejected' | 'returned_for_changes'; comment?: string };
  }>('/ubm/export-proposals/:id/approve', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.export.approve')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const proposal = await repos.exportProposals.getById(request.params.id);
    if (!proposal) return reply.status(404).send({ error: 'proposal_not_found' });
    if (proposal.status !== 'in_review') {
      return reply
        .status(409)
        .send({ error: 'not_in_review', message: `Förslaget har status ${proposal.status}.` });
    }
    const workflow = await repos.db.query<{ id: string; created_by: string; status: string }>(
      `select id, created_by, status from approval_workflows
       where subject_kind = 'ubm_export_proposal' and subject_id = $1::uuid and status = 'pending'
       order by created_at desc limit 1`,
      [proposal.id],
    );
    if (!workflow.rows[0]) return reply.status(409).send({ error: 'no_pending_workflow' });
    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    if (workflow.rows[0].created_by === profileId) {
      // Maker-checker: also enforced by the database trigger.
      return reply.status(422).send({
        error: 'maker_cannot_approve',
        message: 'Fyra-ögon-principen: den som skapade förslaget kan inte godkänna det själv.',
      });
    }
    try {
      await repos.db.withTransaction(async (tx) => {
        await tx.query(
          `update approval_steps set decision = $2, decided_by = $3::uuid, decided_at = now(), comment = $4
           where workflow_id = $1::uuid and step_order = 1`,
          [workflow.rows[0]!.id, request.body.decision, profileId, request.body.comment ?? null],
        );
        await tx.query(
          `update approval_workflows set status = $2, closed_at = now() where id = $1::uuid`,
          [workflow.rows[0]!.id, request.body.decision],
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/maker|approver|creator/i.test(message)) {
        return reply
          .status(422)
          .send({ error: 'maker_cannot_approve', message: 'Fyra-ögon-principen (DB-spärr).' });
      }
      throw error;
    }
    const nextStatus = request.body.decision === 'approved' ? 'approved' : 'rejected';
    await repos.exportProposals.updateStatus(proposal.id, nextStatus);
    if (proposal.requestId && request.body.decision === 'approved') {
      const ubmRequest = await repos.ubmRequests.getById(proposal.requestId);
      if (ubmRequest && ['proposal_created', 'in_review'].includes(ubmRequest.status)) {
        if (ubmRequest.status === 'proposal_created') {
          await repos.ubmRequests.updateStatus(ubmRequest.id, 'in_review');
        }
        await repos.ubmRequests.updateStatus(ubmRequest.id, 'approved');
      }
    }
    await auditLogger.record({
      eventKey: 'export.approved',
      actorUserId: request.subject!.userId,
      subjectKind: 'ubm_export_proposal',
      subjectId: proposal.id,
      action: `export_${request.body.decision}`,
      ...(request.body.comment ? { reason: request.body.comment } : {}),
      context: { correlationId: request.correlationId },
    });
    return { status: nextStatus };
  });

  app.post<{ Params: { id: string } }>(
    '/ubm/export-proposals/:id/package',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'ubm.export.approve')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const proposal = await repos.exportProposals.getById(request.params.id);
      if (!proposal) return reply.status(404).send({ error: 'proposal_not_found' });
      if (proposal.status !== 'approved') {
        return reply.status(409).send({
          error: 'not_approved',
          message:
            proposal.status === 'eligibility_blocked'
              ? 'Blockerade förslag kan inte paketeras.'
              : `Paketering kräver godkänt förslag (status är ${proposal.status}).`,
        });
      }
      const content = await buildPackageContent(repos, proposal.id);
      const submissionNumber = `SUB-${proposal.proposalNumber}`;
      const existing = await repos.db.query<{ id: string }>(
        'select id from ubm_submissions where submission_number = $1',
        [submissionNumber],
      );
      if (existing.rows[0]) {
        return reply.status(409).send({ error: 'already_packaged' });
      }
      const submission = await repos.db.query<{ id: string }>(
        `insert into ubm_submissions
         (proposal_id, submission_number, package_manifest, manifest_hash_sha256, payload_hash_sha256, transport_profile, status)
       values ($1::uuid, $2, $3::jsonb, $4, $5, 'manual_download', 'packaged') returning id`,
        [
          proposal.id,
          submissionNumber,
          content.manifestJson,
          content.manifestHash,
          content.zipHash,
        ],
      );
      await repos.exportProposals.updateStatus(proposal.id, 'packaged');
      await auditLogger.record({
        eventKey: 'export.packaged',
        actorUserId: request.subject!.userId,
        subjectKind: 'ubm_export_proposal',
        subjectId: proposal.id,
        action: 'package_created',
        context: {
          submissionId: submission.rows[0]!.id,
          manifestHash: content.manifestHash,
          packageHash: content.zipHash,
          rowCount: content.rowCount,
          correlationId: request.correlationId,
        },
      });
      return reply.status(201).send({
        submissionId: submission.rows[0]!.id,
        submissionNumber,
        manifestHash: content.manifestHash,
        packageHash: content.zipHash,
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/ubm/export-proposals/:id/download',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'ubm.export.send')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const proposal = await repos.exportProposals.getById(request.params.id);
      if (!proposal) return reply.status(404).send({ error: 'proposal_not_found' });
      const submission = await repos.db.query<{
        id: string;
        payload_hash_sha256: string;
        status: string;
      }>(
        'select id, payload_hash_sha256, status from ubm_submissions where proposal_id = $1::uuid order by created_at desc limit 1',
        [proposal.id],
      );
      if (!submission.rows[0]) {
        return reply
          .status(409)
          .send({ error: 'not_packaged', message: 'Förslaget är inte paketerat.' });
      }
      // Rebuild deterministically and verify integrity against the recorded hash.
      const content = await buildPackageContent(repos, proposal.id);
      if (content.zipHash !== submission.rows[0].payload_hash_sha256) {
        return reply.status(500).send({
          error: 'package_integrity_failure',
          message:
            'Paketets innehåll matchar inte den registrerade kontrollsumman. Nedladdning stoppad.',
        });
      }
      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
      await repos.dataAccess.insert({
        actorUserId: profileId,
        accessKind: 'export_view',
        caseKind: 'ubm_export_proposal',
        caseId: proposal.id,
        reason: 'nedladdning av exportpaket',
        sessionKind: request.subject!.sessionKind,
      });
      await auditLogger.record({
        eventKey: 'export.downloaded',
        actorUserId: request.subject!.userId,
        subjectKind: 'ubm_export_proposal',
        subjectId: proposal.id,
        action: 'package_downloaded',
        context: { packageHash: content.zipHash, correlationId: request.correlationId },
      });
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${proposal.proposalNumber}.zip"`)
        .send(content.zip);
    },
  );

  app.post<{
    Params: { id: string };
    Body: { channel: string; recipientReference?: string };
  }>('/ubm/export-proposals/:id/register-sending', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.export.send')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const proposal = await repos.exportProposals.getById(request.params.id);
    if (!proposal) return reply.status(404).send({ error: 'proposal_not_found' });
    if (proposal.status !== 'packaged') {
      return reply.status(409).send({ error: 'not_packaged' });
    }
    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    await repos.db.query(
      `update ubm_submissions set status = 'sent', sent_by = $2::uuid, sent_at = now()
       where proposal_id = $1::uuid`,
      [proposal.id, profileId],
    );
    await repos.exportProposals.updateStatus(proposal.id, 'sent');
    if (proposal.requestId) {
      const ubmRequest = await repos.ubmRequests.getById(proposal.requestId);
      if (ubmRequest?.status === 'approved') {
        await repos.ubmRequests.updateStatus(ubmRequest.id, 'exported');
      }
    }
    await auditLogger.record({
      eventKey: 'ubm.export_sent',
      actorUserId: request.subject!.userId,
      subjectKind: 'ubm_export_proposal',
      subjectId: proposal.id,
      action: 'manual_sending_registered',
      context: {
        channel: request.body.channel,
        recipientReference: request.body.recipientReference ?? null,
        correlationId: request.correlationId,
      },
    });
    return { status: 'sent' };
  });

  app.post<{
    Params: { id: string };
    Body: {
      receiptReference: string;
      receiptKind?:
        'manual_confirmation' | 'transport_receipt' | 'processing_receipt' | 'error_receipt';
    };
  }>('/ubm/export-proposals/:id/receipt', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.export.send')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const proposal = await repos.exportProposals.getById(request.params.id);
    if (!proposal) return reply.status(404).send({ error: 'proposal_not_found' });
    const submission = await repos.db.query<{ id: string; status: string }>(
      'select id, status from ubm_submissions where proposal_id = $1::uuid order by created_at desc limit 1',
      [proposal.id],
    );
    if (!submission.rows[0] || submission.rows[0].status !== 'sent') {
      return reply.status(409).send({
        error: 'not_sent',
        message: 'Kvittens kan bara registreras efter manuell sändning.',
      });
    }
    await repos.db.withTransaction(async (tx) => {
      await tx.query(
        `insert into ubm_receipts (submission_id, receipt_kind, receipt_reference)
         values ($1::uuid, $2, $3)`,
        [
          submission.rows[0]!.id,
          request.body.receiptKind ?? 'manual_confirmation',
          request.body.receiptReference,
        ],
      );
      await tx.query(`update ubm_submissions set status = 'receipt_received' where id = $1::uuid`, [
        submission.rows[0]!.id,
      ]);
    });
    await repos.exportProposals.updateStatus(proposal.id, 'receipt_received');
    if (proposal.requestId) {
      const ubmRequest = await repos.ubmRequests.getById(proposal.requestId);
      if (ubmRequest?.status === 'exported') {
        await repos.ubmRequests.updateStatus(ubmRequest.id, 'receipt_received');
      }
    }
    await auditLogger.record({
      eventKey: 'export.receipt_registered',
      actorUserId: request.subject!.userId,
      subjectKind: 'ubm_export_proposal',
      subjectId: proposal.id,
      action: 'receipt_registered',
      context: {
        receiptReference: request.body.receiptReference,
        correlationId: request.correlationId,
      },
    });
    return { status: 'receipt_received' };
  });
}
