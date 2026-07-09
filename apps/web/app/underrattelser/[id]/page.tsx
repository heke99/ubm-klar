import { redirect } from 'next/navigation';
import { Card, StatusBadge } from '../../../design-system/components';
import { apiGet, apiSend } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';
import { ApiStateGuard } from '../../../components/page-states';

export const dynamic = 'force-dynamic';

interface NotificationDetail {
  notification: {
    id: string;
    notificationNumber: string;
    domain: string | undefined;
    summary: string;
    status: string;
    controlCaseId: string | undefined;
    receivedAt: string;
  };
  candidates: Array<{
    candidateKind: string;
    score: number;
    scoreBasis: string;
    selected: boolean;
  }>;
  outcomes: Array<{ outcome: string; detail: string | null; decidedAt: string }>;
  outgoingReporting: string;
}

async function notificationAction(formData: FormData) {
  'use server';
  const id = String(formData.get('notificationId'));
  const action = String(formData.get('action'));
  if (action === 'match')
    await apiSend('POST', `/ubm/notifications/${id}/match`, {
      personnummer: String(formData.get('personnummer') ?? ''),
    });
  if (action === 'create-case') {
    const result = await apiSend<{ caseId: string }>(
      'POST',
      `/ubm/notifications/${id}/create-case`,
    );
    if (result.kind === 'ok') redirect(`/kontrollarenden/${result.data.caseId}`);
  }
  if (action === 'outcome')
    await apiSend('POST', `/ubm/notifications/${id}/outcome`, {
      outcome: String(formData.get('outcome') ?? 'no_action'),
      detail: String(formData.get('detail') ?? '') || undefined,
    });
  if (action === 'close') await apiSend('POST', `/ubm/notifications/${id}/close`);
  redirect(`/underrattelser/${id}`);
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Mottagen',
  matching: 'Matchning pågår',
  manual_review: 'Manuell granskning',
  matched: 'Matchad',
  case_created: 'Kontrollärende skapat',
  investigating: 'Utreds',
  outcome_registered: 'Utfall registrerat',
  feedback_sent: 'Återkoppling skickad',
  closed: 'Avslutad',
};

const OUTCOME_LABELS: Record<string, string> = {
  recovery_claim: 'Återkrav inlett',
  payment_stopped: 'Utbetalning stoppad',
  no_action: 'Ingen åtgärd',
  police_report: 'Polisanmälan',
  corrected_source_data: 'Källdata rättad',
  other_action: 'Annan åtgärd',
};

export default async function UnderrattelseDetaljPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const result = await apiGet<NotificationDetail>(`/ubm/notifications/${id}`);

  if (result.kind !== 'ok') {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <h1>Underrättelse</h1>
        <ApiStateGuard result={result} />
      </div>
    );
  }
  const { notification, candidates, outcomes, outgoingReporting } = result.data;

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Underrättelse {notification.notificationNumber}</h1>
      <p>
        Status:{' '}
        <StatusBadge
          status={STATUS_LABELS[notification.status] ?? notification.status}
          tone="info"
        />{' '}
        · Mottagen {notification.receivedAt.slice(0, 10)}
      </p>
      <Card title="Innehåll">
        <p>{notification.summary}</p>
      </Card>

      <Card title="Matchning">
        {candidates.length === 0 ? <p>Ingen matchning gjord ännu.</p> : null}
        <ul>
          {candidates.map((candidate, index) => (
            <li key={index}>
              {candidate.candidateKind}:{' '}
              <StatusBadge
                status={`${Math.round(candidate.score * 100)} % (${candidate.scoreBasis})`}
                tone={candidate.score >= 0.8 ? 'success' : 'warning'}
              />
            </li>
          ))}
        </ul>
        <form
          action={notificationAction}
          style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}
        >
          <input type="hidden" name="notificationId" value={notification.id} />
          <input type="hidden" name="action" value="match" />
          <label>
            Matcha person (personnummer) <input name="personnummer" required />
          </label>
          <button type="submit">Matcha</button>
        </form>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Sökningen loggas i dataåtkomstloggen med underrättelsen som skäl.
        </p>
      </Card>

      {notification.controlCaseId ? (
        <Card title="Kontrollärende">
          <p>
            <a href={`/kontrollarenden/${notification.controlCaseId}`}>Öppna kontrollärendet</a>
          </p>
        </Card>
      ) : null}

      <Card title={`Utfall (${outcomes.length})`}>
        <ul>
          {outcomes.map((outcome, index) => (
            <li key={index}>
              {outcome.decidedAt.slice(0, 16).replace('T', ' ')}:{' '}
              <StatusBadge
                status={OUTCOME_LABELS[outcome.outcome] ?? outcome.outcome}
                tone="success"
              />
              {outcome.detail ? ` — ${outcome.detail}` : ''}
            </li>
          ))}
        </ul>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{outgoingReporting}</p>
      </Card>

      <Card title="Åtgärder">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {!notification.controlCaseId ? (
            <form action={notificationAction}>
              <input type="hidden" name="notificationId" value={notification.id} />
              <input type="hidden" name="action" value="create-case" />
              <button type="submit">Skapa kontrollärende</button>
            </form>
          ) : null}
          <form
            action={notificationAction}
            style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}
          >
            <input type="hidden" name="notificationId" value={notification.id} />
            <input type="hidden" name="action" value="outcome" />
            <label>
              Utfall{' '}
              <select name="outcome">
                <option value="recovery_claim">Återkrav inlett</option>
                <option value="payment_stopped">Utbetalning stoppad</option>
                <option value="no_action">Ingen åtgärd</option>
                <option value="police_report">Polisanmälan</option>
                <option value="corrected_source_data">Källdata rättad</option>
                <option value="other_action">Annan åtgärd</option>
              </select>
            </label>
            <label>
              Detalj <input name="detail" />
            </label>
            <button type="submit">Registrera utfall</button>
          </form>
          <form action={notificationAction}>
            <input type="hidden" name="notificationId" value={notification.id} />
            <input type="hidden" name="action" value="close" />
            <button type="submit">Avsluta underrättelsen</button>
          </form>
        </div>
      </Card>
    </div>
  );
}
