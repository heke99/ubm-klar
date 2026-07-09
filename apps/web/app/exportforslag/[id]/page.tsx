import { redirect } from 'next/navigation';
import { BlockedExplanation, Card, StatusBadge } from '../../../design-system/components';
import { apiGet, apiSend } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';
import { ApiStateGuard } from '../../../components/page-states';

export const dynamic = 'force-dynamic';

interface ProposalDetail {
  proposal: {
    id: string;
    proposalNumber: string;
    requestId: string | undefined;
    domain: string;
    schemaKey: string;
    schemaVersion: string;
    eligibilityOutcome: string;
    eligibilityExplanations: string[];
    status: string;
  };
  rows: Array<{ entityKind: string; fields: string[] }>;
  rowCount: number;
  workflow: { id: string; status: string } | null;
  submissions: Array<{
    id: string;
    submissionNumber: string;
    status: string;
    manifestHash: string;
    sentAt: string | null;
  }>;
}

async function act(formData: FormData) {
  'use server';
  const id = String(formData.get('proposalId'));
  const action = String(formData.get('action'));
  if (action === 'submit') await apiSend('POST', `/ubm/export-proposals/${id}/submit-for-review`);
  if (action === 'approve')
    await apiSend('POST', `/ubm/export-proposals/${id}/approve`, {
      decision: String(formData.get('decision') ?? 'approved'),
      comment: String(formData.get('comment') ?? '') || undefined,
    });
  if (action === 'package') await apiSend('POST', `/ubm/export-proposals/${id}/package`);
  if (action === 'send')
    await apiSend('POST', `/ubm/export-proposals/${id}/register-sending`, {
      channel: String(formData.get('channel') ?? 'manuell leverans'),
      recipientReference: String(formData.get('recipientReference') ?? '') || undefined,
    });
  if (action === 'receipt')
    await apiSend('POST', `/ubm/export-proposals/${id}/receipt`, {
      receiptReference: String(formData.get('receiptReference') ?? ''),
    });
  redirect(`/exportforslag/${id}`);
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

export default async function ExportforslagDetaljPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const result = await apiGet<ProposalDetail>(`/ubm/export-proposals/${id}`);

  if (result.kind !== 'ok') {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <h1>Exportförslag</h1>
        <ApiStateGuard result={result} />
      </div>
    );
  }
  const { proposal, rows, rowCount, submissions } = result.data;
  const blocked = proposal.status === 'eligibility_blocked';

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Exportförslag {proposal.proposalNumber}</h1>
      <p>
        Status:{' '}
        <StatusBadge
          status={STATUS_LABELS[proposal.status] ?? proposal.status}
          tone={blocked || proposal.status === 'rejected' ? 'danger' : 'info'}
        />{' '}
        · Schema: {proposal.schemaKey} {proposal.schemaVersion} · Lämplighet:{' '}
        {proposal.eligibilityOutcome}
      </p>

      {blocked ? <BlockedExplanation blockers={proposal.eligibilityExplanations} /> : null}

      <Card title={`Innehåll (${rowCount} datarader)`}>
        {rows.length === 0 ? (
          <p>Inga datarader.</p>
        ) : (
          <ul>
            {rows.slice(0, 30).map((row, index) => (
              <li key={index}>
                {row.entityKind}: fält {row.fields.join(', ')}
              </li>
            ))}
          </ul>
        )}
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Endast godkända uppgifter ingår i paketet. Skyddade, medicinska och barnrelaterade
          uppgifter kräver uttryckligt godkännande.
        </p>
      </Card>

      {submissions.length > 0 ? (
        <Card title="Paket och leverans">
          <ul>
            {submissions.map((submission) => (
              <li key={submission.id}>
                {submission.submissionNumber} —{' '}
                <StatusBadge status={submission.status} tone="info" /> · manifest-hash{' '}
                <code>{submission.manifestHash.slice(0, 16)}…</code>
                {submission.sentAt
                  ? ` · skickad ${submission.sentAt.slice(0, 16).replace('T', ' ')}`
                  : ''}
              </li>
            ))}
          </ul>
          <p>
            <a href={`/exportforslag/${proposal.id}/download`}>Ladda ner paketet (zip)</a> — varje
            nedladdning loggas i revisions- och dataåtkomstloggen.
          </p>
        </Card>
      ) : null}

      <Card title="Åtgärder">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {proposal.status === 'draft' ? (
            <form action={act}>
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="action" value="submit" />
              <button type="submit">Skicka till granskning</button>
            </form>
          ) : null}
          {proposal.status === 'in_review' ? (
            <form action={act} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="action" value="approve" />
              <label>
                Beslut{' '}
                <select name="decision">
                  <option value="approved">Godkänn</option>
                  <option value="rejected">Avvisa</option>
                  <option value="returned_for_changes">Skicka tillbaka</option>
                </select>
              </label>
              <label>
                Kommentar <input name="comment" />
              </label>
              <button type="submit">Registrera beslut (fyra ögon)</button>
            </form>
          ) : null}
          {proposal.status === 'approved' ? (
            <form action={act}>
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="action" value="package" />
              <button type="submit">Paketera export</button>
            </form>
          ) : null}
          {proposal.status === 'packaged' ? (
            <form action={act} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="action" value="send" />
              <label>
                Kanal <input name="channel" defaultValue="säker e-post" />
              </label>
              <label>
                Mottagarreferens <input name="recipientReference" />
              </label>
              <button type="submit">Registrera manuell sändning</button>
            </form>
          ) : null}
          {proposal.status === 'sent' ? (
            <form action={act} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="action" value="receipt" />
              <label>
                Kvittensreferens <input name="receiptReference" required />
              </label>
              <button type="submit">Registrera kvittens</button>
            </form>
          ) : null}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Fyra-ögon-principen: den som skapade förslaget kan aldrig godkänna det själv (spärras både
          i API:et och i databasen). Officiell UBM-överföring är avstängd — leveransen sker manuellt
          och registreras här.
        </p>
      </Card>
    </div>
  );
}
