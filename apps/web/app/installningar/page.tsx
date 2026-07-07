import { Card, StatusBadge } from '../../design-system/components';
import { goLive, readinessScores } from '../../components/demo-data';

export const dynamic = 'force-static';

/** Inställningar (admin): integrationer, roller, SSO, beredskap. Ej för handläggare. */
export default function InstallningarPage() {
  return (
    <>
      <h1>Inställningar</h1>
      <Card title="Administration">
        <ul>
          <li>Användare och roller (mappning från Entra ID/SAML/OIDC-grupper)</li>
          <li>Integrationer och importmappningar</li>
          <li>SSO-status och MFA-verifiering</li>
          <li>Backup-/återläsningsstatus</li>
          <li>Miljöstatus (test/stage/prod)</li>
          <li>Informationsklassning och maskeringsregler</li>
        </ul>
        <p>
          Infrastrukturinställningar, fakturering och driftsättning hanteras av leverantörens
          plattformsadministration (utan personuppgifter) och visas inte för handläggare.
        </p>
      </Card>
      <Card title="Produktionsberedskap">
        <ul>
          {readinessScores.map((score) => (
            <li key={score.scoreKey}>
              {score.scoreKey.replaceAll('_', ' ')}: {score.score} %{' '}
              {score.score === 100 ? (
                <StatusBadge status="Klar" tone="success" />
              ) : (
                <StatusBadge status={`${score.completedRequired}/${score.totalRequired} steg`} tone="warning" />
              )}
            </li>
          ))}
        </ul>
        <p>
          Go-live:{' '}
          {goLive.ready ? (
            <StatusBadge status="Tillåten" tone="success" />
          ) : (
            <StatusBadge status="Blockerad" tone="danger" />
          )}{' '}
          {goLive.reason}
        </p>
      </Card>
    </>
  );
}
