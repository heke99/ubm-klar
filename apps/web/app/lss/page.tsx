import { Card, StatGrid } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, DemoDataWarning, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface LssDashboard {
  dataSource: 'data_plane' | 'demo' | 'empty';
  stats?: {
    personsTotal: number;
    activeDecisions: number;
    paymentsTotal: number;
    paidAmountSekTotal: number;
    openRiskFlags: number;
    flagsBySeverity: Record<string, number>;
    openRecoveryClaims: number;
    providersTotal: number;
    unapprovedTimeReports: number;
    amountAtRiskSekTotal: number;
  };
  demoDashboard?: {
    decidedHoursTotal: number;
    reportedHoursTotal: number;
    paidAmountSekTotal: number;
    flagsBySeverity: Record<string, number>;
    openRecoveryClaims: number;
    amountAtRiskSekTotal: number;
  };
}

const formatSek = (value: number) =>
  new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  }).format(value);

export default async function LssPage() {
  await requireSession();
  const result = await apiGet<LssDashboard>('/dashboards/lss');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>LSS och personlig assistans</h1>
      <ApiStateGuard result={result} />
      {result.kind === 'ok' ? (
        result.data.dataSource === 'empty' ? (
          <NoDataYet what="inga LSS-uppgifter" />
        ) : result.data.dataSource === 'demo' ? (
          <>
            <DemoDataWarning />
            <StatGrid
              stats={[
                {
                  label: 'Beslutade timmar',
                  value: result.data.demoDashboard?.decidedHoursTotal ?? 0,
                },
                {
                  label: 'Rapporterade timmar',
                  value: result.data.demoDashboard?.reportedHoursTotal ?? 0,
                },
                {
                  label: 'Utbetalt',
                  value: formatSek(result.data.demoDashboard?.paidAmountSekTotal ?? 0),
                },
                {
                  label: 'Riskbelopp',
                  value: formatSek(result.data.demoDashboard?.amountAtRiskSekTotal ?? 0),
                  tone: 'danger',
                },
                {
                  label: 'Öppna återkrav',
                  value: result.data.demoDashboard?.openRecoveryClaims ?? 0,
                },
              ]}
            />
          </>
        ) : (
          <>
            <StatGrid
              stats={[
                { label: 'Personer med LSS-profil', value: result.data.stats?.personsTotal ?? 0 },
                { label: 'Aktiva beslut', value: result.data.stats?.activeDecisions ?? 0 },
                { label: 'Utbetalningar', value: result.data.stats?.paymentsTotal ?? 0 },
                { label: 'Utbetalt', value: formatSek(result.data.stats?.paidAmountSekTotal ?? 0) },
                {
                  label: 'Öppna riskflaggor',
                  value: result.data.stats?.openRiskFlags ?? 0,
                  tone: 'warning',
                },
                {
                  label: 'Riskbelopp',
                  value: formatSek(result.data.stats?.amountAtRiskSekTotal ?? 0),
                  tone: 'danger',
                },
                { label: 'Öppna återkrav', value: result.data.stats?.openRecoveryClaims ?? 0 },
                { label: 'Anordnare', value: result.data.stats?.providersTotal ?? 0 },
                {
                  label: 'Ej godkända tidrapporter',
                  value: result.data.stats?.unapprovedTimeReports ?? 0,
                },
              ]}
            />
            <Card title="Riskflaggor per allvarlighetsgrad">
              {Object.keys(result.data.stats?.flagsBySeverity ?? {}).length === 0 ? (
                <p>Inga öppna riskflaggor.</p>
              ) : (
                <ul>
                  {Object.entries(result.data.stats?.flagsBySeverity ?? {}).map(
                    ([severity, count]) => (
                      <li key={severity}>
                        {severity}: {count}
                      </li>
                    ),
                  )}
                </ul>
              )}
            </Card>
          </>
        )
      ) : null}
    </div>
  );
}
