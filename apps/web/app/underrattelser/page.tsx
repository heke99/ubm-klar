import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface NotificationsResponse {
  dataSource: string;
  notifications: Array<{
    id: string;
    notificationNumber: string;
    domain: string | undefined;
    summary: string;
    status: string;
    receivedAt: string;
  }>;
  counts: Record<string, number>;
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Mottagen',
  matching: 'Matchning pågår',
  manual_review: 'Manuell granskning',
  matched: 'Matchad',
  case_created: 'Kontrollärende skapat',
  investigating: 'Utreds',
  outcome_registered: 'Utfall registrerat',
  feedback_sent: 'Återkoppling skickad',
  closed: 'Avslutad',
};

export default async function UnderrattelserPage() {
  await requireSession();
  const result = await apiGet<NotificationsResponse>('/ubm/notifications');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Underrättelser</h1>
      <p>
        Inkommande underrättelser från Utbetalningsmyndigheten registreras manuellt tills officiell
        digital kanal finns. Matchning mot personer, ärenden och utbetalningar loggas alltid.
      </p>
      <p>
        <a
          href="/underrattelser/new"
          style={{
            display: 'inline-block',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-contrast)',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius)',
            textDecoration: 'none',
          }}
        >
          Registrera underrättelse
        </a>
      </p>
      <ApiStateGuard result={result} />
      {result.kind === 'ok' ? (
        result.data.notifications.length === 0 ? (
          <NoDataYet what="inga underrättelser" />
        ) : (
          <Card title={`Underrättelser (${result.data.notifications.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Nummer</th>
                  <th style={{ padding: 'var(--space-2)' }}>Sammanfattning</th>
                  <th style={{ padding: 'var(--space-2)' }}>Mottagen</th>
                  <th style={{ padding: 'var(--space-2)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.data.notifications.map((notification) => (
                  <tr
                    key={notification.id}
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                  >
                    <td style={{ padding: 'var(--space-2)' }}>
                      <a href={`/underrattelser/${notification.id}`}>
                        {notification.notificationNumber}
                      </a>
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>{notification.summary}</td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      {notification.receivedAt.slice(0, 10)}
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <StatusBadge
                        status={STATUS_LABELS[notification.status] ?? notification.status}
                        tone={notification.status === 'closed' ? 'success' : 'info'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : null}
    </div>
  );
}
