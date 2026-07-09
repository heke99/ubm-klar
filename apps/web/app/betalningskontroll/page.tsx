import { Card, StatGrid, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface PaymentControlResponse {
  dataSource: string;
  summary?: {
    bySeverity: Record<string, number>;
    byRule: Array<{ ruleKey: string; count: number; amountAtRiskSek: number }>;
  };
  flags: Array<{
    id: string;
    ruleKey: string;
    domain: string;
    severity: string;
    explanation: string;
    amountAtRiskSek: number | undefined;
    status: string;
    createdAt: string;
  }>;
}

const formatSek = (value: number) =>
  new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  }).format(value);

export default async function BetalningskontrollPage() {
  await requireSession();
  const result = await apiGet<PaymentControlResponse>('/payment-control');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Betalningskontroll</h1>
      <p>
        Riskregler körs mot kommunens importerade utbetalningsdata. Flaggor med hög eller kritisk
        allvarlighetsgrad kan bli kontrollärenden.
      </p>
      <ApiStateGuard result={result} />
      {result.kind === 'ok' ? (
        result.data.flags.length === 0 ? (
          <NoDataYet what="inga riskflaggor" />
        ) : (
          <>
            <StatGrid
              stats={Object.entries(result.data.summary?.bySeverity ?? {}).map(
                ([severity, count]) => ({
                  label: `Flaggor: ${severity}`,
                  value: count,
                  tone: ['high', 'critical'].includes(severity)
                    ? ('danger' as const)
                    : ('warning' as const),
                }),
              )}
            />
            <Card title="Flaggor per regel">
              <ul>
                {(result.data.summary?.byRule ?? []).slice(0, 10).map((rule) => (
                  <li key={rule.ruleKey}>
                    {rule.ruleKey}: {rule.count} st, riskbelopp {formatSek(rule.amountAtRiskSek)}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={`Senaste riskflaggor (${result.data.flags.length})`}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ padding: 'var(--space-2)' }}>Regel</th>
                    <th style={{ padding: 'var(--space-2)' }}>Förklaring</th>
                    <th style={{ padding: 'var(--space-2)' }}>Allvarlighet</th>
                    <th style={{ padding: 'var(--space-2)' }}>Riskbelopp</th>
                    <th style={{ padding: 'var(--space-2)' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.flags.map((flag) => (
                    <tr key={flag.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: 'var(--space-2)' }}>{flag.ruleKey}</td>
                      <td style={{ padding: 'var(--space-2)' }}>{flag.explanation}</td>
                      <td style={{ padding: 'var(--space-2)' }}>
                        <StatusBadge
                          status={flag.severity}
                          tone={['high', 'critical'].includes(flag.severity) ? 'danger' : 'warning'}
                        />
                      </td>
                      <td style={{ padding: 'var(--space-2)' }}>
                        {flag.amountAtRiskSek !== undefined ? formatSek(flag.amountAtRiskSek) : '—'}
                      </td>
                      <td style={{ padding: 'var(--space-2)' }}>{flag.status}</td>
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
