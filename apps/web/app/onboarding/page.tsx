import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface ReadinessResponse {
  dataSource: string;
  gates: Array<{
    gateKey: string;
    titleSv: string;
    descriptionSv: string;
    required: boolean;
    gateOrder: number;
    status: string;
    evidenceReference: string | undefined;
    waiverMotivation: string | undefined;
  }>;
  goLive?: { allowed: boolean; openRequiredGates: string[]; waivedGates: string[] };
}

/** Onboarding: beredskapsgrindar för pilot och produktion. */
export default async function OnboardingPage() {
  await requireSession();
  const readiness = await apiGet<ReadinessResponse>('/ubm/readiness');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Onboarding och go-live</h1>
      <p>
        Obligatoriska grindar kan inte förbigås utan dokumenterad dispens (skäl, godkännare,
        giltighetstid och riskbedömning). Produktionsgodkännande kräver att alla obligatoriska
        grindar är godkända eller formellt undantagna. Pilotgodkännande har en egen, mindre
        checklista.
      </p>
      <ApiStateGuard result={readiness} />
      {readiness.kind === 'ok' ? (
        readiness.data.gates.length === 0 ? (
          <NoDataYet what="inga beredskapsgrindar" />
        ) : (
          <>
            <Card title="Go-live-status">
              {readiness.data.goLive?.allowed ? (
                <StatusBadge status="Alla obligatoriska grindar klara" tone="success" />
              ) : (
                <>
                  <StatusBadge status="Produktion blockerad" tone="warning" />
                  <p>
                    Återstående obligatoriska grindar:{' '}
                    {readiness.data.goLive?.openRequiredGates.join(', ') || 'okänt'}
                  </p>
                </>
              )}
              {readiness.data.goLive && readiness.data.goLive.waivedGates.length > 0 ? (
                <p>Undantagna grindar (dispens): {readiness.data.goLive.waivedGates.join(', ')}</p>
              ) : null}
            </Card>
            <Card title={`Grindar (${readiness.data.gates.length})`}>
              <ol>
                {readiness.data.gates.map((gate) => (
                  <li key={gate.gateKey} style={{ marginBottom: 'var(--space-2)' }}>
                    <strong>{gate.titleSv}</strong>{' '}
                    <StatusBadge
                      status={gate.status}
                      tone={
                        gate.status === 'passed'
                          ? 'success'
                          : gate.status === 'waived'
                            ? 'warning'
                            : gate.status === 'failed'
                              ? 'danger'
                              : 'info'
                      }
                    />
                    {gate.required ? '' : ' (frivillig)'}
                    <br />
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                      {gate.descriptionSv}
                    </span>
                    {gate.waiverMotivation ? (
                      <>
                        <br />
                        <em>Dispens: {gate.waiverMotivation}</em>
                      </>
                    ) : null}
                  </li>
                ))}
              </ol>
            </Card>
          </>
        )
      ) : null}
    </div>
  );
}
