import { redirect } from 'next/navigation';
import { Card, StatusBadge } from '../../design-system/components';
import { apiGet, apiSend } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface PoliciesResponse {
  rules: Array<{
    rule_key: string;
    classification_key: string;
    trigger_event: string;
    retention_years: number;
    action: string;
    is_active: boolean;
  }>;
}
interface HoldsResponse {
  holds: Array<{
    holdKey: string;
    title: string;
    reason: string;
    createdAt: string;
    active: boolean;
  }>;
}
interface DisposalResponse {
  decisions: Array<{
    decisionNumber: string;
    classificationKey: string;
    scope: string;
    status: string;
    decidedAt: string;
  }>;
  activeLegalHolds: number;
  note: string;
}

async function createHoldAction(formData: FormData) {
  'use server';
  await apiSend('POST', '/retention/legal-holds', {
    holdKey: String(formData.get('holdKey') ?? ''),
    title: String(formData.get('title') ?? ''),
    reason: String(formData.get('reason') ?? ''),
  });
  redirect('/arkiv');
}

const TRIGGER_LABELS: Record<string, string> = {
  case_closed: 'Ärende avslutat',
  decision_expired: 'Beslut upphört',
  payment_completed: 'Utbetalning slutförd',
  person_deceased: 'Person avliden',
  fixed_date: 'Fast datum',
};

/** Arkiv: gallringsregler, rättsliga undantag och gallringskö — verkliga data. */
export default async function ArkivPage() {
  await requireSession();
  const [policies, holds, disposal] = await Promise.all([
    apiGet<PoliciesResponse>('/retention/policies'),
    apiGet<HoldsResponse>('/retention/legal-holds'),
    apiGet<DisposalResponse>('/retention/disposal-queue'),
  ]);

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Arkiv</h1>
      <Card title="Gallring och bevarande (per informationsklass)">
        <ApiStateGuard result={policies} />
        {policies.kind === 'ok' ? (
          policies.data.rules.length === 0 ? (
            <NoDataYet what="inga gallringsregler" />
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Klassificering</th>
                  <th style={{ padding: 'var(--space-2)' }}>Utlösande händelse</th>
                  <th style={{ padding: 'var(--space-2)' }}>Frist</th>
                  <th style={{ padding: 'var(--space-2)' }}>Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {policies.data.rules.map((rule) => (
                  <tr key={rule.rule_key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>{rule.classification_key}</td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      {TRIGGER_LABELS[rule.trigger_event] ?? rule.trigger_event}
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>{rule.retention_years} år</td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <StatusBadge
                        status={
                          rule.action === 'dispose'
                            ? 'Gallras'
                            : rule.action === 'archive'
                              ? 'Arkiveras'
                              : 'Granskas'
                        }
                        tone="info"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </Card>

      <Card title="Rättsliga undantag (legal holds)">
        <p>Aktiva undantag stoppar alltid gallring.</p>
        {holds.kind === 'ok' ? (
          <ul>
            {holds.data.holds.map((hold) => (
              <li key={hold.holdKey}>
                <strong>{hold.title}</strong> ({hold.holdKey}) — {hold.reason}{' '}
                <StatusBadge
                  status={hold.active ? 'Aktivt' : 'Släppt'}
                  tone={hold.active ? 'warning' : 'success'}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <form
          action={createHoldAction}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <label>
            Nyckel <input name="holdKey" required placeholder="t.ex. HOLD-2026-01" />
          </label>
          <label>
            Titel <input name="title" required />
          </label>
          <label>
            Skäl <input name="reason" required style={{ width: 240 }} />
          </label>
          <button type="submit">Skapa rättsligt undantag</button>
        </form>
      </Card>

      <Card title="Gallringskö">
        {disposal.kind === 'ok' ? (
          <>
            <p>
              {disposal.data.note} Aktiva undantag just nu: {disposal.data.activeLegalHolds}.
            </p>
            {disposal.data.decisions.length === 0 ? (
              <p>Inga gallringsbeslut i kön.</p>
            ) : (
              <ul>
                {disposal.data.decisions.map((decision) => (
                  <li key={decision.decisionNumber}>
                    {decision.decisionNumber} ({decision.classificationKey}): {decision.scope}{' '}
                    <StatusBadge status={decision.status} tone="info" />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <ApiStateGuard result={disposal} />
        )}
      </Card>

      <Card title="E-arkivuttag">
        <p>
          Uttag paketeras med manifest och kontrollsummor (FGS-paket/OAIS SIP/zip+manifest),
          verifieras mot manifestet och kräver arkivbehörighet samt fyra-ögon-godkännande.
        </p>
      </Card>
    </div>
  );
}
