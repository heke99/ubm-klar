import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface ReadinessResponse {
  dataSource: string;
  gates: Array<{ gateKey: string; titleSv: string; required: boolean; status: string }>;
  goLive?: { allowed: boolean; openRequiredGates: string[] };
}

/** UBM-beredskap: fas 1 (2026) och fas 2 (2029, funktionsflaggad). */
export default async function UbmBeredskapPage() {
  await requireSession();
  const readiness = await apiGet<ReadinessResponse>('/ubm/readiness');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>UBM-beredskap</h1>
      <Card title="Fas 1 – Förfrågningsbaserad hantering (från 1 juli 2026)">
        <StatusBadge status="Aktiv (manuell hantering)" tone="success" />
        <p>
          Kommunen kan ta emot, registrera, bedöma och besvara förfrågningar från
          Utbetalningsmyndigheten med granskning, maskning, fyra-ögon-godkännande och
          kvittenshantering. Officiell digital överföring är inte tillgänglig — export sker som
          manuell nedladdning.
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
      <Card title="Beredskapsgrindar">
        <ApiStateGuard result={readiness} />
        {readiness.kind === 'ok' ? (
          readiness.data.gates.length === 0 ? (
            <NoDataYet what="inga beredskapsgrindar" />
          ) : (
            <ul>
              {readiness.data.gates.map((gate) => (
                <li key={gate.gateKey}>
                  {gate.titleSv}{' '}
                  <StatusBadge
                    status={gate.status}
                    tone={
                      gate.status === 'passed'
                        ? 'success'
                        : gate.status === 'failed'
                          ? 'danger'
                          : 'info'
                    }
                  />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Card>
    </div>
  );
}
