import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface ProposalsResponse {
  dataSource: string;
  proposals: Array<{ id: string; proposalNumber: string; status: string }>;
}

interface GatesResponse {
  gates: Array<{ gateKey: string; titleSv: string; status: string }>;
}

/** Juridik och DPO: granskningar, känsliga åtkomster, dataskyddsstatus. */
export default async function JuridikPage() {
  await requireSession();
  const [proposals, gatesResult] = await Promise.all([
    apiGet<ProposalsResponse>('/ubm/export-proposals'),
    apiGet<GatesResponse>('/onboarding/gates'),
  ]);
  const inReview =
    proposals.kind === 'ok' ? proposals.data.proposals.filter((p) => p.status === 'in_review') : [];
  const gates = gatesResult.kind === 'ok' ? gatesResult.data.gates : [];
  const legalGates = [
    'dpa_pub_signed',
    'dpia_completed',
    'legal_basis_confirmed',
    'retention_configured',
  ]
    .map((key) => gates.find((gate) => gate.gateKey === key))
    .filter((gate): gate is NonNullable<typeof gate> => Boolean(gate));

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Juridik och DPO</h1>
      <Card title="Exportförslag som väntar på granskning">
        <ApiStateGuard result={proposals} />
        {proposals.kind === 'ok' ? (
          inReview.length === 0 ? (
            <NoDataYet what="inga exportförslag som väntar på juridisk granskning" />
          ) : (
            <ul>
              {inReview.map((proposal) => (
                <li key={proposal.id}>
                  <a href={`/exportforslag/${proposal.id}`}>{proposal.proposalNumber}</a>{' '}
                  <StatusBadge status="Under granskning" tone="warning" />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Card>
      <Card title="Dataskyddsstatus för kommunen">
        {legalGates.length === 0 ? (
          <p>Grindstatus kunde inte hämtas (kräver behörighet för beredskapsgrindar).</p>
        ) : (
          <ul>
            {legalGates.map((gate) => (
              <li key={gate.gateKey}>
                {gate.titleSv}:{' '}
                <StatusBadge
                  status={gate.status}
                  tone={
                    gate.status === 'passed'
                      ? 'success'
                      : gate.status === 'waived'
                        ? 'warning'
                        : 'info'
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Dataskydd och rättsligt stöd">
        <ul>
          <li>Rättslig grund per modul: registerförteckning i dokumentationen (docs/gdpr)</li>
          <li>
            Registrerades rättigheter: registerutdrag och rättelse hanteras av kommunens DPO;
            begäran loggas som dataåtkomst
          </li>
          <li>Underbiträdesförteckning: se docs/gdpr/subprocessors i leveransdokumentationen</li>
          <li>
            Incidentkontakt: säkerhetsincidenter rapporteras enligt incidentrunbooken (72 h GDPR /
            24 h NIS2)
          </li>
          <li>
            Gallringspolicy och rättsliga undantag: <a href="/arkiv">Arkiv</a>
          </li>
        </ul>
        <p>
          <a href="/revision">Öppna revisions- och dataåtkomstloggen</a> för att granska känsliga
          åtkomster, avslag och break-glass-sessioner.
        </p>
      </Card>
    </div>
  );
}
