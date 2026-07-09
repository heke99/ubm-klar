import { Card, StatGrid, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface CasesResponse {
  dataSource: string;
  cases: Array<{
    id: string;
    caseNumber: string;
    title: string;
    domain: string;
    severity: string;
    status: string;
    amountAtRiskSek: number | undefined;
    createdAt: string;
  }>;
  counts: Record<string, number>;
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Öppet',
  assigned: 'Tilldelat',
  investigating: 'Utreds',
  awaiting_decision: 'Väntar på beslut',
  decided: 'Beslutat',
  closed: 'Avslutat',
  reopened: 'Återöppnat',
};

const formatSek = (value: number) =>
  new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  }).format(value);

export default async function KontrollarendenPage() {
  await requireSession();
  const result = await apiGet<CasesResponse>('/control-cases');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Kontrollärenden</h1>
      <p>
        Kontrollärenden skapas från riskflaggor med hög eller kritisk allvarlighetsgrad, från
        UBM-underrättelser och manuellt. Alla åtgärder loggas i ärendets händelsekedja.
      </p>
      <ApiStateGuard result={result} />
      {result.kind === 'ok' ? (
        result.data.cases.length === 0 ? (
          <NoDataYet what="inga kontrollärenden" />
        ) : (
          <>
            <StatGrid
              stats={Object.entries(result.data.counts).map(([status, count]) => ({
                label: STATUS_LABELS[status] ?? status,
                value: count,
              }))}
            />
            <Card title={`Ärenden (${result.data.cases.length})`}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ padding: 'var(--space-2)' }}>Ärendenummer</th>
                    <th style={{ padding: 'var(--space-2)' }}>Rubrik</th>
                    <th style={{ padding: 'var(--space-2)' }}>Allvarlighet</th>
                    <th style={{ padding: 'var(--space-2)' }}>Riskbelopp</th>
                    <th style={{ padding: 'var(--space-2)' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.cases.map((controlCase) => (
                    <tr
                      key={controlCase.id}
                      style={{ borderBottom: '1px solid var(--color-border)' }}
                    >
                      <td style={{ padding: 'var(--space-2)' }}>
                        <a href={`/kontrollarenden/${controlCase.id}`}>{controlCase.caseNumber}</a>
                      </td>
                      <td style={{ padding: 'var(--space-2)' }}>{controlCase.title}</td>
                      <td style={{ padding: 'var(--space-2)' }}>
                        <StatusBadge
                          status={controlCase.severity}
                          tone={
                            ['high', 'critical'].includes(controlCase.severity)
                              ? 'danger'
                              : controlCase.severity === 'medium'
                                ? 'warning'
                                : 'info'
                          }
                        />
                      </td>
                      <td style={{ padding: 'var(--space-2)' }}>
                        {controlCase.amountAtRiskSek !== undefined
                          ? formatSek(controlCase.amountAtRiskSek)
                          : '—'}
                      </td>
                      <td style={{ padding: 'var(--space-2)' }}>
                        <StatusBadge
                          status={STATUS_LABELS[controlCase.status] ?? controlCase.status}
                          tone={controlCase.status === 'closed' ? 'success' : 'info'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )
      ) : null}
    </div>
  );
}
