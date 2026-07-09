import { redirect } from 'next/navigation';
import { Card, StatusBadge } from '../../../design-system/components';
import { apiGet, apiSend } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../../components/page-states';

export const dynamic = 'force-dynamic';

interface UsersResponse {
  users: Array<{
    id: string;
    subjectId: string;
    displayName: string;
    isActive: boolean;
    roles: string[];
  }>;
}
interface RolesResponse {
  roles: Array<{ role_key: string; display_name_sv: string; is_no_pii_role: boolean }>;
}
interface SupportAccessResponse {
  sessions: Array<{ kind: string; action: string; reason: string | null; occurredAt: string }>;
}

async function grantRoleAction(formData: FormData) {
  'use server';
  await apiSend('POST', `/admin/users/${String(formData.get('profileId'))}/roles`, {
    roleKey: String(formData.get('roleKey')),
    reason: String(formData.get('reason') ?? ''),
  });
  redirect('/installningar/anvandare');
}

async function revokeRoleAction(formData: FormData) {
  'use server';
  await apiSend(
    'DELETE',
    `/admin/users/${String(formData.get('profileId'))}/roles/${String(formData.get('roleKey'))}`,
  );
  redirect('/installningar/anvandare');
}

export default async function AnvandarePage() {
  await requireSession();
  const [users, roles, supportAccess] = await Promise.all([
    apiGet<UsersResponse>('/admin/users'),
    apiGet<RolesResponse>('/admin/roles'),
    apiGet<SupportAccessResponse>('/admin/support-access'),
  ]);

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Användare och roller</h1>
      <p>
        Roller styr all åtkomst (RBAC + ABAC + need-to-know). Behörighetsändringar kräver skäl och
        loggas i revisionsloggen.
      </p>
      <ApiStateGuard result={users} />
      {users.kind === 'ok' && roles.kind === 'ok' ? (
        users.data.users.length === 0 ? (
          <NoDataYet what="inga användare" />
        ) : (
          <Card title={`Användare (${users.data.users.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Namn</th>
                  <th style={{ padding: 'var(--space-2)' }}>Roller</th>
                  <th style={{ padding: 'var(--space-2)' }}>Tilldela roll</th>
                </tr>
              </thead>
              <tbody>
                {users.data.users.map((user) => (
                  <tr key={user.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>
                      {user.displayName}
                      {user.isActive ? '' : ' (inaktiv)'}
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      {user.roles.length === 0 ? '—' : null}
                      {user.roles.map((role) => (
                        <form
                          key={role}
                          action={revokeRoleAction}
                          style={{ display: 'inline-block', margin: 2 }}
                        >
                          <input type="hidden" name="profileId" value={user.id} />
                          <input type="hidden" name="roleKey" value={role} />
                          <button
                            type="submit"
                            title="Klicka för att återkalla"
                            style={{ cursor: 'pointer' }}
                          >
                            {role} ✕
                          </button>
                        </form>
                      ))}
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <form action={grantRoleAction} style={{ display: 'flex', gap: 4 }}>
                        <input type="hidden" name="profileId" value={user.id} />
                        <select name="roleKey">
                          {roles.data.roles.map((role) => (
                            <option key={role.role_key} value={role.role_key}>
                              {role.display_name_sv}
                            </option>
                          ))}
                        </select>
                        <input
                          name="reason"
                          placeholder="Skäl (krävs)"
                          required
                          style={{ width: 140 }}
                        />
                        <button type="submit">Tilldela</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : null}

      <Card title="Support- och nödåtkomst (leverantör)">
        <p>
          All supportåtkomst är tidsbegränsad, godkänns av kommunen och loggas. Break-glass kräver
          incidentreferens och efterhandsgranskas.
        </p>
        {supportAccess.kind === 'ok' ? (
          supportAccess.data.sessions.length === 0 ? (
            <p>Inga support- eller nödåtkomstsessioner har förekommit.</p>
          ) : (
            <ul>
              {supportAccess.data.sessions.map((session, index) => (
                <li key={index}>
                  {session.occurredAt.slice(0, 16).replace('T', ' ')} —{' '}
                  <StatusBadge
                    status={
                      session.kind === 'break_glass.session' ? 'Break-glass' : 'Support (JIT)'
                    }
                    tone={session.kind === 'break_glass.session' ? 'danger' : 'warning'}
                  />{' '}
                  {session.action}
                  {session.reason ? ` — ${session.reason}` : ''}
                </li>
              ))}
            </ul>
          )
        ) : (
          <ApiStateGuard result={supportAccess} />
        )}
      </Card>
    </div>
  );
}
