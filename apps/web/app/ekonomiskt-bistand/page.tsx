import { Card, StatGrid } from '../../design-system/components';
import { demo, formatSek } from '../../components/demo-data';

export const dynamic = 'force-static';

/** Ekonomiskt bistånd: ansökningar, beslut, betalningar, anomalier. */
export default function EkonomisktBistandPage() {
  const dashboard = demo.ea.dashboard;
  return (
    <>
      <h1>Ekonomiskt bistånd</h1>
      <StatGrid
        stats={[
          { label: 'Ansökningar', value: dashboard.applicationsTotal },
          { label: 'Beslut', value: dashboard.decisionsTotal },
          { label: 'Bifall', value: dashboard.approvals, tone: 'success' },
          { label: 'Avslag', value: dashboard.rejections },
          { label: 'Utbetalt', value: formatSek(dashboard.paidAmountSekTotal) },
          {
            label: 'Verifierad inkomst (andel)',
            value: `${Math.round(dashboard.verifiedIncomeShare * 100)} %`,
          },
          { label: 'Inkomstanomalier', value: dashboard.incomeAnomalies, tone: 'warning' },
          { label: 'Hushållsanomalier', value: dashboard.householdAnomalies, tone: 'warning' },
          { label: 'Boendeanomalier', value: dashboard.housingAnomalies, tone: 'warning' },
          { label: 'Dubblettutbetalningar', value: dashboard.duplicatePayments, tone: 'danger' },
          { label: 'Kontoanomalier', value: dashboard.accountAnomalies, tone: 'danger' },
          {
            label: 'Avslag med utbetalning',
            value: dashboard.rejectionWithPayment,
            tone: 'danger',
          },
          { label: 'Öppna återkrav', value: dashboard.openRecoveryClaims, tone: 'warning' },
          { label: 'Riskbelopp', value: formatSek(dashboard.amountAtRiskSekTotal), tone: 'danger' },
        ]}
      />
      <Card title="SSBTEK/GIF-metadata">
        <p>
          Verifierade inkomster bär källmetadata (SSBTEK/GIF/Skatteverket/Försäkringskassan m.fl.),
          verifieringsreferens, <em>used_in_decision</em>, rättslig grund, ändamål och exportbarhet
          — redo för framtida Inera/GIF-anslutning.
        </p>
      </Card>
    </>
  );
}
