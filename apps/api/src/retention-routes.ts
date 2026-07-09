import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PermissionKey } from '@ubm-klar/access-control';

/**
 * Retention: default rules per data class, legal holds (block disposal) and
 * the disposal/gallring queue. Disposal execution requires maker-checker
 * (enforced by the approval workflow tables) and is blocked by active holds.
 */

export interface RetentionRoutesOptions {
  requirePermission: (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: PermissionKey,
  ) => boolean;
}

export function registerRetentionRoutes(
  app: FastifyInstance,
  options: RetentionRoutesOptions,
): void {
  const { requirePermission } = options;

  app.get('/retention/policies', async (request, reply) => {
    if (!requirePermission(request, reply, 'archive.manage')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const rules = await request.repositories.db.query<{
      rule_key: string;
      classification_key: string;
      trigger_event: string;
      retention_years: number;
      action: string;
      is_active: boolean;
    }>(
      `select rule_key, classification_key, trigger_event, retention_years, action, is_active
       from archive_retention_rules order by classification_key`,
    );
    return { rules: rules.rows };
  });

  app.get('/retention/legal-holds', async (request, reply) => {
    if (!requirePermission(request, reply, 'archive.manage')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const holds = await request.repositories.db.query<{
      hold_key: string;
      title: string;
      reason: string;
      created_at: Date;
      released_at: Date | null;
    }>(
      'select hold_key, title, reason, created_at, released_at from legal_holds order by created_at desc limit 200',
    );
    return {
      holds: holds.rows.map((hold) => ({
        holdKey: hold.hold_key,
        title: hold.title,
        reason: hold.reason,
        createdAt: hold.created_at.toISOString(),
        active: hold.released_at === null,
      })),
    };
  });

  app.post<{ Body: { holdKey: string; title: string; reason: string } }>(
    '/retention/legal-holds',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'archive.manage')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const { holdKey, title, reason } = request.body;
      if (!holdKey?.trim() || !title?.trim() || !reason?.trim()) {
        return reply
          .status(400)
          .send({ error: 'missing_fields', message: 'Nyckel, titel och skäl krävs.' });
      }
      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
      await repos.db.query(
        `insert into legal_holds (hold_key, title, reason, created_by) values ($1, $2, $3, $4::uuid)`,
        [holdKey.trim(), title.trim(), reason.trim(), profileId],
      );
      await request.auditLogger.record({
        eventKey: 'retention.deletion',
        actorUserId: request.subject!.userId,
        action: 'legal_hold_created',
        reason,
        context: { holdKey, correlationId: request.correlationId },
      });
      return reply.status(201).send({ holdKey });
    },
  );

  app.post<{ Params: { holdKey: string } }>(
    '/retention/legal-holds/:holdKey/release',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'archive.manage')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
      await repos.db.query(
        `update legal_holds set released_by = $2::uuid, released_at = now()
         where hold_key = $1 and released_at is null`,
        [request.params.holdKey, profileId],
      );
      await request.auditLogger.record({
        eventKey: 'retention.deletion',
        actorUserId: request.subject!.userId,
        action: 'legal_hold_released',
        context: { holdKey: request.params.holdKey, correlationId: request.correlationId },
      });
      return { released: request.params.holdKey };
    },
  );

  app.get('/retention/disposal-queue', async (request, reply) => {
    if (!requirePermission(request, reply, 'retention.execute')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const decisions = await request.repositories.db.query<{
      decision_number: string;
      classification_key: string;
      scope_description: string;
      status: string;
      decided_at: Date;
    }>(
      `select decision_number, classification_key, scope_description, status, decided_at
       from disposal_decisions order by decided_at desc limit 200`,
    );
    const activeHolds = await request.repositories.db.query<{ count: string }>(
      'select count(*) as count from legal_holds where released_at is null',
    );
    return {
      decisions: decisions.rows.map((decision) => ({
        decisionNumber: decision.decision_number,
        classificationKey: decision.classification_key,
        scope: decision.scope_description,
        status: decision.status,
        decidedAt: decision.decided_at.toISOString(),
      })),
      activeLegalHolds: Number(activeHolds.rows[0]?.count ?? 0),
      note: 'Gallringsbeslut kräver fyra-ögon-godkännande och blockeras av aktiva rättsliga undantag.',
    };
  });
}
