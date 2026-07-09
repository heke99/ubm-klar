import { Card } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface AuditResponse {
  dataSource: string;
  events: Array<{
    id: string;
    eventKey: string;
    action: string;
    outcome: string;
    actorUserId: string | undefined;
    correlationId: string | undefined;
    occurredAt: string;
  }>;
}

interface DataAccessResponse {
  dataSource: string;
  events: Array<{
    id: string;
    accessKind: string;
    actorUserId: string;
    reason: string | undefined;
    sessionKind: string;
    occurredAt: string;
  }>;
}

export default async function RevisionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; eventKey?: string; accessKind?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const auditQuery = new URLSearchParams();
  if (params.from) auditQuery.set('from', params.from);
  if (params.to) auditQuery.set('to', params.to);
  if (params.eventKey) auditQuery.set('eventKey', params.eventKey);
  const accessQuery = new URLSearchParams();
  if (params.from) accessQuery.set('from', params.from);
  if (params.to) accessQuery.set('to', params.to);
  if (params.accessKind) accessQuery.set('accessKind', params.accessKind);

  const [audit, dataAccess, chain] = await Promise.all([
    apiGet<AuditResponse>(`/audit/events?${auditQuery.toString()}`),
    apiGet<DataAccessResponse>(`/audit/data-access?${accessQuery.toString()}`),
    apiGet<{
      eventCount: number;
      verification: { valid: boolean; brokenAtIndex?: number; reason?: string } | null;
    }>('/audit/verify-chain'),
  ]);

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Revision och loggar</h1>
      <p>
        Alla känsliga åtgärder skrivs till en beständig, hash-kedjad revisionslogg. All läsning av
        personuppgifter skrivs till dataåtkomstloggen. Loggarna kan inte ändras i efterhand.
      </p>

      {chain.kind === 'ok' && chain.data.verification ? (
        chain.data.verification.valid ? (
          <p role="status" style={{ color: 'var(--color-success)' }}>
            Beviskedjan är verifierad: {chain.data.eventCount} händelser, obruten hash-kedja.
          </p>
        ) : (
          <p
            role="alert"
            style={{
              color: 'var(--color-danger)',
              border: '2px solid var(--color-danger)',
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius)',
            }}
          >
            VARNING: Beviskedjan är BRUTEN vid händelse{' '}
            {chain.data.verification.brokenAtIndex ?? '?'} ({chain.data.verification.reason}).
            Loggen kan ha manipulerats — kontakta informationssäkerhetsansvarig omedelbart.
          </p>
        )
      ) : null}

      <Card title="Filter">
        <form method="get" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <label>
            Från <input type="date" name="from" defaultValue={params.from ?? ''} />
          </label>
          <label>
            Till <input type="date" name="to" defaultValue={params.to ?? ''} />
          </label>
          <label>
            Händelsetyp{' '}
            <input
              type="text"
              name="eventKey"
              placeholder="t.ex. export.proposal_created"
              defaultValue={params.eventKey ?? ''}
            />
          </label>
          <label>
            Åtkomsttyp{' '}
            <input
              type="text"
              name="accessKind"
              placeholder="t.ex. sensitive_field_reveal"
              defaultValue={params.accessKind ?? ''}
            />
          </label>
          <button type="submit">Filtrera</button>
        </form>
      </Card>

      <Card title="Revisionslogg">
        <ApiStateGuard result={audit} />
        {audit.kind === 'ok' ? (
          audit.data.events.length === 0 ? (
            <NoDataYet what="inga revisionshändelser" />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Tid</th>
                  <th style={{ padding: 'var(--space-2)' }}>Händelse</th>
                  <th style={{ padding: 'var(--space-2)' }}>Åtgärd</th>
                  <th style={{ padding: 'var(--space-2)' }}>Utfall</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.events.map((event) => (
                  <tr key={event.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>
                      {event.occurredAt.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>{event.eventKey}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{event.action}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{event.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </Card>

      <Card title="Dataåtkomstlogg">
        <ApiStateGuard result={dataAccess} />
        {dataAccess.kind === 'ok' ? (
          dataAccess.data.events.length === 0 ? (
            <NoDataYet what="inga dataåtkomsthändelser" />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Tid</th>
                  <th style={{ padding: 'var(--space-2)' }}>Åtkomsttyp</th>
                  <th style={{ padding: 'var(--space-2)' }}>Skäl</th>
                  <th style={{ padding: 'var(--space-2)' }}>Sessionstyp</th>
                </tr>
              </thead>
              <tbody>
                {dataAccess.data.events.map((event) => (
                  <tr key={event.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>
                      {event.occurredAt.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>{event.accessKind}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{event.reason ?? '—'}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{event.sessionKind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </Card>
    </div>
  );
}
