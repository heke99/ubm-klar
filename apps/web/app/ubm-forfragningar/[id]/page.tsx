import { redirect } from 'next/navigation';
import { Card, StatusBadge, BlockedExplanation } from '../../../design-system/components';
import { apiGet, apiSend } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';
import { ApiStateGuard } from '../../../components/page-states';

export const dynamic = 'force-dynamic';

interface RequestDetail {
  request: {
    id: string;
    requestNumber: string;
    status: string;
    domain: string | undefined;
    receivedAt: string;
    deadlineAt: string | undefined;
    legalSourceKey: string | undefined;
    externalReference: string | undefined;
  };
  subjects: Array<{
    id: string;
    matchStatus: string;
    matchConfidence: number | undefined;
    personId: string | undefined;
  }>;
  proposals: Array<{
    id: string;
    proposalNumber: string;
    status: string;
    eligibilityOutcome: string;
  }>;
  items: Array<{
    item_key: string;
    description: string;
    requested_data_kind: string;
    status: string;
  }>;
  reviews: Array<{ reviewKind: string; decision: string | null; comment: string | null }>;
}

async function addSubjectAction(formData: FormData) {
  'use server';
  const id = String(formData.get('requestId'));
  await apiSend('POST', `/ubm/requests/${id}/subjects`, {
    personnummer: String(formData.get('personnummer') ?? ''),
  });
  redirect(`/ubm-forfragningar/${id}`);
}

async function transitionAction(formData: FormData) {
  'use server';
  const id = String(formData.get('requestId'));
  await apiSend('POST', `/ubm/requests/${id}/transition`, { to: String(formData.get('to')) });
  redirect(`/ubm-forfragningar/${id}`);
}

async function reviewAction(formData: FormData) {
  'use server';
  const id = String(formData.get('requestId'));
  await apiSend('POST', `/ubm/requests/${id}/reviews`, {
    kind: String(formData.get('kind')),
    decision: String(formData.get('decision')),
    comment: String(formData.get('comment') ?? '') || undefined,
  });
  redirect(`/ubm-forfragningar/${id}`);
}

async function proposalAction(formData: FormData) {
  'use server';
  const id = String(formData.get('requestId'));
  const result = await apiSend<{ proposal: { id: string } }>(
    'POST',
    `/ubm/requests/${id}/proposal`,
    {},
  );
  if (result.kind === 'ok') redirect(`/exportforslag/${result.data.proposal.id}`);
  redirect(`/ubm-forfragningar/${id}`);
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Mottagen',
  registered: 'Registrerad',
  validated: 'Validerad',
  matching: 'Matchning',
  data_collection: 'Datainsamling',
  eligibility_review: 'Lämplighetsprövning',
  proposal_created: 'Exportförslag skapat',
  in_review: 'Under granskning',
  approved: 'Godkänd',
  exported: 'Exporterad',
  receipt_received: 'Kvittens mottagen',
  closed: 'Avslutad',
  rejected: 'Avvisad',
};

const NEXT_TRANSITIONS: Record<string, string[]> = {
  received: ['registered', 'rejected'],
  registered: ['validated', 'rejected'],
  validated: ['matching'],
  matching: ['data_collection', 'rejected'],
  data_collection: ['eligibility_review'],
  eligibility_review: ['rejected'],
};

export default async function UbmForfraganDetaljPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const result = await apiGet<RequestDetail>(`/ubm/requests/${id}`);

  if (result.kind !== 'ok') {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <h1>UBM-förfrågan</h1>
        <ApiStateGuard result={result} />
      </div>
    );
  }
  const { request, subjects, proposals, items, reviews } = result.data;
  const transitions = NEXT_TRANSITIONS[request.status] ?? [];
  const canCreateProposal = [
    'validated',
    'matching',
    'data_collection',
    'eligibility_review',
  ].includes(request.status);

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Förfrågan {request.requestNumber}</h1>
      <p>
        Status: <StatusBadge status={STATUS_LABELS[request.status] ?? request.status} tone="info" />{' '}
        · Mottagen {request.receivedAt.slice(0, 10)} · Frist {request.deadlineAt ?? '—'} · Område{' '}
        {request.domain === 'lss'
          ? 'LSS'
          : request.domain === 'economic_assistance'
            ? 'Ekonomiskt bistånd'
            : 'Okänt'}
      </p>

      <Card title="Efterfrågade uppgifter">
        {items.length === 0 ? (
          <p>Inga uppgifter specificerade.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.item_key}>
                {item.description} <StatusBadge status={item.status} tone="info" />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Personer (${subjects.length})`}>
        {subjects.length === 0 ? <p>Ingen person kopplad ännu.</p> : null}
        <ul>
          {subjects.map((subject) => (
            <li key={subject.id}>
              Person{' '}
              <StatusBadge
                status={
                  subject.matchStatus === 'matched'
                    ? `Matchad (${Math.round((subject.matchConfidence ?? 0) * 100)} %)`
                    : subject.matchStatus === 'manual'
                      ? 'Manuellt bekräftad'
                      : subject.matchStatus === 'not_found'
                        ? 'Hittades inte i dataplanet'
                        : subject.matchStatus
                }
                tone={
                  subject.matchStatus === 'matched' || subject.matchStatus === 'manual'
                    ? 'success'
                    : 'warning'
                }
              />
            </li>
          ))}
        </ul>
        <form action={addSubjectAction} style={{ marginTop: 8 }}>
          <input type="hidden" name="requestId" value={request.id} />
          <label htmlFor="pn">Lägg till person (personnummer)</label>{' '}
          <input id="pn" name="personnummer" placeholder="ÅÅÅÅMMDDNNNN" required />{' '}
          <button type="submit">Sök och matcha</button>
        </form>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Sökningen loggas alltid i dataåtkomstloggen med förfrågan som skäl.
        </p>
      </Card>

      <Card title="Granskningar (juridik/DPO)">
        {reviews.length === 0 ? <p>Inga granskningar registrerade.</p> : null}
        <ul>
          {reviews.map((review, i) => (
            <li key={i}>
              {review.reviewKind === 'legal' ? 'Juridisk granskning' : 'DPO-granskning'}:{' '}
              <StatusBadge
                status={review.decision ?? 'pågår'}
                tone={
                  review.decision === 'approved'
                    ? 'success'
                    : review.decision === 'rejected'
                      ? 'danger'
                      : 'info'
                }
              />
              {review.comment ? ` — ${review.comment}` : ''}
            </li>
          ))}
        </ul>
        <form
          action={reviewAction}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}
        >
          <input type="hidden" name="requestId" value={request.id} />
          <label>
            Typ{' '}
            <select name="kind">
              <option value="legal">Juridisk</option>
              <option value="dpo">DPO</option>
            </select>
          </label>
          <label>
            Beslut{' '}
            <select name="decision">
              <option value="approved">Godkänn</option>
              <option value="needs_changes">Behöver ändringar</option>
              <option value="rejected">Avvisa</option>
            </select>
          </label>
          <label>
            Kommentar <input name="comment" />
          </label>
          <button type="submit">Registrera granskning</button>
        </form>
      </Card>

      {proposals.length > 0 ? (
        <Card title="Exportförslag">
          <ul>
            {proposals.map((proposal) => (
              <li key={proposal.id}>
                <a href={`/exportforslag/${proposal.id}`}>{proposal.proposalNumber}</a>{' '}
                <StatusBadge
                  status={proposal.status}
                  tone={proposal.status === 'eligibility_blocked' ? 'danger' : 'info'}
                />
              </li>
            ))}
          </ul>
          {proposals.some((p) => p.status === 'eligibility_blocked') ? (
            <BlockedExplanation
              blockers={[
                'Ett eller flera exportförslag är blockerade. Öppna förslaget för att se skälen (t.ex. saknade uppgifter, ofullständig lineage eller krävda granskningar).',
              ]}
            />
          ) : null}
        </Card>
      ) : null}

      <Card title="Åtgärder">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {transitions.map((to) => (
            <form key={to} action={transitionAction}>
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="to" value={to} />
              <button type="submit">{STATUS_LABELS[to] ?? to}</button>
            </form>
          ))}
          {canCreateProposal ? (
            <form action={proposalAction}>
              <input type="hidden" name="requestId" value={request.id} />
              <button
                type="submit"
                style={{
                  background: 'var(--color-primary)',
                  color: 'var(--color-primary-contrast)',
                  border: 0,
                  padding: '6px 12px',
                  borderRadius: 'var(--radius)',
                }}
              >
                Kör lämplighetsprövning och skapa exportförslag
              </button>
            </form>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
