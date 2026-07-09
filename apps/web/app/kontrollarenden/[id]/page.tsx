import { redirect } from 'next/navigation';
import { Card, StatusBadge } from '../../../design-system/components';
import { apiGet, apiSend } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';
import { ApiStateGuard } from '../../../components/page-states';

export const dynamic = 'force-dynamic';

interface CaseDetail {
  case: {
    id: string;
    caseNumber: string;
    title: string;
    domain: string;
    severity: string;
    status: string;
    amountAtRiskSek: number | undefined;
    outcome: string | undefined;
    outcomeNote: string | undefined;
    createdAt: string;
  };
  notes: Array<{ note: string; createdAt: string }>;
  events: Array<{ eventKind: string; detail: string | undefined; occurredAt: string }>;
  flags: Array<{ id: string; ruleKey: string; severity: string; explanation: string }>;
}

async function caseAction(formData: FormData) {
  'use server';
  const id = String(formData.get('caseId'));
  const action = String(formData.get('action'));
  if (action === 'assign')
    await apiSend('POST', `/control-cases/${id}/assign`, {
      assigneeSubjectId: String(formData.get('assignee') ?? ''),
    });
  if (action === 'note')
    await apiSend('POST', `/control-cases/${id}/notes`, {
      note: String(formData.get('note') ?? ''),
    });
  if (action === 'transition')
    await apiSend('POST', `/control-cases/${id}/transition`, {
      status: String(formData.get('status') ?? 'investigating'),
    });
  if (action === 'outcome')
    await apiSend('POST', `/control-cases/${id}/outcome`, {
      outcome: String(formData.get('outcome') ?? 'no_action'),
      note: String(formData.get('outcomeNote') ?? '') || undefined,
    });
  redirect(`/kontrollarenden/${id}`);
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Öppet',
  assigned: 'Tilldelat',
  investigating: 'Utreds',
  awaiting_decision: 'Väntar på beslut',
  decided: 'Beslutat',
  closed: 'Avslutat',
  reopened: 'Återöppnat',
};

const OUTCOME_LABELS: Record<string, string> = {
  recovery_claim: 'Återkrav inlett',
  payment_stopped: 'Utbetalning stoppad',
  no_action: 'Ingen åtgärd',
  police_report: 'Polisanmälan',
  corrected_source_data: 'Källdata rättad',
  other_action: 'Annan åtgärd',
};

const formatSek = (value: number) =>
  new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  }).format(value);

export default async function KontrollarendeDetaljPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const result = await apiGet<CaseDetail>(`/control-cases/${id}`);

  if (result.kind !== 'ok') {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <h1>Kontrollärende</h1>
        <ApiStateGuard result={result} />
      </div>
    );
  }
  const { case: controlCase, notes, events, flags } = result.data;

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>
        {controlCase.caseNumber}: {controlCase.title}
      </h1>
      <p>
        Status:{' '}
        <StatusBadge status={STATUS_LABELS[controlCase.status] ?? controlCase.status} tone="info" />{' '}
        · Allvarlighet:{' '}
        <StatusBadge
          status={controlCase.severity}
          tone={['high', 'critical'].includes(controlCase.severity) ? 'danger' : 'warning'}
        />{' '}
        · Riskbelopp:{' '}
        {controlCase.amountAtRiskSek !== undefined ? formatSek(controlCase.amountAtRiskSek) : '—'}
      </p>
      {controlCase.outcome ? (
        <p>
          Utfall:{' '}
          <StatusBadge
            status={OUTCOME_LABELS[controlCase.outcome] ?? controlCase.outcome}
            tone="success"
          />
          {controlCase.outcomeNote ? ` — ${controlCase.outcomeNote}` : ''}
        </p>
      ) : null}

      <Card title={`Riskflaggor som utlöste ärendet (${flags.length})`}>
        {flags.length === 0 ? (
          <p>Inga kopplade riskflaggor (manuellt ärende).</p>
        ) : (
          <ul>
            {flags.map((flag) => (
              <li key={flag.id}>
                <strong>{flag.ruleKey}</strong> ({flag.severity}): {flag.explanation}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Händelsekedja (revisionsspår)">
        {events.length === 0 ? (
          <p>Inga händelser.</p>
        ) : (
          <ul>
            {events.map((event, index) => (
              <li key={index}>
                {event.occurredAt.slice(0, 16).replace('T', ' ')} — {event.eventKind}
                {event.detail ? ` (${event.detail})` : ''}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Anteckningar (${notes.length})`}>
        <ul>
          {notes.map((note, index) => (
            <li key={index}>
              {note.createdAt.slice(0, 16).replace('T', ' ')}: {note.note}
            </li>
          ))}
        </ul>
        <form action={caseAction} style={{ display: 'flex', gap: 8 }}>
          <input type="hidden" name="caseId" value={controlCase.id} />
          <input type="hidden" name="action" value="note" />
          <input name="note" placeholder="Ny anteckning" required style={{ flex: 1 }} />
          <button type="submit">Lägg till</button>
        </form>
      </Card>

      <Card title="Åtgärder">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <form action={caseAction} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input type="hidden" name="caseId" value={controlCase.id} />
            <input type="hidden" name="action" value="assign" />
            <label>
              Tilldela (användar-id) <input name="assignee" required />
            </label>
            <button type="submit">Tilldela</button>
          </form>
          <form action={caseAction} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input type="hidden" name="caseId" value={controlCase.id} />
            <input type="hidden" name="action" value="transition" />
            <label>
              Status{' '}
              <select name="status">
                <option value="investigating">Utreds</option>
                <option value="awaiting_decision">Väntar på beslut</option>
                <option value="closed">Avsluta</option>
                <option value="reopened">Återöppna</option>
              </select>
            </label>
            <button type="submit">Byt status</button>
          </form>
          <form action={caseAction} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input type="hidden" name="caseId" value={controlCase.id} />
            <input type="hidden" name="action" value="outcome" />
            <label>
              Utfall{' '}
              <select name="outcome">
                <option value="payment_stopped">Stoppa utbetalning</option>
                <option value="recovery_claim">Inled återkrav</option>
                <option value="corrected_source_data">Källdata rättad</option>
                <option value="police_report">Polisanmälan</option>
                <option value="no_action">Ingen åtgärd</option>
                <option value="other_action">Annan åtgärd</option>
              </select>
            </label>
            <label>
              Motivering <input name="outcomeNote" />
            </label>
            <button type="submit">Registrera utfall (beslut)</button>
          </form>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Alla åtgärder loggas i ärendets händelsekedja och i revisionsloggen.
        </p>
      </Card>
    </div>
  );
}
