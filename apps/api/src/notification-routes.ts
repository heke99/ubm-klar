import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PermissionKey } from '@ubm-klar/access-control';

/**
 * Incoming UBM notifications — MANUAL intake only. There is no official
 * digital channel: notifications are registered by hand, matched against the
 * data plane, optionally become control cases, and outcomes are recorded.
 * Outgoing outcome reporting is manual until an official transport exists.
 */

export interface NotificationRoutesOptions {
  requirePermission: (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: PermissionKey,
  ) => boolean;
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  options: NotificationRoutesOptions,
): void {
  const { requirePermission } = options;

  app.post<{
    Body: {
      notificationNumber: string;
      receivedAt: string;
      domain?: 'lss' | 'economic_assistance' | 'other' | 'unknown';
      summary: string;
      personnummer?: string;
    };
  }>('/ubm/notifications', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.notification.handle')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const body = request.body;
    if (!body.notificationNumber?.trim() || !body.summary?.trim()) {
      return reply.status(400).send({ error: 'missing_fields' });
    }
    const notification = await repos.notifications.create({
      notificationNumber: body.notificationNumber.trim(),
      intakeChannel: 'manual_registration',
      receivedAt: body.receivedAt || new Date().toISOString(),
      domain: body.domain ?? 'unknown',
      summary: body.summary.trim(),
    });
    await request.auditLogger.record({
      eventKey: 'ubm.notification_handled',
      actorUserId: request.subject!.userId,
      subjectKind: 'ubm_notification',
      subjectId: notification.id,
      action: 'notification_registered',
      context: {
        notificationNumber: notification.notificationNumber,
        correlationId: request.correlationId,
      },
    });
    return reply.status(201).send(notification);
  });

  app.get<{ Params: { id: string } }>('/ubm/notifications/:id', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.notification.handle')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const notification = await repos.notifications.getById(request.params.id);
    if (!notification) return reply.status(404).send({ error: 'notification_not_found' });
    const [scores, outcomes] = await Promise.all([
      repos.db.query<{
        candidate_kind: string;
        candidate_id: string;
        score: string;
        score_basis: string;
        selected: boolean;
      }>(
        'select candidate_kind, candidate_id, score, score_basis, selected from ubm_notification_confidence_scores where notification_id = $1::uuid',
        [notification.id],
      ),
      repos.db.query<{ outcome: string; detail: string | null; decided_at: Date }>(
        'select outcome, detail, decided_at from ubm_notification_outcomes where notification_id = $1::uuid',
        [notification.id],
      ),
    ]);
    await repos.dataAccess.insert({
      actorUserId: await repos.users.ensureUserProfile(request.subject!.userId),
      accessKind: 'case_open',
      caseKind: 'ubm_notification',
      caseId: notification.id,
      sessionKind: request.subject!.sessionKind,
    });
    return {
      notification,
      candidates: scores.rows.map((row) => ({
        candidateKind: row.candidate_kind,
        candidateId: row.candidate_id,
        score: Number(row.score),
        scoreBasis: row.score_basis,
        selected: row.selected,
      })),
      outcomes: outcomes.rows.map((row) => ({
        outcome: row.outcome,
        detail: row.detail,
        decidedAt: row.decided_at.toISOString(),
      })),
      outgoingReporting:
        'Manuell återrapportering: officiell UBM-transport finns inte — utfall rapporteras via den kanal myndigheten anvisar.',
    };
  });

  app.post<{ Params: { id: string }; Body: { personnummer: string } }>(
    '/ubm/notifications/:id/match',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'ubm.notification.handle')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const notification = await repos.notifications.getById(request.params.id);
      if (!notification) return reply.status(404).send({ error: 'notification_not_found' });
      const personnummer = request.body.personnummer?.replace(/\s/g, '');
      if (!personnummer) return reply.status(400).send({ error: 'missing_personnummer' });

      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
      await repos.dataAccess.insert({
        actorUserId: profileId,
        accessKind: 'person_search',
        caseKind: 'ubm_notification',
        caseId: notification.id,
        reason: `Underrättelse ${notification.notificationNumber}`,
        sessionKind: request.subject!.sessionKind,
      });

      const person = await repos.db.query<{ id: string }>(
        'select id from persons where personal_identity_number = $1',
        [personnummer],
      );
      if (person.rows[0]) {
        await repos.notifications.addConfidenceScore({
          notificationId: notification.id,
          candidateKind: 'person',
          candidateId: person.rows[0].id,
          score: 1.0,
          scoreBasis: 'exakt personnummermatchning',
          selected: true,
        });
        // Related cases/payments strengthen the match basis.
        const related = await repos.db.query<{ payments: string; cases: string }>(
          `select
             (select count(*) from lss_payments where person_id = $1::uuid) +
             (select count(*) from ea_payments where person_id = $1::uuid) as payments,
             (select count(*) from control_cases where person_id = $1::uuid) as cases`,
          [person.rows[0].id],
        );
        await repos.notifications.updateStatus(notification.id, 'matched', {
          subjectPersonId: person.rows[0].id,
        });
        await request.auditLogger.record({
          eventKey: 'ubm.notification_handled',
          actorUserId: request.subject!.userId,
          subjectKind: 'ubm_notification',
          subjectId: notification.id,
          action: 'notification_matched',
          context: { confidence: 1.0, correlationId: request.correlationId },
        });
        return {
          matchStatus: 'matched',
          confidence: 1.0,
          relatedPayments: Number(related.rows[0]?.payments ?? 0),
          relatedCases: Number(related.rows[0]?.cases ?? 0),
        };
      }

      await repos.notifications.updateStatus(notification.id, 'manual_review');
      await request.auditLogger.record({
        eventKey: 'ubm.notification_handled',
        actorUserId: request.subject!.userId,
        subjectKind: 'ubm_notification',
        subjectId: notification.id,
        action: 'notification_no_match',
        context: { correlationId: request.correlationId },
      });
      return {
        matchStatus: 'no_match',
        confidence: 0,
        message:
          'Ingen person med detta personnummer finns i dataplanet — manuell granskning krävs.',
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { title?: string } }>(
    '/ubm/notifications/:id/create-case',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'ubm.notification.handle')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const notification = await repos.notifications.getById(request.params.id);
      if (!notification) return reply.status(404).send({ error: 'notification_not_found' });
      if (notification.controlCaseId) {
        return reply
          .status(409)
          .send({ error: 'case_already_exists', caseId: notification.controlCaseId });
      }
      const domain =
        notification.domain === 'lss' || notification.domain === 'economic_assistance'
          ? notification.domain
          : 'common';
      const controlCase = await repos.controlCases.create({
        caseNumber: `KA-UN-${notification.notificationNumber}`,
        sourceKind: 'ubm_notification',
        sourceReference: notification.id,
        domain,
        title: `UBM-underrättelse: ${notification.summary.slice(0, 150)}`,
        severity: 'high',
        ...(notification.subjectPersonId ? { personId: notification.subjectPersonId } : {}),
      });
      await repos.notifications.updateStatus(notification.id, 'case_created', {
        controlCaseId: controlCase.id,
      });
      await request.auditLogger.record({
        eventKey: 'ubm.notification_handled',
        actorUserId: request.subject!.userId,
        subjectKind: 'ubm_notification',
        subjectId: notification.id,
        action: 'control_case_created',
        context: { caseId: controlCase.id, correlationId: request.correlationId },
      });
      return reply.status(201).send({ caseId: controlCase.id, caseNumber: controlCase.caseNumber });
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      outcome:
        | 'recovery_claim'
        | 'payment_stopped'
        | 'no_action'
        | 'police_report'
        | 'corrected_source_data'
        | 'other_action';
      detail?: string;
    };
  }>('/ubm/notifications/:id/outcome', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.notification.handle')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const notification = await repos.notifications.getById(request.params.id);
    if (!notification) return reply.status(404).send({ error: 'notification_not_found' });
    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    await repos.notifications.registerOutcome({
      notificationId: notification.id,
      outcome: request.body.outcome,
      ...(request.body.detail ? { detail: request.body.detail } : {}),
      decidedBy: profileId,
    });
    await request.auditLogger.record({
      eventKey: 'ubm.notification_outcome',
      actorUserId: request.subject!.userId,
      subjectKind: 'ubm_notification',
      subjectId: notification.id,
      action: `outcome_${request.body.outcome}`,
      ...(request.body.detail ? { reason: request.body.detail } : {}),
      context: { correlationId: request.correlationId },
    });
    return {
      status: 'outcome_registered',
      note: 'Återrapportering till myndigheten sker manuellt — ingen officiell transport finns.',
    };
  });

  app.post<{ Params: { id: string } }>('/ubm/notifications/:id/close', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.notification.handle')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const notification = await repos.notifications.getById(request.params.id);
    if (!notification) return reply.status(404).send({ error: 'notification_not_found' });
    const updated = await repos.notifications.updateStatus(notification.id, 'closed');
    await request.auditLogger.record({
      eventKey: 'ubm.notification_handled',
      actorUserId: request.subject!.userId,
      subjectKind: 'ubm_notification',
      subjectId: notification.id,
      action: 'notification_closed',
      context: { correlationId: request.correlationId },
    });
    return updated;
  });
}
