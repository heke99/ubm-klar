import { Card } from '../../design-system/components';
import { demo, formatSek, readinessScores } from '../../components/demo-data';

export const dynamic = 'force-static';

/** Rapporter: exporterbara lednings- och verksamhetsrapporter. */
export default function RapporterPage() {
  return (
    <>
      <h1>Rapporter</h1>
      <Card title="Tillgängliga rapporter">
        <ul>
          <li>Ledningsrapport: beredskap, riskbelopp, trender per månad</li>
          <li>UBM-rapport: förfrågningar, exportförslag, blockerade exporter, kvittenser</li>
          <li>LSS-rapport: timmar, fakturering, utförarrisk, IVO-status</li>
          <li>EB-rapport: ansökningar, beslut, utbetalningar, anomalier</li>
          <li>Betalningskontrollrapport: avstämningar, dubbletter, mottagaravvikelser</li>
          <li>DPO-rapport: åtkomster, känsliga visningar, break-glass-sessioner</li>
          <li>Arkivrapport: gallringsstatus, arkivuttag</li>
        </ul>
        <p>Alla rapporter kan filtreras per period, förvaltning, utförare och allvarlighetsgrad samt exporteras.</p>
      </Card>
      <Card title="Nyckeltal just nu (demo)">
        <ul>
          <li>Riskbelopp totalt: {formatSek(demo.lss.dashboard.amountAtRiskSekTotal + demo.ea.dashboard.amountAtRiskSekTotal)}</li>
          <li>Produktionsberedskap: {readinessScores.find((s) => s.scoreKey === 'production_readiness')?.score} %</li>
          <li>Riskflaggor: {demo.allFlags.length}</li>
        </ul>
      </Card>
    </>
  );
}
