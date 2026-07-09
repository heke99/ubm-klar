import { redirect } from 'next/navigation';
import { Card } from '../../../design-system/components';
import { apiSend } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';

export const dynamic = 'force-dynamic';

async function registerAction(formData: FormData) {
  'use server';
  const requestedItems = String(formData.get('requestedItems') ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      itemKey: `item_${index + 1}`,
      description: line,
      requestedDataKind: 'unspecified',
    }));

  const result = await apiSend<{ id: string }>('POST', '/ubm/requests', {
    requestNumber: String(formData.get('requestNumber') ?? '').trim(),
    receivedAt: String(formData.get('receivedAt') ?? new Date().toISOString().slice(0, 10)),
    deadlineAt: String(formData.get('deadlineAt') ?? '') || undefined,
    domain: String(formData.get('domain') ?? 'unknown'),
    externalReference: String(formData.get('externalReference') ?? '') || undefined,
    legalSourceKey: String(formData.get('legalSourceKey') ?? '') || undefined,
    requestedItems,
  });
  if (result.kind !== 'ok') {
    redirect(`/ubm-forfragningar/new?error=${result.kind}`);
  }
  redirect(`/ubm-forfragningar/${result.data.id}`);
}

export default async function NyUbmForfraganPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSession();
  const params = await searchParams;

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 640 }}>
      <h1>Registrera UBM-förfrågan</h1>
      <p>
        Registrera en förfrågan från Utbetalningsmyndigheten manuellt (t.ex. mottagen per brev eller
        säker e-post). Officiell digital kanal finns inte ännu.
      </p>
      {params.error ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          Förfrågan kunde inte registreras
          {params.error === 'forbidden' ? ' — behörighet saknas' : ''}.
        </p>
      ) : null}
      <Card title="Förfrågans uppgifter">
        <form action={registerAction}>
          <label htmlFor="requestNumber" style={{ display: 'block', margin: '8px 0 4px' }}>
            Förfrågans ärendenummer *
          </label>
          <input
            id="requestNumber"
            name="requestNumber"
            required
            style={{ width: '100%', padding: 8 }}
          />

          <label htmlFor="externalReference" style={{ display: 'block', margin: '8px 0 4px' }}>
            Extern referens (myndighetens beteckning)
          </label>
          <input
            id="externalReference"
            name="externalReference"
            style={{ width: '100%', padding: 8 }}
          />

          <label htmlFor="receivedAt" style={{ display: 'block', margin: '8px 0 4px' }}>
            Mottagen datum *
          </label>
          <input
            id="receivedAt"
            name="receivedAt"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />

          <label htmlFor="deadlineAt" style={{ display: 'block', margin: '8px 0 4px' }}>
            Svarsfrist
          </label>
          <input id="deadlineAt" name="deadlineAt" type="date" />

          <label htmlFor="domain" style={{ display: 'block', margin: '8px 0 4px' }}>
            Verksamhetsområde *
          </label>
          <select id="domain" name="domain" style={{ width: '100%', padding: 8 }}>
            <option value="lss">LSS / personlig assistans</option>
            <option value="economic_assistance">Ekonomiskt bistånd</option>
            <option value="unknown">Okänt / båda</option>
          </select>

          <label htmlFor="legalSourceKey" style={{ display: 'block', margin: '8px 0 4px' }}>
            Rättslig grund/hänvisning
          </label>
          <input
            id="legalSourceKey"
            name="legalSourceKey"
            placeholder="t.ex. lag_2024_ubm"
            style={{ width: '100%', padding: 8 }}
          />

          <label htmlFor="requestedItems" style={{ display: 'block', margin: '8px 0 4px' }}>
            Efterfrågade uppgifter (en per rad) *
          </label>
          <textarea
            id="requestedItems"
            name="requestedItems"
            rows={4}
            required
            placeholder={'Gällande LSS-beslut\nUtbetalningar januari–juni 2026'}
            style={{ width: '100%', padding: 8 }}
          />

          <button
            type="submit"
            style={{
              marginTop: 12,
              background: 'var(--color-primary)',
              color: 'var(--color-primary-contrast)',
              border: 0,
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
          >
            Registrera förfrågan
          </button>
        </form>
      </Card>
    </div>
  );
}
