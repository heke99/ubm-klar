import { Card, StatGrid } from '../../design-system/components';
import { demo, formatSek } from '../../components/demo-data';

export const dynamic = 'force-static';

/** LSS-dashboard: beslutstimmar, fakturerat, utfört, utförarrisk. */
export default function LssPage() {
  const dashboard = demo.lss.dashboard;
  return (
    <>
      <h1>LSS</h1>
      <StatGrid
        stats={[
          { label: 'Beslutade timmar', value: dashboard.decidedHoursTotal.toLocaleString('sv-SE') },
          {
            label: 'Rapporterade timmar',
            value: dashboard.reportedHoursTotal.toLocaleString('sv-SE'),
          },
          {
            label: 'Fakturerade timmar',
            value: dashboard.invoicedHoursTotal.toLocaleString('sv-SE'),
          },
          { label: 'Utbetalt belopp', value: formatSek(dashboard.paidAmountSekTotal) },
          { label: 'Beslut med avvikelser', value: dashboard.decisionsWithIssues, tone: 'warning' },
          {
            label: 'Utförare utan aktivt IVO-tillstånd',
            value: dashboard.providersWithoutActivePermit,
            tone: 'danger',
          },
          {
            label: 'Ogodkända tidrapporter',
            value: dashboard.unapprovedTimeReports,
            tone: 'warning',
          },
          { label: 'Öppna återkrav', value: dashboard.openRecoveryClaims, tone: 'warning' },
          { label: 'Riskbelopp', value: formatSek(dashboard.amountAtRiskSekTotal), tone: 'danger' },
        ]}
      />
      <Card title="Riskflaggor per regel">
        <table>
          <caption>LSS-riskflaggor per regel (demo)</caption>
          <thead>
            <tr>
              <th scope="col">Regel</th>
              <th scope="col">Antal</th>
              <th scope="col">Riskbelopp</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.flagsByRule.slice(0, 10).map((row) => (
              <tr key={row.ruleKey}>
                <td>{row.ruleKey}</td>
                <td>{row.count}</td>
                <td>{formatSek(row.amountAtRiskSek)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
