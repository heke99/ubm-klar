import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ENABLED_INTAKE_CHANNELS,
  InvalidRequestTransitionError,
  transitionRequest,
  type UbmRequestStatus,
} from '@ubm-klar/ubm-obligation-engine';
import { evaluateUbmEligibility, type UbmEligibilityInput } from '@ubm-klar/ubm-eligibility-engine';

import type { PermissionKey } from '@ubm-klar/access-control';

/**
 * UBM request workflow (2026 request-based pilot):
 * manual registration -> validation -> subject matching -> data collection ->
 * eligibility -> export proposal. Packaging/approval live in export-routes.
 *
 * Official UBM transport does not exist: intake is manual/file only and the
 * response transport is manual download after maker-checker approval.
 */

export interface UbmRoutesOptions {
  requirePermission: (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: PermissionKey,
  ) => boolean;
}

export function registerUbmRoutes(app: FastifyInstance, options: UbmRoutesOptions): void {
  const { requirePermission } = options;

  app.post<{
    Body: {
      requestNumber: string;
      intakeChannel?: 'manual_registration' | 'file_upload';
      externalReference?: string;
      receivedAt: string;
      deadlineAt?: string;
      domain?: 'lss' | 'economic_assistance' | 'other' | 'unknown';
      legalSourceKey?: string;
      requestedItems?: Array<{ itemKey: string; description: string; requestedDataKind: string }>;
    };
  }>('/ubm/requests', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.request.register')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const body = request.body;
    const channel = body.intakeChannel ?? 'manual_registration';
    if (!ENABLED_INTAKE_CHANNELS.includes(channel)) {
      return reply.status(422).send({
        error: 'intake_channel_disabled',
        message:
          'Endast manuell registrering och filuppladdning är aktiverade. Officiell UBM-transport får inte antas existera.',
      });
    }
    if (!body.requestNumber?.trim() || !body.receivedAt) {
      return reply
        .status(400)
        .send({ error: 'missing_fields', message: 'Ärendenummer och mottagningsdatum krävs.' });
    }
    const repos = request.repositories;
    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    const created = await repos.ubmRequests.create({
      requestNumber: body.requestNumber.trim(),
      intakeChannel: channel,
      ...(body.externalReference ? { externalReference: body.externalReference } : {}),
      receivedAt: body.receivedAt,
      registeredBy: profileId,
      domain: body.domain ?? 'unknown',
      ...(body.deadlineAt ? { deadlineAt: body.deadlineAt } : {}),
      ...(body.legalSourceKey ? { legalSourceKey: body.legalSourceKey } : {}),
    });
    for (const item of body.requestedItems ?? []) {
      await repos.db.query(
        `insert into ubm_request_items (request_id, item_key, description, requested_data_kind)
         values ($1::uuid, $2, $3, $4)`,
        [created.id, item.itemKey, item.description, item.requestedDataKind],
      );
    }
    await request.auditLogger.record({
      eventKey: 'ubm.request_registered',
      actorUserId: request.subject!.userId,
      subjectKind: 'ubm_request',
      subjectId: created.id,
      action: 'request_registered',
      context: { requestNumber: created.requestNumber, correlationId: request.correlationId },
    });
    return reply.status(201).send(created);
  });

  app.get<{ Params: { id: string } }>('/ubm/requests/:id', async (request, reply) => {
    if (!requirePermission(request, reply, 'ubm.request.read')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const ubmRequest = await repos.ubmRequests.getById(request.params.id);
    if (!ubmRequest) return reply.status(404).send({ error: 'request_not_found' });
    const [subjects, proposals, items, reviews] = await Promise.all([
      repos.ubmRequests.listSubjects(ubmRequest.id),
      repos.exportProposals.list({ requestId: ubmRequest.id }),
      repos.db.query<{
        item_key: string;
        description: string;
        requested_data_kind: string;
        status: string;
      }>(
        'select item_key, description, requested_data_kind, status from ubm_request_items where request_id = $1::uuid',
        [ubmRequest.id],
      ),
      repos.db.query<{
        review_kind: string;
        decision: string | null;
        comment: string | null;
        reviewed_at: Date | null;
      }>(
        'select review_kind, decision, comment, reviewed_at from ubm_request_reviews where request_id = $1::uuid',
        [ubmRequest.id],
      ),
    ]);
    // Reading a UBM request opens case data: log it.
    await repos.dataAccess.insert({
      actorUserId: await repos.users.ensureUserProfile(request.subject!.userId),
      accessKind: 'case_open',
      caseKind: 'ubm_request',
      caseId: ubmRequest.id,
      sessionKind: request.subject!.sessionKind,
    });
    return {
      request: ubmRequest,
      subjects,
      proposals,
      items: items.rows,
      reviews: reviews.rows.map((r) => ({
        reviewKind: r.review_kind,
        decision: r.decision,
        comment: r.comment,
        reviewedAt: r.reviewed_at?.toISOString(),
      })),
    };
  });

  app.post<{ Params: { id: string }; Body: { to: UbmRequestStatus } }>(
    '/ubm/requests/:id/transition',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'ubm.request.register')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const ubmRequest = await repos.ubmRequests.getById(request.params.id);
      if (!ubmRequest) return reply.status(404).send({ error: 'request_not_found' });
      try {
        transitionRequest(ubmRequest.status, request.body.to);
      } catch (error) {
        if (error instanceof InvalidRequestTransitionError) {
          return reply.status(409).send({ error: 'invalid_transition', message: error.message });
        }
        throw error;
      }
      if (request.body.to === 'validated') {
        const subjects = await repos.ubmRequests.listSubjects(ubmRequest.id);
        const items = await repos.db.query(
          'select 1 from ubm_request_items where request_id = $1::uuid limit 1',
          [ubmRequest.id],
        );
        const problems: string[] = [];
        if (subjects.length === 0) problems.push('Förfrågan saknar angiven person.');
        if (items.rows.length === 0) problems.push('Förfrågan saknar specificerade uppgifter.');
        if (problems.length > 0) {
          return reply.status(422).send({ error: 'validation_failed', messages: problems });
        }
      }
      const updated = await repos.ubmRequests.updateStatus(ubmRequest.id, request.body.to);
      await request.auditLogger.record({
        eventKey: 'ubm.request_registered',
        actorUserId: request.subject!.userId,
        subjectKind: 'ubm_request',
        subjectId: ubmRequest.id,
        action: `request_transition_${request.body.to}`,
        context: { from: ubmRequest.status, correlationId: request.correlationId },
      });
      return updated;
    },
  );

  app.post<{ Params: { id: string }; Body: { personnummer: string } }>(
    '/ubm/requests/:id/subjects',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'ubm.request.register')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const ubmRequest = await repos.ubmRequests.getById(request.params.id);
      if (!ubmRequest) return reply.status(404).send({ error: 'request_not_found' });
      const personnummer = request.body.personnummer?.replace(/\s/g, '');
      if (!personnummer) return reply.status(400).send({ error: 'missing_personnummer' });

      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
      // Person search is always in the data access log.
      await repos.dataAccess.insert({
        actorUserId: profileId,
        accessKind: 'person_search',
        caseKind: 'ubm_request',
        caseId: ubmRequest.id,
        reason: `UBM-förfrågan ${ubmRequest.requestNumber}`,
        sessionKind: request.subject!.sessionKind,
      });

      const person = await repos.db.query<{
        id: string;
        protected_identity: boolean;
        is_minor: boolean;
      }>(
        'select id, protected_identity, is_minor from persons where personal_identity_number = $1',
        [personnummer],
      );
      const matched = person.rows[0];
      const subjectId = await repos.ubmRequests.addSubject({
        requestId: ubmRequest.id,
        subjectKind: 'person',
        ...(matched ? { personId: matched.id } : {}),
        matchStatus: matched ? 'matched' : 'not_found',
        ...(matched ? { matchConfidence: 1.0 } : {}),
        matchedBy: profileId,
      });
      await request.auditLogger.record({
        eventKey: 'ubm.request_registered',
        actorUserId: request.subject!.userId,
        subjectKind: 'ubm_request',
        subjectId: ubmRequest.id,
        action: matched ? 'subject_matched' : 'subject_not_found',
        context: {
          matchReason: matched ? 'exakt personnummermatchning' : 'personen finns inte i dataplanet',
          confidence: matched ? 1.0 : 0,
          correlationId: request.correlationId,
        },
      });
      return reply.status(201).send({
        subjectId,
        matchStatus: matched ? 'matched' : 'not_found',
        matchConfidence: matched ? 1.0 : 0,
        matchReason: matched
          ? 'Exakt personnummermatchning'
          : 'Ingen person med detta personnummer finns i dataplanet',
        protectedIdentity: matched?.protected_identity ?? false,
      });
    },
  );

  app.post<{ Params: { id: string; subjectId: string } }>(
    '/ubm/requests/:id/subjects/:subjectId/confirm',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'ubm.request.register')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
      await repos.db.query(
        `update ubm_request_subjects set match_status = 'manual', matched_by = $3::uuid, matched_at = now()
         where id = $2::uuid and request_id = $1::uuid`,
        [request.params.id, request.params.subjectId, profileId],
      );
      await request.auditLogger.record({
        eventKey: 'ubm.request_registered',
        actorUserId: request.subject!.userId,
        subjectKind: 'ubm_request',
        subjectId: request.params.id,
        action: 'subject_manually_confirmed',
        context: { correlationId: request.correlationId },
      });
      return { confirmed: true };
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      kind: 'legal' | 'dpo';
      decision: 'approved' | 'rejected' | 'needs_changes';
      comment?: string;
    };
  }>('/ubm/requests/:id/reviews', async (request, reply) => {
    const permission: PermissionKey = request.body.kind === 'legal' ? 'legal.review' : 'dpo.review';
    if (!requirePermission(request, reply, permission)) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const ubmRequest = await repos.ubmRequests.getById(request.params.id);
    if (!ubmRequest) return reply.status(404).send({ error: 'request_not_found' });
    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    await repos.db.query(
      `insert into ubm_request_reviews (request_id, review_kind, reviewer, decision, comment, reviewed_at)
       values ($1::uuid, $2, $3::uuid, $4, $5, now())`,
      [
        ubmRequest.id,
        request.body.kind,
        profileId,
        request.body.decision,
        request.body.comment ?? null,
      ],
    );
    await request.auditLogger.record({
      eventKey: 'export.legal_review',
      actorUserId: request.subject!.userId,
      subjectKind: 'ubm_request',
      subjectId: ubmRequest.id,
      action: `${request.body.kind}_review_${request.body.decision}`,
      ...(request.body.comment ? { reason: request.body.comment } : {}),
      context: { correlationId: request.correlationId },
    });
    return reply.status(201).send({ recorded: true });
  });

  /** Builds the eligibility input from the real database state. */
  async function buildEligibilityInput(
    repos: NonNullable<FastifyRequest['repositories']>,
    requestId: string,
    overrides: Partial<UbmEligibilityInput>,
  ): Promise<{ input: UbmEligibilityInput; matchedPersonIds: string[] }> {
    const ubmRequest = (await repos.ubmRequests.getById(requestId))!;
    const subjects = await repos.ubmRequests.listSubjects(requestId);
    const matchedPersonIds = subjects
      .filter((s) => (s.matchStatus === 'matched' || s.matchStatus === 'manual') && s.personId)
      .map((s) => s.personId!);

    let holdsData = false;
    let concernsDecisions = false;
    let relevantToPayment = false;
    let protectedIdentity = false;
    let childrenData = false;
    let lineageComplete = matchedPersonIds.length > 0;
    if (matchedPersonIds.length > 0) {
      const [personFlags, lssData, eaData, lineage] = await Promise.all([
        repos.db.query<{ protected_identity: boolean; is_minor: boolean }>(
          'select protected_identity, is_minor from persons where id = any($1::uuid[])',
          [matchedPersonIds],
        ),
        repos.db.query<{ decisions: string; payments: string }>(
          `select
             (select count(*) from lss_decisions where person_id = any($1::uuid[])) as decisions,
             (select count(*) from lss_payments where person_id = any($1::uuid[])) as payments`,
          [matchedPersonIds],
        ),
        repos.db.query<{ decisions: string; payments: string }>(
          `select
             (select count(*) from ea_decisions d join ea_household_members m on m.household_id = d.household_id
               where m.person_id = any($1::uuid[])) as decisions,
             (select count(*) from ea_payments where person_id = any($1::uuid[])) as payments`,
          [matchedPersonIds],
        ),
        repos.db.query<{ with_lineage: string }>(
          `select count(distinct committed_entity_id) as with_lineage from import_staging_rows
           where committed_entity_kind = 'person' and committed_entity_id = any($1::uuid[])`,
          [matchedPersonIds],
        ),
      ]);
      protectedIdentity = personFlags.rows.some((p) => p.protected_identity);
      childrenData = personFlags.rows.some((p) => p.is_minor);
      const lssCount =
        Number(lssData.rows[0]?.decisions ?? 0) + Number(lssData.rows[0]?.payments ?? 0);
      const eaCount =
        Number(eaData.rows[0]?.decisions ?? 0) + Number(eaData.rows[0]?.payments ?? 0);
      holdsData = lssCount > 0 || eaCount > 0;
      concernsDecisions =
        Number(lssData.rows[0]?.decisions ?? 0) > 0 || Number(eaData.rows[0]?.decisions ?? 0) > 0;
      relevantToPayment =
        Number(lssData.rows[0]?.payments ?? 0) > 0 || Number(eaData.rows[0]?.payments ?? 0) > 0;
      lineageComplete = Number(lineage.rows[0]?.with_lineage ?? 0) === matchedPersonIds.length;
    }

    const schemaKey =
      ubmRequest.domain === 'economic_assistance' ? 'internal_ea_request' : 'internal_lss_request';
    const [schema, reviews, classifications] = await Promise.all([
      repos.db.query<{ transport_approved: boolean }>(
        `select transport_approved from ubm_schema_versions where schema_key = $1 and status = 'active' limit 1`,
        [schemaKey],
      ),
      repos.db.query<{ review_kind: string; decision: string | null }>(
        'select review_kind, decision from ubm_request_reviews where request_id = $1::uuid',
        [requestId],
      ),
      repos.db.query<{ count: string }>(
        'select count(*) as count from information_classifications',
      ),
    ]);
    const legalApproved = reviews.rows.some(
      (r) => r.review_kind === 'legal' && r.decision === 'approved',
    );
    const dpoApproved = reviews.rows.some(
      (r) => r.review_kind === 'dpo' && r.decision === 'approved',
    );

    const domain =
      ubmRequest.domain === 'lss' || ubmRequest.domain === 'economic_assistance'
        ? ubmRequest.domain
        : 'other';

    const input: UbmEligibilityInput = {
      hasUbmRequest: true,
      requestValidAndRegistered: !['received', 'registered'].includes(ubmRequest.status),
      requestDomain: domain,
      subjectIsNamedPerson: matchedPersonIds.length > 0,
      municipalityHoldsRelevantData: holdsData,
      dataConcernsEconomicBenefitDecision: concernsDecisions,
      dataUsedAsDecisionBasis: concernsDecisions,
      dataRelevantToPayment: relevantToPayment,
      dataNecessaryForRequest: true,
      involvesProtectedIdentity: protectedIdentity,
      involvesHealthMedicalData: false,
      involvesChildrenData: childrenData,
      involvesIncomeOrSocialCircumstances: domain === 'economic_assistance',
      involvesBankOrPaymentData: relevantToPayment,
      legalBasisRecorded: Boolean(ubmRequest.legalSourceKey),
      purposeRecorded: true,
      dataLineageComplete: lineageComplete,
      classificationComplete: Number(classifications.rows[0]?.count ?? 0) > 0,
      redactionRequired: false,
      legalReviewRequired: protectedIdentity || childrenData,
      legalReviewCompleted: legalApproved,
      dpoReviewRequired: protectedIdentity || childrenData || domain === 'economic_assistance',
      dpoReviewCompleted: dpoApproved,
      makerCheckerRequired: true,
      makerCheckerCompleted: false, // completed at approval time in export-routes
      documentsIncluded: false,
      exportDestinationAllowed: true,
      schemaVersionActive: schema.rows.length > 0,
      transportProfileApproved: schema.rows[0]?.transport_approved ?? false,
      receiptHandlingConfigured: true,
      ...overrides,
    };
    return { input, matchedPersonIds };
  }

  app.post<{ Params: { id: string }; Body: Partial<UbmEligibilityInput> }>(
    '/ubm/requests/:id/eligibility',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'ubm.proposal.create')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const ubmRequest = await repos.ubmRequests.getById(request.params.id);
      if (!ubmRequest) return reply.status(404).send({ error: 'request_not_found' });
      const { input } = await buildEligibilityInput(repos, ubmRequest.id, request.body ?? {});
      const decision = evaluateUbmEligibility(input);
      await request.auditLogger.record({
        eventKey: 'export.proposal_created',
        actorUserId: request.subject!.userId,
        subjectKind: 'ubm_request',
        subjectId: ubmRequest.id,
        action: 'eligibility_evaluated',
        context: { outcome: decision.outcome, correlationId: request.correlationId },
      });
      return { input, decision };
    },
  );

  app.post<{ Params: { id: string }; Body: Partial<UbmEligibilityInput> }>(
    '/ubm/requests/:id/proposal',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'ubm.proposal.create')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const ubmRequest = await repos.ubmRequests.getById(request.params.id);
      if (!ubmRequest) return reply.status(404).send({ error: 'request_not_found' });

      const { input, matchedPersonIds } = await buildEligibilityInput(
        repos,
        ubmRequest.id,
        request.body ?? {},
      );
      const decision = evaluateUbmEligibility(input);
      const blocked = decision.outcome === 'do_not_send' || !input.dataLineageComplete;
      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);

      const domain = ubmRequest.domain === 'economic_assistance' ? 'economic_assistance' : 'lss';
      const proposal = await repos.exportProposals.create({
        requestId: ubmRequest.id,
        proposalNumber: `EXP-${ubmRequest.requestNumber}-${Date.now().toString(36).toUpperCase()}`,
        domain,
        schemaKey:
          domain === 'economic_assistance' ? 'internal_ea_request' : 'internal_lss_request',
        schemaVersion: '1.0.0',
        eligibilityOutcome: decision.outcome,
        eligibilityExplanations: [...decision.explanations, ...decision.blockers],
        status: blocked ? 'eligibility_blocked' : 'draft',
        createdBy: profileId,
      });

      // Collect the data rows for matched subjects (decisions + payments).
      if (!blocked) {
        for (const personId of matchedPersonIds) {
          const rows =
            domain === 'lss'
              ? await repos.db.query<{
                  id: string;
                  kind: string;
                  payload: Record<string, unknown>;
                }>(
                  `select id, 'lss_decision' as kind,
                          jsonb_build_object('decisionNumber', decision_number, 'insats', insats_kind,
                                             'decisionKind', decision_kind, 'decidedAt', decided_at, 'status', status) as payload
                   from lss_decisions where person_id = $1::uuid
                   union all
                   select id, 'lss_payment' as kind,
                          jsonb_build_object('amountSek', amount_sek, 'paymentDate', payment_date, 'status', status) as payload
                   from lss_payments where person_id = $1::uuid`,
                  [personId],
                )
              : await repos.db.query<{
                  id: string;
                  kind: string;
                  payload: Record<string, unknown>;
                }>(
                  `select d.id, 'ea_decision' as kind,
                          jsonb_build_object('decisionNumber', d.decision_number, 'decisionKind', d.decision_kind,
                                             'decidedAt', d.decided_at, 'status', d.status) as payload
                   from ea_decisions d
                   join ea_household_members m on m.household_id = d.household_id
                   where m.person_id = $1::uuid
                   union all
                   select id, 'ea_payment' as kind,
                          jsonb_build_object('amountSek', amount_sek, 'paymentDate', payment_date, 'status', status) as payload
                   from ea_payments where person_id = $1::uuid`,
                  [personId],
                );
          for (const row of rows.rows) {
            await repos.exportProposals.addRow({
              proposalId: proposal.id,
              personId,
              entityKind: row.kind,
              entityId: row.id,
              payload: row.payload,
              lineageComplete: input.dataLineageComplete,
            });
          }
          await repos.dataAccess.insert({
            actorUserId: profileId,
            accessKind: 'export_view',
            personId,
            caseKind: 'ubm_export_proposal',
            caseId: proposal.id,
            reason: `Exportförslag för UBM-förfrågan ${ubmRequest.requestNumber}`,
            sessionKind: request.subject!.sessionKind,
          });
        }
      }

      if (
        ['validated', 'matching', 'data_collection', 'eligibility_review'].includes(
          ubmRequest.status,
        )
      ) {
        // Walk the state machine to proposal_created through the valid path.
        let status = ubmRequest.status as UbmRequestStatus;
        const path: UbmRequestStatus[] = [
          'matching',
          'data_collection',
          'eligibility_review',
          'proposal_created',
        ];
        for (const next of path) {
          const allowed = ['matching', 'data_collection', 'eligibility_review', 'proposal_created'];
          if (allowed.includes(next) && status !== 'proposal_created') {
            try {
              transitionRequest(status, next);
              status = next;
            } catch {
              // skip steps not reachable from the current status
            }
          }
        }
        if (status !== ubmRequest.status)
          await repos.ubmRequests.updateStatus(ubmRequest.id, status);
      }

      await request.auditLogger.record({
        eventKey: 'export.proposal_created',
        actorUserId: request.subject!.userId,
        subjectKind: 'ubm_export_proposal',
        subjectId: proposal.id,
        action: blocked ? 'proposal_created_blocked' : 'proposal_created',
        context: {
          requestId: ubmRequest.id,
          outcome: decision.outcome,
          blockers: decision.blockers,
          correlationId: request.correlationId,
        },
      });
      return reply.status(201).send({ proposal, decision, blocked });
    },
  );
}
