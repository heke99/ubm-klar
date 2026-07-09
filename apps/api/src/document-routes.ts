import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  BUCKET_POLICIES,
  validateUpload,
  type BucketKey,
  type DocumentStorage,
  type MalwareScanner,
} from '@ubm-klar/document-vault';
import { applyRedaction, planRedaction } from '@ubm-klar/redaction-engine';
import type { AuditLogger } from '@ubm-klar/audit';
import type { PermissionKey } from '@ubm-klar/access-control';

/**
 * Document vault routes: upload with mandatory malware scanning, classified
 * open-with-reason (always access-logged), and the redaction workflow
 * (plan -> preview -> apply -> separately stored redacted copy).
 */

export interface DocumentRoutesOptions {
  auditLogger: AuditLogger;
  requirePermission: (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: PermissionKey,
  ) => boolean;
  storage: DocumentStorage;
  scanner: MalwareScanner;
  /** True when the runtime is production-like (stage/prod). */
  isProductionLike: boolean;
  scannerProvider: string;
}

const SENSITIVE_CLASSES = ['sensitive', 'medical', 'protected_identity', 'children'];

const ACCESS_KIND_BY_CLASS: Record<string, string> = {
  medical: 'medical_data_view',
  protected_identity: 'protected_identity_view',
  children: 'children_data_view',
};

export function registerDocumentRoutes(app: FastifyInstance, options: DocumentRoutesOptions): void {
  const { auditLogger, requirePermission, storage, scanner } = options;

  app.post<{
    Body: {
      fileName: string;
      contentBase64: string;
      mimeType: string;
      bucketKey: BucketKey;
      documentType: string;
      documentClass?: string;
      personId?: string;
      caseKind?: string;
      caseId?: string;
    };
  }>('/documents', async (request, reply) => {
    if (!requirePermission(request, reply, 'document.read')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const body = request.body;
    if (!BUCKET_POLICIES[body.bucketKey]) {
      return reply.status(400).send({ error: 'unknown_bucket' });
    }
    // Defense in depth: production must never run with a disabled scanner
    // (loadAppConfig blocks it at startup as well).
    if (options.isProductionLike && options.scannerProvider === 'disabled-local') {
      return reply.status(503).send({
        error: 'scanner_unavailable',
        message: 'Virusskanning är inte konfigurerad — uppladdning är stoppad i produktion.',
      });
    }

    const content = Buffer.from(body.contentBase64, 'base64');
    const validation = validateUpload({
      bucketKey: body.bucketKey,
      fileName: body.fileName,
      mimeType: body.mimeType,
      content,
      documentType: body.documentType,
      uploadedBy: request.subject!.userId,
    });
    if (!validation.ok) {
      return reply.status(422).send({ error: 'upload_invalid', messages: validation.errors });
    }

    const scanStatus = await scanner.scan(content, body.fileName);
    if (scanStatus === 'infected') {
      await auditLogger.record({
        eventKey: 'document.upload',
        actorUserId: request.subject!.userId,
        action: 'upload_blocked_infected',
        outcome: 'denied',
        context: { fileName: body.fileName, correlationId: request.correlationId },
      });
      return reply.status(422).send({
        error: 'infected',
        message: 'Filen stoppades av virusskanningen och har inte sparats.',
      });
    }
    if (scanStatus === 'scan_failed' && options.isProductionLike) {
      return reply.status(503).send({
        error: 'scan_failed',
        message: 'Virusskanningen kunde inte genomföras — försök igen senare.',
      });
    }

    const storagePath = `${body.bucketKey}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${body.fileName}`;
    await storage.put(storagePath, content, body.mimeType);

    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    await repos.documents.ensureBucket(body.bucketKey);
    const document = await repos.documents.create({
      bucketKey: body.bucketKey,
      storagePath,
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileSizeBytes: content.length,
      fileHashSha256: validation.fileHashSha256,
      documentType: body.documentType,
      documentClass: body.documentClass ?? 'standard',
      ...(body.personId ? { personId: body.personId } : {}),
      ...(body.caseKind ? { caseKind: body.caseKind } : {}),
      ...(body.caseId ? { caseId: body.caseId } : {}),
      malwareScanStatus: scanStatus,
      uploadedBy: profileId,
    });
    await auditLogger.record({
      eventKey: 'document.upload',
      actorUserId: request.subject!.userId,
      subjectKind: 'document',
      subjectId: document.id,
      action: 'document_uploaded',
      context: {
        bucketKey: body.bucketKey,
        documentClass: document.documentClass,
        scanStatus,
        storageProvider: storage.provider,
        correlationId: request.correlationId,
      },
    });
    return reply.status(201).send(document);
  });

  app.get<{ Params: { id: string } }>('/documents/:id', async (request, reply) => {
    if (!requirePermission(request, reply, 'document.read')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const document = await repos.documents.getById(request.params.id);
    if (!document) return reply.status(404).send({ error: 'document_not_found' });
    const redactions = await repos.db.query<{
      id: string;
      status: string;
      redacted_document_id: string | null;
    }>(
      'select id, status, redacted_document_id from document_redaction_jobs where document_id = $1::uuid',
      [document.id],
    );
    return {
      document,
      redactionJobs: redactions.rows.map((r) => ({
        id: r.id,
        status: r.status,
        redactedDocumentId: r.redacted_document_id,
      })),
      reasonRequiredToOpen: SENSITIVE_CLASSES.includes(document.documentClass),
    };
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/documents/:id/open',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'document.download')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const document = await repos.documents.getById(request.params.id);
      if (!document) return reply.status(404).send({ error: 'document_not_found' });

      const sensitive = SENSITIVE_CLASSES.includes(document.documentClass);
      const reason = request.body?.reason?.trim();
      if (sensitive && !reason) {
        return reply.status(422).send({
          error: 'reason_required',
          message: `Dokumentet är klassat som ${document.documentClass}: ange skäl för att öppna det. Åtkomsten loggas alltid.`,
        });
      }

      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
      // Data access log ALWAYS (also for non-sensitive classes).
      await repos.dataAccess.insert({
        actorUserId: profileId,
        accessKind: ACCESS_KIND_BY_CLASS[document.documentClass] ?? 'document_open',
        documentId: document.id,
        ...(document.personId ? { personId: document.personId } : {}),
        ...(reason ? { reason } : {}),
        sessionKind: request.subject!.sessionKind,
      });
      await repos.db.query(
        `insert into document_access_events (document_id, actor_user_id, access_kind, reason, session_kind)
         values ($1::uuid, $2::uuid, 'open', $3, $4)`,
        [document.id, profileId, reason ?? null, request.subject!.sessionKind],
      );
      await auditLogger.record({
        eventKey: 'document.open',
        actorUserId: request.subject!.userId,
        subjectKind: 'document',
        subjectId: document.id,
        action: 'document_opened',
        ...(reason ? { reason } : {}),
        context: { documentClass: document.documentClass, correlationId: request.correlationId },
      });

      const content = await storage.get(document.storagePath);
      return reply
        .header('content-type', document.mimeType)
        .header('content-disposition', `attachment; filename="${document.fileName}"`)
        .send(Buffer.from(content));
    },
  );

  app.post<{ Params: { id: string } }>('/documents/:id/redaction/plan', async (request, reply) => {
    if (!requirePermission(request, reply, 'document.redact')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const document = await repos.documents.getById(request.params.id);
    if (!document) return reply.status(404).send({ error: 'document_not_found' });
    if (document.isRedactedVersion) {
      return reply.status(409).send({ error: 'already_redacted_copy' });
    }
    if (document.mimeType !== 'text/plain') {
      return reply.status(422).send({
        error: 'NOT_IMPLEMENTED',
        message:
          'Automatisk maskning stöds för textdokument i piloten. Andra format maskas manuellt och laddas upp som maskerad kopia.',
      });
    }
    const content = Buffer.from(await storage.get(document.storagePath)).toString('utf8');
    const plan = planRedaction(document.id, content);
    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    const job = await repos.db.query<{ id: string }>(
      `insert into document_redaction_jobs (document_id, requested_by, redaction_plan, status)
       values ($1::uuid, $2::uuid, $3::jsonb, 'queued') returning id`,
      [document.id, profileId, JSON.stringify(plan)],
    );
    await repos.documents.updateRedactionStatus(document.id, 'in_progress');
    return reply.status(201).send({
      jobId: job.rows[0]!.id,
      plan: {
        matchCount: plan.ranges.length,
        kinds: [...new Set(plan.ranges.map((r) => r.label))],
        rulesApplied: plan.rulesApplied,
      },
    });
  });

  app.post<{ Params: { id: string }; Body: { jobId: string } }>(
    '/documents/:id/redaction/apply',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'document.redact')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const document = await repos.documents.getById(request.params.id);
      if (!document) return reply.status(404).send({ error: 'document_not_found' });
      const job = await repos.db.query<{ id: string; status: string }>(
        'select id, status from document_redaction_jobs where id = $1::uuid and document_id = $2::uuid',
        [request.body.jobId, document.id],
      );
      if (!job.rows[0]) return reply.status(404).send({ error: 'job_not_found' });
      if (job.rows[0].status !== 'queued') {
        return reply.status(409).send({ error: 'job_not_queued' });
      }

      const original = Buffer.from(await storage.get(document.storagePath)).toString('utf8');
      const plan = planRedaction(document.id, original);
      const result = applyRedaction(original, plan);

      // Verification: no personnummer/bank patterns may survive in the copy.
      if (!result.verified) {
        await repos.db.query(
          `update document_redaction_jobs set status = 'failed', error_code = 'VERIFICATION_FAILED', finished_at = now()
           where id = $1::uuid`,
          [job.rows[0].id],
        );
        return reply.status(500).send({
          error: 'redaction_verification_failed',
          message: 'Maskningen kunde inte verifieras — den maskade kopian har inte sparats.',
        });
      }

      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
      const redactedContent = Buffer.from(result.redactedText, 'utf8');
      const redactedPath = `documents-redacted/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-redacted-${document.fileName}`;
      await storage.put(redactedPath, redactedContent, 'text/plain');
      await repos.documents.ensureBucket('documents-redacted');
      const redactedDocument = await repos.documents.create({
        bucketKey: 'documents-redacted',
        storagePath: redactedPath,
        fileName: `maskerad-${document.fileName}`,
        mimeType: 'text/plain',
        fileSizeBytes: redactedContent.length,
        fileHashSha256: createHash('sha256').update(redactedContent).digest('hex'),
        documentType: document.documentType,
        documentClass: 'disclosure',
        ...(document.personId ? { personId: document.personId } : {}),
        malwareScanStatus: 'clean',
        isRedactedVersion: true,
        originalDocumentId: document.id,
        redactionStatus: 'completed',
        uploadedBy: profileId,
      });
      await repos.db.withTransaction(async (tx) => {
        await tx.query(
          `update document_redaction_jobs set status = 'completed', redacted_document_id = $2::uuid, finished_at = now()
           where id = $1::uuid`,
          [request.body.jobId, redactedDocument.id],
        );
      });
      await repos.documents.updateRedactionStatus(document.id, 'completed');
      await repos.db.query(
        `insert into document_access_events (document_id, actor_user_id, access_kind, reason, session_kind)
         values ($1::uuid, $2::uuid, 'redact', 'maskning', $3)`,
        [document.id, profileId, request.subject!.sessionKind],
      );
      await auditLogger.record({
        eventKey: 'document.redaction',
        actorUserId: request.subject!.userId,
        subjectKind: 'document',
        subjectId: document.id,
        action: 'redacted_copy_created',
        context: {
          redactedDocumentId: redactedDocument.id,
          maskedItems: result.maskedCount,
          correlationId: request.correlationId,
        },
      });
      return reply.status(201).send({
        redactedDocumentId: redactedDocument.id,
        maskedItems: result.maskedCount,
        verified: result.verified,
      });
    },
  );
}
