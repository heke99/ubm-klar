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
    required: boolean;
    status: string;
  }>;
  goLive?: { allowed: boolean; openRequiredGates: string[] };
}

/** Inställningar (admin): roller, SSO, beredskap. Ej för handläggare. */
export default async function InstallningarPage() {
  await requireSession();
  const readiness = await apiGet<ReadinessResponse>('/ubm/readiness');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Inställningar</h1>
      <Card title="Administration">
        <ul>
          <li>
            <a href="/onboarding">Onboarding och beredskapsgrindar</a>
          </li>
          <li>
            <a href="/installningar/anvandare">Användare och roller</a> (mappning från Entra
            ID/OIDC-grupper)
          </li>
          <li>
            <a href="/importer">Integrationer och importmappningar</a>
          </li>
          <li>SSO-status och MFA-verifiering</li>
          <li>Backup-/återläsningsstatus</li>
          <li>
            <a href="/installningar/jobb">Bakgrundsjobb och kö</a>
          </li>
          <li>
            <a href="/revision">Revision och loggar</a>
          </li>
        </ul>
        <p>
          Infrastrukturinställningar, fakturering och driftsättning hanteras av leverantörens
          plattformsadministration (utan personuppgifter) och visas inte för handläggare.
        </p>
      </Card>
      <Card title="Produktionsberedskap">
        <ApiStateGuard result={readiness} />
        {readiness.kind === 'ok' ? (
          readiness.data.gates.length === 0 ? (
            <NoDataYet what="inga beredskapsgrindar" />
          ) : (
            <>
              <p>
                Go-live:{' '}
                {readiness.data.goLive?.allowed ? (
                  <StatusBadge status="Tillåten" tone="success" />
                ) : (
                  <StatusBadge
                    status={`Blockerad — ${readiness.data.goLive?.openRequiredGates.length ?? '?'} obligatoriska grindar återstår`}
                    tone="warning"
                  />
                )}
              </p>
              <ul>
                {readiness.data.gates.map((gate) => (
                  <li key={gate.gateKey}>
                    {gate.titleSv}{' '}
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
                  </li>
                ))}
              </ul>
            </>
          )
        ) : null}
      </Card>
    </div>
  );
}
