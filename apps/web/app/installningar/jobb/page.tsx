import { Card, StatGrid, StatusBadge } from '../../../design-system/components';
import { apiGet } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../../components/page-states';

export const dynamic = 'force-dynamic';

interface JobsResponse {
  dataSource: string;
  jobs: Array<{
    id: string;
    type: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    errorCode: string | null;
    lastError: string | null;
    enqueuedAt: string;
    finishedAt: string | null;
  }>;
  stats: {
    queueDepth: number;
    deadLetter: number;
    failed: number;
    succeededLastHour: number;
  } | null;
  message?: string;
}

export default async function JobbPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const query = params.status ? `?status=${encodeURIComponent(params.status)}` : '';
  const result = await apiGet<JobsResponse>(`/admin/jobs${query}`);

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Bakgrundsjobb</h1>
      <p>
        Jobbkön är beständig: jobb körs om vid fel (exponentiell backoff) och hamnar i dead
        letter-kön efter max antal försök. Ej implementerade jobbtyper misslyckas alltid med
        NOT_IMPLEMENTED — de låtsas aldrig lyckas.
      </p>
      <ApiStateGuard result={result} />
      {result.kind === 'ok' ? (
        result.data.stats === null ? (
          <NoDataYet what="ingen jobbkö" />
        ) : (
          <>
            <StatGrid
              stats={[
                { label: 'Ködjup', value: result.data.stats.queueDepth },
                {
                  label: 'Dead letter',
                  value: result.data.stats.deadLetter,
                  tone: result.data.stats.deadLetter > 0 ? 'danger' : 'default',
                },
                {
                  label: 'Misslyckade/försöker igen',
                  value: result.data.stats.failed,
                  tone: result.data.stats.failed > 0 ? 'warning' : 'default',
                },
                { label: 'Lyckade senaste timmen', value: result.data.stats.succeededLastHour },
              ]}
            />
            <p>
              Filter: <a href="/installningar/jobb">alla</a> ·{' '}
              <a href="/installningar/jobb?status=dead_letter">dead letter</a> ·{' '}
              <a href="/installningar/jobb?status=retrying">försöker igen</a> ·{' '}
              <a href="/installningar/jobb?status=succeeded">lyckade</a>
            </p>
            <Card title={`Jobb (${result.data.jobs.length})`}>
              {result.data.jobs.length === 0 ? (
                <p>Inga jobb.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr
                      style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}
                    >
                      <th style={{ padding: 'var(--space-2)' }}>Typ</th>
                      <th style={{ padding: 'var(--space-2)' }}>Status</th>
                      <th style={{ padding: 'var(--space-2)' }}>Försök</th>
                      <th style={{ padding: 'var(--space-2)' }}>Fel</th>
                      <th style={{ padding: 'var(--space-2)' }}>Köad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.jobs.map((job) => (
                      <tr key={job.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: 'var(--space-2)' }}>{job.type}</td>
                        <td style={{ padding: 'var(--space-2)' }}>
                          <StatusBadge
                            status={job.status}
                            tone={
                              job.status === 'succeeded'
                                ? 'success'
                                : job.status === 'dead_letter'
                                  ? 'danger'
                                  : job.status === 'retrying'
                                    ? 'warning'
                                    : 'info'
                            }
                          />
                        </td>
                        <td style={{ padding: 'var(--space-2)' }}>
                          {job.attempts}/{job.maxAttempts}
                        </td>
                        <td style={{ padding: 'var(--space-2)' }}>{job.errorCode ?? '—'}</td>
                        <td style={{ padding: 'var(--space-2)' }}>
                          {job.enqueuedAt.slice(0, 16).replace('T', ' ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )
      ) : null}
    </div>
  );
}
