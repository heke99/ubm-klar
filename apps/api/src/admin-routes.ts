import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PermissionKey } from '@ubm-klar/access-control';

/**
 * Municipality administration: users, role grants (audited), departments and
 * review of support/break-glass access. Staff metadata only — citizen data is
 * never exposed here.
 */

export interface AdminRoutesOptions {
  requirePermission: (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: PermissionKey,
  ) => boolean;
}

export function registerAdminRoutes(app: FastifyInstance, options: AdminRoutesOptions): void {
  const { requirePermission } = options;

  app.get('/admin/users', async (request, reply) => {
    if (!requirePermission(request, reply, 'users.manage')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const users = await request.repositories.db.query<{
      id: string;
      subject_id: string;
      display_name: string;
      email: string;
      is_active: boolean;
    }>(
      'select id, subject_id, display_name, email, is_active from user_profiles order by display_name limit 500',
    );
    const roles = await request.repositories.db.query<{
      user_id: string;
      role_key: string;
    }>(
      `select ur.user_id, r.role_key from user_roles ur
       join roles r on r.id = ur.role_id
       where ur.valid_to is null or ur.valid_to > now()`,
    );
    return {
      users: users.rows.map((user) => ({
        id: user.id,
        subjectId: user.subject_id,
        displayName: user.display_name,
        email: user.email,
        isActive: user.is_active,
        roles: roles.rows.filter((role) => role.user_id === user.id).map((role) => role.role_key),
      })),
    };
  });

  app.get('/admin/roles', async (request, reply) => {
    if (!requirePermission(request, reply, 'roles.manage')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const roles = await request.repositories.db.query<{
      role_key: string;
      display_name_sv: string;
      is_no_pii_role: boolean;
    }>('select role_key, display_name_sv, is_no_pii_role from roles order by role_key');
    return { roles: roles.rows };
  });

  app.post<{
    Params: { profileId: string };
    Body: { roleKey: string; reason: string };
  }>('/admin/users/:profileId/roles', async (request, reply) => {
    if (!requirePermission(request, reply, 'roles.manage')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    if (!request.body.reason?.trim()) {
      return reply
        .status(400)
        .send({ error: 'reason_required', message: 'Behörighetsändringar kräver skäl.' });
    }
    const role = await repos.db.query<{ id: string }>('select id from roles where role_key = $1', [
      request.body.roleKey,
    ]);
    if (!role.rows[0]) return reply.status(404).send({ error: 'role_not_found' });
    const grantedBy = await repos.users.ensureUserProfile(request.subject!.userId);
    await repos.db.query(
      `insert into user_roles (user_id, role_id, granted_by, granted_reason)
       values ($1::uuid, $2::uuid, $3::uuid, $4)
       on conflict do nothing`,
      [request.params.profileId, role.rows[0].id, grantedBy, request.body.reason],
    );
    await request.auditLogger.record({
      eventKey: 'role_mapping.changed',
      actorUserId: request.subject!.userId,
      subjectKind: 'user_profile',
      subjectId: request.params.profileId,
      action: `role_granted_${request.body.roleKey}`,
      reason: request.body.reason,
      context: { correlationId: request.correlationId },
    });
    return reply.status(201).send({ granted: request.body.roleKey });
  });

  app.delete<{
    Params: { profileId: string; roleKey: string };
    Body: { reason?: string } | undefined;
  }>('/admin/users/:profileId/roles/:roleKey', async (request, reply) => {
    if (!requirePermission(request, reply, 'roles.manage')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    await repos.db.query(
      `update user_roles set valid_to = now()
         where user_id = $1::uuid and role_id = (select id from roles where role_key = $2)
           and (valid_to is null or valid_to > now())`,
      [request.params.profileId, request.params.roleKey],
    );
    await request.auditLogger.record({
      eventKey: 'role_mapping.changed',
      actorUserId: request.subject!.userId,
      subjectKind: 'user_profile',
      subjectId: request.params.profileId,
      action: `role_revoked_${request.params.roleKey}`,
      context: { correlationId: request.correlationId },
    });
    return { revoked: request.params.roleKey };
  });

  app.get('/admin/departments', async (request, reply) => {
    if (!requirePermission(request, reply, 'users.manage')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const departments = await request.repositories.db.query<{
      id: string;
      name: string;
      code: string;
      is_active: boolean;
    }>('select id, name, code, is_active from departments order by name');
    return { departments: departments.rows };
  });

  /**
   * Municipality review of vendor support access: every JIT support session and
   * break-glass session is in the persistent audit log.
   */
  app.get('/admin/support-access', async (request, reply) => {
    if (!requirePermission(request, reply, 'audit.read')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const events = await request.repositories.db.query<{
      event_key: string;
      action: string;
      outcome: string;
      reason: string | null;
      context: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `select event_key, action, outcome, reason, context, occurred_at from audit_events
       where event_key in ('support.access', 'break_glass.session')
       order by occurred_at desc limit 200`,
    );
    return {
      sessions: events.rows.map((event) => ({
        kind: event.event_key,
        action: event.action,
        outcome: event.outcome,
        reason: event.reason,
        occurredAt: event.occurred_at.toISOString(),
      })),
    };
  });
}
