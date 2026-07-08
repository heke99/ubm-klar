import { Card, StatGrid, StatusBadge } from '../../design-system/components';
import { readinessScores } from '../../components/demo-data';

export const dynamic = 'force-static';

/** UBM-beredskap: fas 1 (2026) och fas 2 (2029, funktionsflaggad). */
export default function UbmBeredskapPage() {
  return (
    <>
      <h1>UBM-beredskap</h1>
      <Card title="Fas 1 – Förfrågningsbaserad hantering (från 1 juli 2026)">
        <StatusBadge status="Aktiv" tone="success" />
        <p>
          Kommunen kan ta emot, registrera, bedöma och besvara förfrågningar från
          Utbetalningsmyndigheten med granskning, maskning, fyra-ögon-godkännande och kvittenshantering.
        </p>
      </Card>
      <Card title="Fas 2 – Återkommande rapportering (från 1 juli 2029)">
        <StatusBadge status="Inväntar officiell specifikation" tone="warning" />
        <p>
          Återkommande rapportering är förberedd men avstängd (funktionsflaggan{' '}
          <code>ubm_recurring_reporting_2029</code>). Slutliga UBM-format hårdkodas inte innan
          officiella specifikationer finns; scheman ligger i statusen{' '}
          <em>awaiting_official_specification</em> i schemaregistret.
        </p>
      </Card>
      <Card title="Beredskapspoäng">
        <StatGrid
          stats={readinessScores.map((score) => ({
            label: score.scoreKey.replaceAll('_', ' '),
            value: `${score.score} %`,
            tone: score.score === 100 ? ('success' as const) : score.score >= 60 ? ('warning' as const) : ('danger' as const),
          }))}
        />
      </Card>
    </>
  );
}
