import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface RequestsResponse {
  dataSource: string;
  requests: Array<{
    id: string;
    requestNumber: string;
    status: string;
    domain: string | undefined;
    receivedAt: string;
    deadlineAt: string | undefined;
  }>;
  counts: Record<string, number>;
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Mottagen',
  registered: 'Registrerad',
  validated: 'Validerad',
  matching: 'Matchning pågår',
  data_collection: 'Datainsamling',
  eligibility_review: 'Lämplighetsprövning',
  proposal_created: 'Exportförslag skapat',
  in_review: 'Under granskning',
  approved: 'Godkänd',
  exported: 'Exporterad',
  receipt_received: 'Kvittens mottagen',
  closed: 'Avslutad',
  rejected: 'Avvisad',
};

export default async function UbmForfragningarPage() {
  await requireSession();
  const result = await apiGet<RequestsResponse>('/ubm/requests');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>UBM-förfrågningar</h1>
      <p>
        Registrera och handlägg förfrågningar från Utbetalningsmyndigheten manuellt. Officiell
        digital överföring är inte tillgänglig — export sker som manuell nedladdning efter
        fyra-ögon-godkännande.
      </p>
      <p>
        <a
          href="/ubm-forfragningar/new"
          style={{
            display: 'inline-block',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-contrast)',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius)',
            textDecoration: 'none',
          }}
        >
          Registrera ny förfrågan
        </a>
      </p>
      <ApiStateGuard result={result} />
      {result.kind === 'ok' ? (
        result.data.requests.length === 0 ? (
          <NoDataYet what="inga registrerade UBM-förfrågningar" />
        ) : (
          <Card title={`Förfrågningar (${result.data.requests.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Nummer</th>
                  <th style={{ padding: 'var(--space-2)' }}>Område</th>
                  <th style={{ padding: 'var(--space-2)' }}>Mottagen</th>
                  <th style={{ padding: 'var(--space-2)' }}>Frist</th>
                  <th style={{ padding: 'var(--space-2)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.data.requests.map((request) => (
                  <tr key={request.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <a href={`/ubm-forfragningar/${request.id}`}>{request.requestNumber}</a>
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      {request.domain === 'lss'
                        ? 'LSS'
                        : request.domain === 'economic_assistance'
                          ? 'Ekonomiskt bistånd'
                          : 'Okänt'}
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>{request.receivedAt.slice(0, 10)}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{request.deadlineAt ?? '—'}</td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <StatusBadge
                        status={STATUS_LABELS[request.status] ?? request.status}
                        tone={
                          ['closed', 'receipt_received', 'approved'].includes(request.status)
                            ? 'success'
                            : request.status === 'rejected'
                              ? 'danger'
                              : 'info'
                        }
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
