import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface ProposalsResponse {
  dataSource: string;
  proposals: Array<{
    id: string;
    proposalNumber: string;
    domain: string;
    status: string;
    eligibilityOutcome: string;
    createdAt: string;
  }>;
  counts: Record<string, number>;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  eligibility_blocked: 'Blockerad (lämplighet)',
  in_review: 'Under granskning',
  approved: 'Godkänd',
  rejected: 'Avvisad',
  packaged: 'Paketerad',
  sent: 'Skickad (manuellt)',
  receipt_received: 'Kvittens mottagen',
  closed: 'Avslutad',
};

export default async function ExportforslagPage() {
  await requireSession();
  const result = await apiGet<ProposalsResponse>('/ubm/export-proposals');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Exportförslag</h1>
      <p>
        Exportförslag skapas från UBM-förfrågningar efter lämplighetsprövning. Paketering kräver
        fyra-ögon-godkännande (maker–checker); blockerade förslag förklarar alltid varför.
      </p>
      <ApiStateGuard result={result} />
      {result.kind === 'ok' ? (
        result.data.proposals.length === 0 ? (
          <NoDataYet what="inga exportförslag" />
        ) : (
          <Card title={`Exportförslag (${result.data.proposals.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Nummer</th>
                  <th style={{ padding: 'var(--space-2)' }}>Område</th>
                  <th style={{ padding: 'var(--space-2)' }}>Lämplighet</th>
                  <th style={{ padding: 'var(--space-2)' }}>Skapad</th>
                  <th style={{ padding: 'var(--space-2)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.data.proposals.map((proposal) => (
                  <tr key={proposal.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <a href={`/exportforslag/${proposal.id}`}>{proposal.proposalNumber}</a>
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      {proposal.domain === 'lss' ? 'LSS' : 'Ekonomiskt bistånd'}
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>{proposal.eligibilityOutcome}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{proposal.createdAt.slice(0, 10)}</td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <StatusBadge
                        status={STATUS_LABELS[proposal.status] ?? proposal.status}
                        tone={
                          ['approved', 'packaged', 'receipt_received', 'closed'].includes(
                            proposal.status,
                          )
                            ? 'success'
                            : ['eligibility_blocked', 'rejected'].includes(proposal.status)
                              ? 'danger'
                              : 'info'
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : null}
    </div>
  );
}
