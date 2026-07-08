import { Card, StatGrid, StatusBadge } from '../design-system/components';
import { demo, formatSek, goLive, readinessScores } from '../components/demo-data';

export const dynamic = 'force-static';

/** Översikt: ledningsvy med beredskap, risk och volymer. */
export default function OversiktPage() {
  const production = readinessScores.find((s) => s.scoreKey === 'production_readiness');
  const ubm = readinessScores.find((s) => s.scoreKey === 'ubm_readiness');
  const amountAtRisk = demo.lss.dashboard.amountAtRiskSekTotal + demo.ea.dashboard.amountAtRiskSekTotal;
  return (
    <>
      <h1>Översikt</h1>
      <StatGrid
        stats={[
          { label: 'UBM-beredskap', value: `${ubm?.score ?? 0} %`, tone: (ubm?.score ?? 0) >= 80 ? 'success' : 'warning' },
          { label: 'Produktionsberedskap', value: `${production?.score ?? 0} %`, tone: (production?.score ?? 0) >= 80 ? 'success' : 'warning' },
          { label: 'Öppna UBM-förfrågningar', value: demo.lss.ubmRequestIds.length },
          { label: 'Riskbelopp', value: formatSek(amountAtRisk), tone: 'danger' },
          { label: 'Öppna återkrav (LSS)', value: demo.lss.dashboard.openRecoveryClaims },
          { label: 'Öppna återkrav (EB)', value: demo.ea.dashboard.openRecoveryClaims },
          { label: 'Riskflaggor', value: demo.allFlags.length, tone: 'warning' },
          { label: 'Utbetalt (EB)', value: formatSek(demo.ea.dashboard.paidAmountSekTotal) },
        ]}
      />
      <Card title="Go-live-status">
        {goLive.ready ? (
          <StatusBadge status="Klar för go-live" tone="success" />
        ) : (
          <>
            <StatusBadge status="Ej klar för go-live" tone="warning" />
            <p>{goLive.reason}</p>
          </>
        )}
      </Card>
      <Card title="Nästa steg">
        <ul>
          <li>Granska öppna exportförslag under Exportförslag.</li>
          <li>Följ upp riskflaggor med hög allvarlighetsgrad under Kontrollärenden.</li>
          <li>Slutför återstående beredskapssteg under Inställningar → Beredskap.</li>
        </ul>
      </Card>
    </>
  );
}
