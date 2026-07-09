import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createControlCasesFromFlags, runPaymentControlRules } from '@ubm-klar/rule-run';
import type { PermissionKey } from '@ubm-klar/access-control';

/**
 * Payment control runs and the control case workflow. Every action is
 * audited and recorded in the case event trail.
 */

export interface ControlCaseRoutesOptions {
  requirePermission: (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: PermissionKey,
  ) => boolean;
}

export function registerControlCaseRoutes(
  app: FastifyInstance,
  options: ControlCaseRoutesOptions,
): void {
  const { requirePermission } = options;

  app.post<{ Body: { domain: 'lss' | 'economic_assistance'; dryRun?: boolean } }>(
    '/payment-control/run',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'payment.reconcile')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const domain = request.body.domain === 'economic_assistance' ? 'economic_assistance' : 'lss';
      const dryRun = request.body.dryRun ?? false;
      const result = await runPaymentControlRules(repos.db, domain, { dryRun });
      const casesCreated = dryRun ? 0 : await createControlCasesFromFlags(repos.db, domain);
      await request.auditLogger.record({
        eventKey: 'risk_rule.flag_created',
        actorUserId: request.subject!.userId,
        action: dryRun ? 'rule_run_dry' : 'rule_run',
        context: {
          domain,
          rulesEvaluated: result.rulesEvaluated,
          flagsCreated: result.flagsCreated,
          controlCasesCreated: casesCreated,
          correlationId: request.correlationId,
        },
      });
      return { ...result, controlCasesCreated: casesCreated };
    },
  );

  app.get<{ Params: { id: string } }>('/control-cases/:id', async (request, reply) => {
    if (!requirePermission(request, reply, 'case.control.read')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const controlCase = await repos.controlCases.getById(request.params.id);
    if (!controlCase) return reply.status(404).send({ error: 'case_not_found' });
    const [notes, events, flags] = await Promise.all([
      repos.controlCases.listNotes(controlCase.id),
      repos.controlCases.listEvents(controlCase.id),
      repos.db.query<{ id: string; rule_key: string; severity: string; explanation: string }>(
        'select id, rule_key, severity, explanation from risk_flags where control_case_id = $1::uuid',
        [controlCase.id],
      ),
    ]);
    await repos.dataAccess.insert({
      actorUserId: await repos.users.ensureUserProfile(request.subject!.userId),
      accessKind: 'case_open',
      caseKind: 'control_case',
      caseId: controlCase.id,
      ...(controlCase.personId ? { personId: controlCase.personId } : {}),
      sessionKind: request.subject!.sessionKind,
    });
    return {
      case: controlCase,
      notes,
      events,
      flags: flags.rows.map((row) => ({
        id: row.id,
        ruleKey: row.rule_key,
        severity: row.severity,
        explanation: row.explanation,
      })),
    };
  });

  app.post<{ Params: { id: string }; Body: { assigneeSubjectId: string } }>(
    '/control-cases/:id/assign',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'case.control.write')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const controlCase = await repos.controlCases.getById(request.params.id);
      if (!controlCase) return reply.status(404).send({ error: 'case_not_found' });
      const actorProfile = await repos.users.ensureUserProfile(request.subject!.userId);
      const assigneeProfile = await repos.users.ensureUserProfile(request.body.assigneeSubjectId);
      await repos.controlCases.assign(controlCase.id, assigneeProfile, actorProfile);
      await request.auditLogger.record({
        eventKey: 'control_case.action',
        actorUserId: request.subject!.userId,
        subjectKind: 'control_case',
        subjectId: controlCase.id,
        action: 'case_assigned',
        context: { correlationId: request.correlationId },
      });
      return { status: 'assigned' };
    },
  );

  app.post<{ Params: { id: string }; Body: { note: string } }>(
    '/control-cases/:id/notes',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'case.control.write')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const controlCase = await repos.controlCases.getById(request.params.id);
      if (!controlCase) return reply.status(404).send({ error: 'case_not_found' });
      if (!request.body.note?.trim()) return reply.status(400).send({ error: 'note_required' });
      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
      await repos.controlCases.addNote(controlCase.id, profileId, request.body.note.trim());
      await request.auditLogger.record({
        eventKey: 'control_case.action',
        actorUserId: request.subject!.userId,
        subjectKind: 'control_case',
        subjectId: controlCase.id,
        action: 'note_added',
        context: { correlationId: request.correlationId },
      });
      return { status: 'noted' };
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      status: 'investigating' | 'awaiting_decision' | 'closed' | 'reopened';
      detail?: string;
    };
  }>('/control-cases/:id/transition', async (request, reply) => {
    if (!requirePermission(request, reply, 'case.control.write')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const controlCase = await repos.controlCases.getById(request.params.id);
    if (!controlCase) return reply.status(404).send({ error: 'case_not_found' });
    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    const updated = await repos.controlCases.updateStatus(
      controlCase.id,
      request.body.status,
      profileId,
      request.body.detail,
    );
    await request.auditLogger.record({
      eventKey: 'control_case.action',
      actorUserId: request.subject!.userId,
      subjectKind: 'control_case',
      subjectId: controlCase.id,
      action: `case_${request.body.status}`,
      context: { correlationId: request.correlationId },
    });
    return updated;
  });

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
      note?: string;
    };
  }>('/control-cases/:id/outcome', async (request, reply) => {
    if (!requirePermission(request, reply, 'case.control.decide')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const controlCase = await repos.controlCases.getById(request.params.id);
    if (!controlCase) return reply.status(404).send({ error: 'case_not_found' });
    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    await repos.controlCases.registerOutcome(
      controlCase.id,
      request.body.outcome,
      request.body.note,
      profileId,
    );
    await request.auditLogger.record({
      eventKey: 'control_case.action',
      actorUserId: request.subject!.userId,
      subjectKind: 'control_case',
      subjectId: controlCase.id,
      action: `outcome_${request.body.outcome}`,
      ...(request.body.note ? { reason: request.body.note } : {}),
      context: { correlationId: request.correlationId },
    });
    return { status: 'decided', outcome: request.body.outcome };
  });
}
