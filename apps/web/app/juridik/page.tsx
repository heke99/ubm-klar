import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface ProposalsResponse {
  dataSource: string;
  proposals: Array<{ id: string; proposalNumber: string; status: string }>;
}

/** Juridik och DPO: granskningar, känsliga åtkomster, dataskyddsstatus. */
export default async function JuridikPage() {
  await requireSession();
  const proposals = await apiGet<ProposalsResponse>('/ubm/export-proposals');
  const inReview =
    proposals.kind === 'ok' ? proposals.data.proposals.filter((p) => p.status === 'in_review') : [];

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
      <Card title="Dataskydd och rättsligt stöd">
        <ul>
          <li>Rättslig grund per modul: se dokumentationen för registerförteckningen</li>
          <li>PUB-avtal/DPA: status hanteras i onboarding-grindarna</li>
          <li>DPIA: status hanteras i onboarding-grindarna</li>
          <li>Gallringspolicy: se Arkiv</li>
          <li>Rutin för registerutdrag och registrerades rättigheter</li>
          <li>Underbiträdesförteckning</li>
        </ul>
        <p>
          <a href="/revision">Öppna revisions- och dataåtkomstloggen</a> för att granska känsliga
          åtkomster, avslag och break-glass-sessioner.
        </p>
      </Card>
    </div>
  );
}
