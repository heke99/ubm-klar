import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface Gate {
  gateKey: string;
  titleSv: string;
  descriptionSv: string;
  required: boolean;
  gateOrder: number;
  scope: 'pilot' | 'production' | 'both';
  status: string;
  evidenceReference: string | undefined;
  waiverMotivation: string | undefined;
  waiverExpiresAt: string | undefined;
  waiverRiskLevel: string | undefined;
}

interface GatesResponse {
  dataSource: string;
  gates: Gate[];
}

interface ApprovalStatus {
  dataSource: string;
  pilot: { allowed: boolean; openRequiredGates: string[]; waivedGates: string[] };
  production: { allowed: boolean; openRequiredGates: string[]; waivedGates: string[] };
}

function GateList({ gates }: { gates: Gate[] }) {
  return (
    <ol>
      {gates.map((gate) => (
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
              <em>
                Dispens: {gate.waiverMotivation} (risknivå {gate.waiverRiskLevel}, gäller till{' '}
                {gate.waiverExpiresAt})
              </em>
            </>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Onboarding: pilot- och produktionsgrindar med dispenshantering. */
export default async function OnboardingPage() {
  await requireSession();
  const [gatesResult, approvalResult] = await Promise.all([
    apiGet<GatesResponse>('/onboarding/gates'),
    apiGet<ApprovalStatus>('/onboarding/approval-status'),
  ]);

  const gates = gatesResult.kind === 'ok' ? gatesResult.data.gates : [];
  const pilotGates = gates.filter((g) => g.scope === 'pilot' || g.scope === 'both');
  const productionGates = gates.filter((g) => g.scope === 'production' || g.scope === 'both');
  const approval = approvalResult.kind === 'ok' ? approvalResult.data : undefined;

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Onboarding och go-live</h1>
      <p>
        Obligatoriska grindar kan inte förbigås utan dokumenterad dispens (skäl, godkännare,
        giltighetstid och risknivå — allt loggas i revisionsloggen). Utgångna dispenser slutar gälla
        automatiskt. Pilot och produktion har separata checklistor.
      </p>
      <ApiStateGuard result={gatesResult} />
      {gatesResult.kind === 'ok' && gates.length === 0 ? (
        <NoDataYet what="inga beredskapsgrindar" />
      ) : null}

      {approval ? (
        <Card title="Godkännandestatus">
          <p>
            Pilot:{' '}
            {approval.pilot.allowed ? (
              <StatusBadge status="Pilot kan godkännas" tone="success" />
            ) : (
              <StatusBadge
                status={`Blockerad — ${approval.pilot.openRequiredGates.length} grindar återstår`}
                tone="warning"
              />
            )}
          </p>
          {!approval.pilot.allowed && approval.pilot.openRequiredGates.length > 0 ? (
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
              Återstående pilotgrindar: {approval.pilot.openRequiredGates.join(', ')}
            </p>
          ) : null}
          <p>
            Produktion:{' '}
            {approval.production.allowed ? (
              <StatusBadge status="Go-live kan godkännas" tone="success" />
            ) : (
              <StatusBadge
                status={`Blockerad — ${approval.production.openRequiredGates.length} grindar återstår`}
                tone="warning"
              />
            )}
          </p>
        </Card>
      ) : null}

      {gates.length > 0 ? (
        <>
          <Card title={`Pilotgrindar (${pilotGates.length})`}>
            <GateList gates={pilotGates} />
          </Card>
          <Card title={`Produktionsgrindar (${productionGates.length})`}>
            <GateList gates={productionGates} />
          </Card>
        </>
      ) : null}
    </div>
  );
}
